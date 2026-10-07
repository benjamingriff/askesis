import { sql, type Kysely, type Transaction } from 'kysely';
import { getDatabase } from '../../database/client.js';
import type { DB, Json } from '../../database/generated.js';
import { localDate } from '../athletes/timezone.js';
import { canonicalJson, contentHash, type SemanticValue } from '../plans/plan.canonical.js';
import { PlanError } from '../plans/plan.common.js';
import type { ValidationFinding } from '../plans/plan.validation.js';
import { CALIBRATORS, calibrate, systemsForDiscipline } from './performance.calibrators.js';
import {
  CalibrationEntrySchema,
  CalibrationPreviewResultSchema,
  PerformanceStateSchema,
  type CalibrationEntry,
  type CalibrationInput,
  type PerformanceState,
  type PerformanceSystem,
} from './performance.schemas.js';

type Database = Kysely<DB> | Transaction<DB>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;
const day = (value: unknown) => (value == null ? null : String(value).slice(0, 10));
const instant = (value: Date | string) => new Date(value).toISOString();

/** Every entry for the athlete in timeline order: effective date, then recording order. */
export async function readEntries(db: Database, athleteId: string): Promise<CalibrationEntry[]> {
  const rows = await db
    .selectFrom('athlete_calibrations as c')
    .leftJoin('agent_runs as r', 'r.id', 'c.recorded_by_run_id')
    .selectAll('c')
    .select('r.conversation_id')
    .where('c.athlete_id', '=', athleteId)
    .orderBy('c.effective_from')
    .orderBy('c.recorded_at')
    .orderBy('c.id')
    .execute();
  const zones = rows.length
    ? await db
        .selectFrom('athlete_calibration_zones')
        .selectAll()
        .where(
          'calibration_id',
          'in',
          rows.map((row) => row.id),
        )
        .execute()
    : [];
  return rows.map((row) => {
    const order = CALIBRATORS[row.system as PerformanceSystem].zoneKeys;
    return CalibrationEntrySchema.parse({
      id: row.id,
      system: row.system,
      method: row.method,
      input: row.input,
      calculatorVersion: row.calculator_version,
      provenance: row.provenance,
      estimateBasis: row.estimate_basis,
      observedOn: day(row.observed_on),
      effectiveFrom: day(row.effective_from),
      recordedAt: instant(row.recorded_at),
      recordedBy: row.recorded_by_run_id ? 'coach' : 'athlete',
      conversationId: row.conversation_id,
      retractedAt: row.retracted_at === null ? null : instant(row.retracted_at),
      zones: zones
        .filter((zone) => zone.calibration_id === row.id)
        .sort((a, b) => order.indexOf(a.zone_key) - order.indexOf(b.zone_key))
        .map((zone) => ({
          key: zone.zone_key,
          metric: zone.metric,
          unit: zone.unit,
          minimum: Number(zone.minimum_value),
          target: Number(zone.target_value),
          maximum: Number(zone.maximum_value),
        })),
    });
  });
}

/**
 * The entry in effect for a system on a date: the latest active entry effective by then. Dates
 * before the first entry use that first entry as recorded, so a plan that began before fitness
 * was recorded still resolves its earlier workouts, and later same-day entries never change them.
 */
export function resolveCalibration(
  entries: CalibrationEntry[],
  system: string,
  date: string,
): CalibrationEntry | null {
  const active = entries.filter((entry) => entry.system === system && !entry.retractedAt);
  if (!active.length) return null;
  if (date < active[0]!.effectiveFrom) return active[0]!;
  return active.filter((entry) => entry.effectiveFrom <= date).at(-1)!;
}

async function athleteTimezone(db: Database, athleteId: string, lock = false) {
  let query = db.selectFrom('athletes').select('timezone').where('id', '=', athleteId);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw new PlanError('ATHLETE_NOT_FOUND', 'Athlete not found.', 404);
  return row.timezone;
}

