import { sql } from 'kysely';
import { generationState } from './schedule-generation.js';
import type { z } from '@hono/zod-openapi';
import { getDatabase } from '../../database/client.js';
import { PlanError } from './plan.service.js';
import { contentHash, type SemanticValue } from './plan.canonical.js';
import type { Database } from './plan.aggregate.js';
import type { Json } from '../../database/generated.js';
import {
  BriefSchema,
  BriefStateSchema,
  emptyBrief,
  type SaveBriefSchema,
  type ConfirmBriefSchema,
  type CalibrationCommand,
  type BriefCommand,
} from './brief.schemas.js';
import { calculatePaces, planToday } from './pace.calculator.js';
import type { ValidationFinding } from './plan.validation.js';

type Row = Record<string, string | number | boolean | Date | null>;
const date = (value: unknown): string | null =>
  value == null
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
const number = (value: unknown): number | null => (value == null ? null : Number(value));
const semantic = (value: unknown) => JSON.parse(JSON.stringify(value)) as SemanticValue;

export async function readBrief(db: Database, versionId: string, readOnly = false) {
  const version = await db
    .selectFrom('plan_versions')
    .selectAll()
    .where('id', '=', versionId)
    .executeTakeFirstOrThrow();
  const { rows } =
    await sql<Row>`SELECT * FROM plan_briefs WHERE plan_version_id = ${versionId}::uuid`.execute(
      db,
    );
  const row = rows[0];
  const days =
    await sql<Row>`SELECT * FROM plan_brief_weekdays WHERE plan_version_id = ${versionId}::uuid ORDER BY weekday`.execute(
      db,
    );
  const answer = (status: string, field: string) => ({
    status: row![status],
    value: number(row![field]),
  });
  const brief = row
    ? BriefSchema.parse({
        goal: row.goal_text,
        unit: row.distance_unit,
        timezone: row.timezone,
        weeklyDistance: answer('weekly_distance_status', 'weekly_distance_metres'),
        currentRuns: answer('current_runs_status', 'current_runs_per_week'),
        longestRun: answer('longest_run_status', 'longest_run_metres'),
        desiredRuns: number(row.desired_runs_per_week),
        weekdays: days.rows.map((day) => day.availability),
        context: row.context,
      })
    : emptyBrief();
  const periods =
    await sql<Row>`SELECT p.*, c.method, c.race_distance_metres, c.race_duration_seconds,
    c.threshold_seconds_per_kilometre, c.calculator_version, c.provenance, c.estimate_basis FROM plan_calibration_periods p
    JOIN calibration_profiles c ON c.id = p.profile_id AND c.plan_version_id = p.plan_version_id
    WHERE p.plan_version_id = ${versionId}::uuid ORDER BY p.effective_from`.execute(db);
  const zones =
    await sql<Row>`SELECT * FROM calibration_zones WHERE plan_version_id = ${versionId}::uuid`.execute(
      db,
    );
  const calibrations = periods.rows.map((period) => ({
    id: String(period.profile_id),
    effectiveFrom: date(period.effective_from)!,
    effectiveUntil: date(period.effective_until),
    method: period.method,
    distanceMetres: number(period.race_distance_metres),
    durationSeconds: number(period.race_duration_seconds),
    secondsPerKilometre: number(period.threshold_seconds_per_kilometre),
    calculatorVersion: period.calculator_version,
    provenance: period.provenance,
    estimateBasis: period.estimate_basis,
    zones: zones.rows
      .filter((zone) => zone.profile_id === period.profile_id)
      .map((zone) => ({
        key: zone.zone_key,
        fast: Number(zone.minimum_value),
        target: Number(zone.target_value),
        slow: Number(zone.maximum_value),
      }))
      .sort((a, b) => a.key!.toString().localeCompare(b.key!.toString())),
  }));
  const { unit: _unit, ...facts } = brief;
  const hash = contentHash(
    semantic({
      brief: facts,
      startDate: date(version.start_date),
      endDate: date(version.end_date),
      calibrations: calibrations.map(({ id: _id, provenance, estimateBasis, ...values }) =>
        version.content_schema_version < 3 ? values : { ...values, provenance, estimateBasis },
      ),
    }),
  );
  const coverage = await db
    .selectFrom('plan_schedule_coverage')
    .selectAll()
    .where('plan_version_id', '=', versionId)
    .orderBy('start_date')
    .execute();
  const findings: ValidationFinding[] = [];
  const generationRuns = await db
    .selectFrom('agent_runs')
    .selectAll()
    .where('execution_version_id', '=', versionId)
    .where('generation_start_date', 'is not', null)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const generations = generationRuns.flatMap((run) => {
    const generation = generationState(run);
    return generation ? [generation] : [];
  });
  const add = (code: string, message: string, severity: 'error' | 'warning' = 'error') =>
    findings.push({ code, message, severity, path: 'brief' });
  if (!brief.goal) add('brief.goal_required', 'Describe your running goal.');
  if (!version.start_date || !version.end_date)
    add('brief.dates_required', 'Set the plan start and end dates.');
  if (
    coverage.some(
      (c) =>
        !version.start_date ||
        !version.end_date ||
        String(c.start_date) < date(version.start_date)! ||
        String(c.end_date) > date(version.end_date)!,
    )
  )
    add('brief.coverage_outside_plan', 'Prescribed coverage must fit within the plan dates.');
  for (const [key, value] of Object.entries({
    weeklyDistance: brief.weeklyDistance,
    currentRuns: brief.currentRuns,
    longestRun: brief.longestRun,
  }))
    if (value.status === 'unanswered')
      add(`brief.${key}_unanswered`, `Answer ${key}, or choose unknown.`);
  const capacity = brief.weekdays.filter((day) => day !== 'unavailable').length * 2;
  if (!capacity) add('brief.allowed_day_required', 'Allow running on at least one weekday.');
  if (brief.desiredRuns === null)
    add('brief.desired_frequency_required', 'Choose your desired runs per week.');
  else if (brief.desiredRuns > capacity)
    add(
      'brief.desired_frequency_exceeds_capacity',
      'Allow enough days for at most two runs per day.',
    );
  if (!calibrations.length)
    add('brief.calibration_required', 'Enter a race result or estimated threshold pace.');
  if (
    brief.longestRun.value !== null &&
    brief.weeklyDistance.value !== null &&
    brief.longestRun.value > brief.weeklyDistance.value
  )
    add(
      'brief.longest_run_exceeds_weekly_distance',
      'Your longest run exceeds your typical weekly distance. Check that this represents your recent training.',
      'warning',
    );
  if (
    brief.currentRuns.value !== null &&
    brief.desiredRuns !== null &&
    brief.desiredRuns > brief.currentRuns.value + 2
  )
    add(
      'brief.frequency_increase_unusual',
      'Your desired frequency is more than two runs above your current frequency.',
      'warning',
    );
  return BriefStateSchema.parse({
    versionId,
    editNumber: version.edit_number,
    startDate: date(version.start_date),
    endDate: date(version.end_date),
    readOnly: readOnly || version.state === 'locked',
    brief,
    hash,
    confirmed: row?.confirmed_hash === hash,
    scheduleReviewRequired: row?.schedule_review_required ?? false,
    findings,
    coverage: coverage.map((c) => ({
      startDate: date(c.start_date)!,
      endDate: date(c.end_date)!,
      current: c.brief_hash === hash,
    })),
    generations,
    calibrations,
  });
}