export async function readPerformance(
  db: Database,
  athleteId: string,
  now = new Date(),
): Promise<PerformanceState> {
  const timezone = await athleteTimezone(db, athleteId);
  const today = localDate(timezone, now);
  const entries = await readEntries(db, athleteId);
  return PerformanceStateSchema.parse({
    timezone,
    today,
    current: (Object.keys(CALIBRATORS) as PerformanceSystem[])
      .map((system) => resolveCalibration(entries, system, today))
      .filter((entry) => entry !== null),
    entries: [...entries].reverse(),
  });
}

export async function getPerformance(athleteId: string, now = new Date()) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute((db) => readPerformance(db, athleteId, now));
}

export async function previewCalibration(
  db: Database,
  athleteId: string,
  input: Pick<CalibrationInput, 'system' | 'input'>,
  now = new Date(),
) {
  const calculated = calibrate(input);
  const state = await readPerformance(db, athleteId, now);
  const current = state.current.find((entry) => entry.system === input.system);
  return CalibrationPreviewResultSchema.parse({
    system: input.system,
    method: calculated.method,
    calculatorVersion: calculated.calculatorVersion,
    zones: calculated.zones,
    ...(current ? { current } : {}),
  });
}

/**
 * Append an entry effective from today in the athlete's timezone. Earlier days keep the paces
 * they had. Repeating today's current entry is a no-op, so retries never stack duplicates.
 */