async function ownedVersion(
  db: Database,
  athleteId: string,
  planId: string,
  versionId?: string,
  lock = false,
) {
  let query = db
    .selectFrom('plans')
    .selectAll()
    .where('id', '=', planId)
    .where('owner_id', '=', athleteId);
  if (lock) query = query.forUpdate();
  const plan = await query.executeTakeFirst();
  if (!plan) throw new PlanError('PLAN_NOT_FOUND', 'Plan not found.', 404);
  const id = versionId ?? plan.current_draft_version_id;
  if (!id) throw new PlanError('DRAFT_REQUIRED', 'Unlock the plan to edit its brief.');
  const version = await db
    .selectFrom('plan_versions')
    .selectAll()
    .where('id', '=', id)
    .where('plan_id', '=', planId)
    .executeTakeFirst();
  if (!version) throw new PlanError('VERSION_NOT_FOUND', 'Version not found.', 404);
  return { plan, version };
}
export async function getBrief(athleteId: string, planId: string, versionId?: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const { plan, version } = await ownedVersion(db, athleteId, planId, versionId);
      return readBrief(db, version.id, plan.archived_at !== null);
    });
}
async function mutate(
  athleteId: string,
  planId: string,
  command: z.infer<typeof BriefCommand>,
  run: (db: Database, state: Awaited<ReturnType<typeof readBrief>>) => Promise<void>,
  operation = 'save',
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const scope = `brief.${operation}:${planId}`;
      const requestHash = contentHash(semantic(command));
      if (command.idempotencyKey) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${athleteId}:${scope}:${command.idempotencyKey}`},0))`.execute(
          db,
        );
        const cached = await db
          .selectFrom('api_idempotency_keys')
          .selectAll()
          .where('athlete_id', '=', athleteId)
          .where('command_scope', '=', scope)
          .where('idempotency_key', '=', command.idempotencyKey)
          .executeTakeFirst();
        if (cached) {
          if (cached.request_hash !== requestHash)
            throw new PlanError(
              'IDEMPOTENCY_CONFLICT',
              'This request key was used for different input.',
            );
          return BriefStateSchema.parse(upgradeCachedBrief(cached.response_body));
        }
      }
      const { plan, version } = await ownedVersion(db, athleteId, planId, undefined, true);
      if (plan.archived_at || version.state !== 'draft')
        throw new PlanError('PLAN_READ_ONLY', 'This plan is read-only.');
      if (
        version.id !== command.expectedDraftId ||
        version.edit_number !== command.expectedEditNumber
      )
        throw new PlanError('STALE_DRAFT', 'The draft changed. Refresh and review your changes.');
      const state = await readBrief(db, version.id);
      await run(db, state);
      const result = await readBrief(db, version.id);
      if (command.idempotencyKey)
        await db
          .insertInto('api_idempotency_keys')
          .values({
            athlete_id: athleteId,
            command_scope: scope,
            idempotency_key: command.idempotencyKey,
            request_hash: requestHash,
            response_status: 200,
            response_body: JSON.parse(JSON.stringify(result)) as Json,
          })
          .execute();
      return result;
    });
}
// Responses cached before coverage and calibration provenance existed lack those fields.
function upgradeCachedBrief(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const state = body as Record<string, unknown>;
  return {
    coverage: [],
    ...state,
    calibrations: Array.isArray(state.calibrations)
      ? state.calibrations.map((c: unknown) =>
          c && typeof c === 'object'
            ? { provenance: 'user_supplied', estimateBasis: null, ...c }
            : c,
        )
      : state.calibrations,
  };
}
export async function changed(db: Database, id: string, clear: boolean, stale: boolean) {
  if (clear)
    await sql`UPDATE plan_briefs SET confirmed_hash = NULL, confirmed_at = NULL,
    confirmed_edit_number = NULL, validator_version = NULL, acknowledged_warning_codes = NULL,
    schedule_review_required = schedule_review_required OR (${stale} AND EXISTS (SELECT 1 FROM workouts WHERE plan_version_id = ${id}::uuid))
    WHERE plan_version_id = ${id}::uuid`.execute(db);
  await db
    .updateTable('plan_versions')
    .set({ edit_number: sql`edit_number + 1`, updated_at: new Date() })
    .where('id', '=', id)
    .execute();
}
export async function saveBrief(
  athleteId: string,
  planId: string,
  input: z.infer<typeof SaveBriefSchema>,
) {
  return mutate(athleteId, planId, input, async (db, state) => {
    await saveBriefRows(db, state, input.brief);
  });
}
export async function saveBriefRows(
  db: Database,
  state: Awaited<ReturnType<typeof readBrief>>,
  brief: z.infer<typeof BriefSchema>,
) {
  const b = brief;
  if (JSON.stringify(b) === JSON.stringify(state.brief)) return;
  const { unit: _a, ...oldFacts } = state.brief;
  const { unit: _b, ...newFacts } = b;
  const clear = contentHash(semantic(oldFacts)) !== contentHash(semantic(newFacts));
  await sql`INSERT INTO plan_briefs (plan_version_id, goal_text, distance_unit, timezone,
      weekly_distance_status, weekly_distance_metres, current_runs_status, current_runs_per_week,
      longest_run_status, longest_run_metres, desired_runs_per_week, context)
      VALUES (${state.versionId}::uuid, ${b.goal}, ${b.unit}, ${b.timezone}, ${b.weeklyDistance.status}, ${b.weeklyDistance.value},
      ${b.currentRuns.status}, ${b.currentRuns.value}, ${b.longestRun.status}, ${b.longestRun.value}, ${b.desiredRuns}, ${b.context})
      ON CONFLICT (plan_version_id) DO UPDATE SET goal_text = EXCLUDED.goal_text, distance_unit = EXCLUDED.distance_unit,
      timezone = EXCLUDED.timezone, weekly_distance_status = EXCLUDED.weekly_distance_status, weekly_distance_metres = EXCLUDED.weekly_distance_metres,
      current_runs_status = EXCLUDED.current_runs_status, current_runs_per_week = EXCLUDED.current_runs_per_week,
      longest_run_status = EXCLUDED.longest_run_status, longest_run_metres = EXCLUDED.longest_run_metres,
      desired_runs_per_week = EXCLUDED.desired_runs_per_week, context = EXCLUDED.context`.execute(
    db,
  );
  for (const [i, availability] of b.weekdays.entries())
    await sql`INSERT INTO plan_brief_weekdays (plan_version_id, weekday, availability) VALUES (${state.versionId}::uuid,${i + 1},${availability})
        ON CONFLICT (plan_version_id,weekday) DO UPDATE SET availability = EXCLUDED.availability`.execute(
      db,
    );
  await changed(db, state.versionId, clear, true);
}
export async function confirmBrief(
  athleteId: string,
  planId: string,
  input: z.infer<typeof ConfirmBriefSchema>,
) {
  return mutate(
    athleteId,
    planId,
    input,
    async (db, state) => {
      await confirmBriefRows(db, state, input);
    },
    'confirm',
  );
}
export async function confirmBriefRows(
  db: Database,
  state: Awaited<ReturnType<typeof readBrief>>,
  input: Pick<z.infer<typeof ConfirmBriefSchema>, 'expectedHash' | 'acknowledgedWarningCodes'>,
) {
  if (state.hash !== input.expectedHash)
    throw new PlanError('STALE_BRIEF', 'Review the current brief before confirming.');
  if (
    state.findings.some(
      (f) => f.severity === 'error' || !input.acknowledgedWarningCodes.includes(f.code),
    )
  )
    throw new PlanError('BRIEF_INVALID', 'Complete the brief and acknowledge each warning.', 422);
  await sql`UPDATE plan_briefs SET confirmed_hash = ${state.hash}, confirmed_at = now(), confirmed_edit_number = ${state.editNumber},
      validator_version = 1, acknowledged_warning_codes = ${input.acknowledgedWarningCodes}::text[] WHERE plan_version_id = ${state.versionId}::uuid`.execute(
    db,
  );
}
export async function addCalibration(
  athleteId: string,
  planId: string,
  input: z.infer<typeof CalibrationCommand>,
  now = new Date(),
) {
  return mutate(
    athleteId,
    planId,
    input,
    async (db, state) => {
      await addCalibrationRows(db, state, input, now);
    },
    'calibrate',
  );
}
export async function addCalibrationRows(
  db: Database,
  state: Awaited<ReturnType<typeof readBrief>>,
  input: Pick<z.infer<typeof CalibrationCommand>, 'input' | 'provenance' | 'estimateBasis'>,
  now = new Date(),
) {
  if (!state.startDate) throw new PlanError('DATES_REQUIRED', 'Set a plan start date first.', 422);
  if (
    !(
      await sql`SELECT 1 FROM plan_briefs WHERE plan_version_id = ${state.versionId}::uuid`.execute(
        db,
      )
    ).rows.length
  )
    throw new PlanError('BRIEF_REQUIRED', 'Save the brief before adding calibration.', 422);
  let calculated;
  try {
    calculated = calculatePaces(input.input);
  } catch (error) {
    throw new PlanError('CALIBRATION_INVALID', (error as Error).message, 422);
  }
  const latest = state.calibrations.at(-1);
  if (
    latest?.calculatorVersion === calculated.calculatorVersion &&
    latest.provenance === (input.provenance ?? 'user_supplied') &&
    latest.estimateBasis === (input.estimateBasis ?? null) &&
    latest.method === input.input.method &&
    (input.input.method === 'race_result'
      ? latest.distanceMetres === Number(input.input.distanceMetres.toFixed(3)) &&
        latest.durationSeconds === input.input.durationSeconds
      : latest.secondsPerKilometre === Number(input.input.secondsPerKilometre.toFixed(6)))
  )
    return;
  const profile = await sql<{
    id: string;
  }>`INSERT INTO calibration_profiles (plan_version_id, discipline, system, method, fitness_value,
      race_distance_metres, race_duration_seconds, threshold_seconds_per_kilometre, calculator_version, provenance, estimate_basis)
      VALUES (${state.versionId}::uuid,'run','run_pace',${input.input.method},${calculated.fitness},
      ${input.input.method === 'race_result' ? input.input.distanceMetres : null},
      ${input.input.method === 'race_result' ? input.input.durationSeconds : null},
      ${input.input.method === 'threshold_pace' ? input.input.secondsPerKilometre : null},${calculated.calculatorVersion}, ${input.provenance ?? 'user_supplied'}, ${input.estimateBasis ?? null}) RETURNING id`.execute(
    db,
  );
  const id = profile.rows[0]!.id;
  for (const zone of calculated.zones)
    await sql`INSERT INTO calibration_zones (plan_version_id,profile_id,zone_key,metric,minimum_value,target_value,maximum_value,unit)
      VALUES (${state.versionId}::uuid,${id}::uuid,${zone.key},'pace',${zone.fast},${zone.target},${zone.slow},'seconds_per_kilometre')`.execute(
      db,
    );
  await applyProfile(db, state, id, now);
}
async function applyProfile(
  db: Database,
  state: Awaited<ReturnType<typeof readBrief>>,
  id: string,
  now: Date,
) {
  const today = planToday(state.brief.timezone, now);
  const boundary =
    !state.calibrations.length || today < state.startDate! ? state.startDate! : today;
  // Replacing today's period also handles a profile inherited by unlocking today.
  await sql`DELETE FROM plan_calibration_periods WHERE plan_version_id = ${state.versionId}::uuid AND effective_from >= ${boundary}::date`.execute(
    db,
  );
  await sql`UPDATE plan_calibration_periods SET effective_until = ${boundary}::date WHERE plan_version_id = ${state.versionId}::uuid
    AND effective_from < ${boundary}::date AND (effective_until IS NULL OR effective_until > ${boundary}::date)`.execute(
    db,
  );
  await sql`INSERT INTO plan_calibration_periods (plan_version_id,profile_id,system,effective_from) VALUES (${state.versionId}::uuid,${id}::uuid,'run_pace',${boundary}::date)`.execute(
    db,
  );
  await sql`DELETE FROM calibration_zones z WHERE z.plan_version_id = ${state.versionId}::uuid AND NOT EXISTS (SELECT 1 FROM plan_calibration_periods p WHERE p.profile_id = z.profile_id)`.execute(
    db,
  );
  await sql`DELETE FROM calibration_profiles c WHERE c.plan_version_id = ${state.versionId}::uuid AND NOT EXISTS (SELECT 1 FROM plan_calibration_periods p WHERE p.profile_id = c.id)`.execute(
    db,
  );
  await changed(db, state.versionId, true, false);
}
export async function useCalibration(
  athleteId: string,
  planId: string,
  input: z.infer<typeof BriefCommand>,
  profileId: string,
  now = new Date(),
) {
  return mutate(
    athleteId,
    planId,
    input,
    async (db, state) => {
      if (!state.calibrations.some((c) => c.id === profileId))
        throw new PlanError('CALIBRATION_NOT_FOUND', 'Calibration not found.', 404);
      if (state.calibrations.at(-1)?.id === profileId) return;
      await applyProfile(db, state, profileId, now);
    },
    `reuse:${profileId}`,
  );
}

export async function briefLockFindings(
  db: Database,
  versionId: string,
): Promise<ValidationFinding[]> {
  const state = await readBrief(db, versionId);
  const findings = [...state.findings];
  const workouts = await db
    .selectFrom('workouts')
    .select(['scheduled_date', 'primary_discipline'])
    .where('plan_version_id', '=', versionId)
    .execute();
  const counts = new Map<string, number>();
  for (const workout of workouts.filter((w) => w.primary_discipline === 'run')) {
    const scheduled = date(workout.scheduled_date)!;
    counts.set(scheduled, (counts.get(scheduled) ?? 0) + 1);
  }
  for (const [scheduled, count] of counts) {
    const weekday = (new Date(`${scheduled}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (state.brief.weekdays[weekday] === 'unavailable')
      findings.push({
        code: `brief.unavailable_day:${scheduled}`,
        severity: 'error',
        message: `A run is scheduled on an unavailable day (${scheduled}).`,
        path: 'workouts',
      });
    if (count > 2)
      findings.push({
        code: `brief.too_many_daily_runs:${scheduled}`,
        severity: 'error',
        message: `More than two runs are scheduled on ${scheduled}.`,
        path: 'workouts',
      });
  }
  if (!state.confirmed)
    findings.push({
      code: 'brief.confirmation_required',
      severity: 'error',
      message: 'Review and confirm the current brief before locking.',
      path: 'brief',
    });
  if (state.scheduleReviewRequired)
    findings.push({
      code: 'brief.schedule_may_be_stale',
      severity: 'warning',
      message: 'Planning inputs changed. Review the existing schedule before locking.',
      path: 'brief',
    });
  if (state.generations?.at(-1)?.status === 'interrupted')
    findings.push({
      code: 'brief.generation_incomplete',
      severity: 'warning',
      message:
        'Generation stopped before the intended horizon was fully prescribed. Review the saved partial schedule before locking.',
      path: 'coverage',
    });
  return findings;
}