export async function recordCalibrationRows(
  db: Database,
  athleteId: string,
  input: CalibrationInput,
  options: { runId?: string | undefined; now?: Date | undefined } = {},
): Promise<CalibrationEntry> {
  const timezone = await athleteTimezone(db, athleteId, true);
  const today = localDate(timezone, options.now ?? new Date());
  if (input.observedOn && input.observedOn > today)
    throw new PlanError('OBSERVED_IN_FUTURE', 'A result cannot be dated after today.', 422);
  const calculated = calibrate(input);
  const provenance = input.provenance ?? 'user_supplied';
  const current = resolveCalibration(await readEntries(db, athleteId), input.system, today);
  if (
    current?.effectiveFrom === today &&
    current.method === calculated.method &&
    canonicalJson(current.input as SemanticValue) === canonicalJson(input.input as SemanticValue) &&
    current.provenance === provenance &&
    current.estimateBasis === (input.estimateBasis ?? null) &&
    current.observedOn === (input.observedOn ?? null)
  )
    return current;
  const { id } = await db
    .insertInto('athlete_calibrations')
    .values({
      athlete_id: athleteId,
      system: input.system,
      method: calculated.method,
      input: json(input.input),
      calculator_version: calculated.calculatorVersion,
      fitness_value: calculated.fitness,
      provenance,
      estimate_basis: input.estimateBasis ?? null,
      observed_on: input.observedOn ?? null,
      effective_from: today,
      recorded_by_run_id: options.runId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('athlete_calibration_zones')
    .values(
      calculated.zones.map((zone) => ({
        calibration_id: id,
        zone_key: zone.key,
        metric: zone.metric,
        unit: zone.unit,
        minimum_value: zone.minimum,
        target_value: zone.target,
        maximum_value: zone.maximum,
      })),
    )
    .execute();
  return (await readEntries(db, athleteId)).find((entry) => entry.id === id)!;
}

/** Withdraw a mistaken entry; the previous entry applies again. Retracting twice is a no-op. */
export async function retractCalibrationRows(
  db: Database,
  athleteId: string,
  calibrationId: string,
  runId?: string,
) {
  await athleteTimezone(db, athleteId, true);
  const entry = await db
    .selectFrom('athlete_calibrations')
    .select('retracted_at')
    .where('id', '=', calibrationId)
    .where('athlete_id', '=', athleteId)
    .executeTakeFirst();
  if (!entry) throw new PlanError('CALIBRATION_NOT_FOUND', 'Calibration not found.', 404);
  if (entry.retracted_at) return;
  await db
    .updateTable('athlete_calibrations')
    .set({ retracted_at: sql`clock_timestamp()`, retracted_by_run_id: runId ?? null })
    .where('id', '=', calibrationId)
    .execute();
}

async function idempotent(
  athleteId: string,
  scope: string,
  key: string | undefined,
  request: unknown,
  run: (db: Transaction<DB>) => Promise<void>,
  now: Date,
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const requestHash = contentHash(json(request) as SemanticValue);
      if (key) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([athleteId, scope, key])}, 0))`.execute(
          db,
        );
        const cached = await db
          .selectFrom('api_idempotency_keys')
          .selectAll()
          .where('athlete_id', '=', athleteId)
          .where('command_scope', '=', scope)
          .where('idempotency_key', '=', key)
          .executeTakeFirst();
        if (cached) {
          if (cached.request_hash !== requestHash)
            throw new PlanError(
              'IDEMPOTENCY_CONFLICT',
              'This request key was used for different input.',
            );
          return PerformanceStateSchema.parse(cached.response_body);
        }
      }
      await run(db);
      const result = await readPerformance(db, athleteId, now);
      if (key)
        await db
          .insertInto('api_idempotency_keys')
          .values({
            athlete_id: athleteId,
            command_scope: scope,
            idempotency_key: key,
            request_hash: requestHash,
            response_status: 200,
            response_body: json(result),
          })
          .execute();
      return result;
    });
}

export async function recordCalibration(
  athleteId: string,
  { idempotencyKey, ...input }: CalibrationInput & { idempotencyKey?: string | undefined },
  now = new Date(),
) {
  return idempotent(
    athleteId,
    'performance.record',
    idempotencyKey,
    input,
    async (db) => {
      await recordCalibrationRows(db, athleteId, input, { now });
    },
    now,
  );
}

export async function retractCalibration(
  athleteId: string,
  calibrationId: string,
  idempotencyKey?: string,
  now = new Date(),
) {
  return idempotent(
    athleteId,
    `performance.retract:${calibrationId}`,
    idempotencyKey,
    { calibrationId },
    (db) => retractCalibrationRows(db, athleteId, calibrationId),
    now,
  );
}

export async function previewCalibrationFor(
  athleteId: string,
  input: Pick<CalibrationInput, 'system' | 'input'>,
  now = new Date(),
) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute((db) => previewCalibration(db, athleteId, input, now));
}

async function versionOwner(db: Database, versionId: string) {
  const row = await db
    .selectFrom('plan_versions')
    .innerJoin('plans', 'plans.id', 'plan_versions.plan_id')
    .select('plans.owner_id')
    .where('plan_versions.id', '=', versionId)
    .executeTakeFirstOrThrow();
  return row.owner_id;
}

/** A plan can lock only when its athlete has calibrated every system its disciplines use. */
export async function performanceLockFindings(
  db: Database,
  versionId: string,
): Promise<ValidationFinding[]> {
  const entries = await readEntries(db, await versionOwner(db, versionId));
  const disciplines = await db
    .selectFrom('workouts')
    .select('primary_discipline')
    .distinct()
    .where('plan_version_id', '=', versionId)
    .execute();
  return disciplines
    .flatMap((row) => systemsForDiscipline(row.primary_discipline))
    .filter((system) => !entries.some((entry) => entry.system === system && !entry.retractedAt))
    .map((system) => ({
      code: `performance.${system}_required`,
      severity: 'error' as const,
      message: 'Add a race result or estimated threshold pace on the Performance page.',
      path: 'performance',
    }));
}

/** The entries current at lock, recorded with the version as provenance outside its hash. */
export async function calibrationBasis(db: Database, versionId: string, now = new Date()) {
  const state = await readPerformance(db, await versionOwner(db, versionId), now);
  return state.current.map((entry) => ({
    system: entry.system,
    calibrationId: entry.id,
    effectiveFrom: entry.effectiveFrom,
  }));
}

/** Zone targets referencing a system/key with no calibration in effect on the workout date. */
export async function unresolvedZoneTargets(
  db: Database,
  versionId: string,
  targets: { id: string; system: string; key: string; date: string }[],
) {
  if (!targets.length) return [];
  const entries = await readEntries(db, await versionOwner(db, versionId));
  return targets
    .filter(
      (target) =>
        !resolveCalibration(entries, target.system, target.date)?.zones.some(
          (zone) => zone.key === target.key,
        ),
    )
    .map((target) => target.id);
}
