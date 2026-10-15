import { sql, type Transaction, type Selectable } from 'kysely';
import type { z } from 'zod';
import { getDatabase } from '../../database/client.js';
import type { DB, Json } from '../../database/generated.js';
import { localDate } from '../athletes/timezone.js';
import type { Database } from '../plans/plan.aggregate.js';
import { PlanError } from '../plans/plan.common.js';
import { contentHash, type SemanticValue } from '../plans/plan.canonical.js';
import { listWorkouts } from '../workouts/workout.repository.js';
import { inferSessionType } from '../workouts/session-types.js';
import { loadPlannedRpe } from './planned-rpe.js';
import { summarizeTraining } from './training-log.summary.js';
import {
  LogInputSchema,
  LogSchema,
  CheckInSchema,
  TrainingLogSchema,
  ReferenceSchema,
  type LogInput,
  type CheckInInput,
  type ReferenceInput,
  type FeedbackReference,
} from './training-log.schemas.js';
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);
const date = (v: Date | string) => iso(v).slice(0, 10);
const number = (v: string | number | null) => (v === null ? null : Number(v));
export function logView(row: Selectable<DB['workout_logs']>) {
  return LogSchema.parse({
    id: row.id,
    planId: row.plan_id,
    lineageId: row.workout_lineage_id,
    loggedVersionId: row.logged_version_id,
    scheduledOn: date(row.scheduled_on),
    title: row.title,
    discipline: row.discipline,
    sessionType: row.session_type,
    keySession: row.key_session,
    placeholder: row.placeholder,
    actualSessionType: row.actual_session_type,
    plannedDurationSeconds: row.planned_duration_seconds,
    plannedDistanceMetres: number(row.planned_distance_metres),
    plannedRpe: number(row.planned_rpe),
    status: row.status,
    performedOn: date(row.performed_on),
    actualDurationSeconds: row.actual_duration_seconds,
    actualDistanceMetres: number(row.actual_distance_metres),
    rpe: row.rpe,
    feel: row.feel,
    reasons: row.reasons,
    answers: row.answers,
    answersSchemaVersion: row.answers_schema_version,
    note: row.note,
    source: row.source,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
function checkInView(row: Selectable<DB['athlete_check_ins']>) {
  return CheckInSchema.parse({
    id: row.id,
    planId: row.plan_id,
    kind: row.kind,
    details: row.details,
    startsOn: date(row.starts_on),
    endsOn: row.ends_on ? date(row.ends_on) : null,
    createdAt: iso(row.created_at),
  });
}
async function ownedPlan(db: Database, owner: string, planId: string, write = false) {
  let q = db.selectFrom('plans').selectAll().where('id', '=', planId).where('owner_id', '=', owner);
  if (write) q = q.forUpdate();
  const plan = await q.executeTakeFirst();
  if (!plan) throw new PlanError('PLAN_NOT_FOUND', 'Plan not found.', 404);
  if (write && plan.archived_at)
    throw new PlanError('PLAN_ARCHIVED', 'Unarchive the plan before changing its log.');
  return plan;
}
async function todayFor(db: Database, owner: string, now = new Date()) {
  const athlete = await db
    .selectFrom('athletes')
    .select('timezone')
    .where('id', '=', owner)
    .executeTakeFirstOrThrow();
  return localDate(athlete.timezone, now);
}
export async function readRecentTrainingLog(db: Database, owner: string) {
  const today = await todayFor(db, owner);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 13 * 86400000)
    .toISOString()
    .slice(0, 10);
  return readTrainingLog(db, owner, { from, to: today });
}
export async function readTrainingLog(
  db: Database,
  owner: string,
  options: { planId?: string | undefined; from?: string | undefined; to?: string | undefined } = {},
  now = new Date(),
) {
  if (options.planId) await ownedPlan(db, owner, options.planId);
  const today = await todayFor(db, owner, now);
  const from = options.from ?? '1900-01-01',
    to = options.to ?? '9999-12-31';
  if (to < from) throw new PlanError('LOG_RANGE_INVALID', 'End date precedes start date.', 422);
  let lq = db.selectFrom('workout_logs').selectAll().where('athlete_id', '=', owner);
  let cq = db
    .selectFrom('athlete_check_ins')
    .selectAll()
    .where('athlete_id', '=', owner)
    .where('starts_on', '<=', sql<Date>`${to}::date`)
    .where((eb) =>
      eb.or([eb('ends_on', 'is', null), eb('ends_on', '>=', sql<Date>`${from}::date`)]),
    );
  let pq = db
    .selectFrom('plans')
    .select(['id', 'current_locked_version_id'])
    .where('owner_id', '=', owner);
  if (options.planId) {
    lq = lq.where('plan_id', '=', options.planId);
    cq = cq.where('plan_id', '=', options.planId);
    pq = pq.where('id', '=', options.planId);
  }
  const [rows, checks, plans, recorded] = await Promise.all([
    lq
      .where('performed_on', '>=', sql<Date>`${from}::date`)
      .where('performed_on', '<=', sql<Date>`${to}::date`)
      .orderBy('performed_on')
      .orderBy('created_at')
      .execute(),
    cq.orderBy('starts_on').execute(),
    pq.execute(),
    lq.clearSelect().select(['plan_id', 'workout_lineage_id']).execute(),
  ]);
  const logs = rows.map(logView);
  const workouts = (
    await Promise.all(
      plans
        .filter((p) => p.current_locked_version_id)
        .map((p) => listWorkouts(owner, p.current_locked_version_id!, db)),
    )
  )
    .flat()
    .filter((w) => w.scheduledDate >= from && w.scheduledDate <= to);
  return TrainingLogSchema.parse({
    today,
    logs,
    checkIns: checks.map(checkInView),
    summary: summarizeTraining(
      workouts,
      logs,
      today,
      recorded.map((l) => ({
        planId: l.plan_id,
        lineageId: l.workout_lineage_id,
      })),
    ),
  });
}
function validateAnswers(input: LogInput, type: string | null, discipline: string) {
  const a = input.answers ?? {};
  const fail = () => {
    throw new PlanError('LOG_ANSWERS_INVALID', 'These answers do not apply to this session.', 422);
  };
  if (a.intervals && !['intervals', 'tempo', 'speed'].includes(type ?? '')) fail();
  if ((a.finish || a.fuelled) && type !== 'long') fail();
  if ((a.weights || a.weightsUsed) && type !== 'strength') fail();
  if (a.hardestPart && type !== 'brick') fail();
  if (a.race && type !== 'race') fail();
  if ((a.painArea || a.painSeverity) && !input.reasons?.includes('pain')) fail();
  if (a.result) {
    if (input.status === 'skipped' || !['test', 'race'].includes(type ?? '')) fail();
    if (
      a.result.system !==
      ({ run: 'run_pace', cycle: 'cycle_power', swim: 'swim_pace' } as Record<string, string>)[
        discipline
      ]
    )
      fail();
  }
}
export async function saveLogRows(
  db: Transaction<DB>,
  owner: string,
  planId: string,
  lineageId: string,
  raw: LogInput,
  options: { runId?: string | undefined; now?: Date | undefined } = {},
) {
  const input = LogInputSchema.parse(raw);
  const plan = await ownedPlan(db, owner, planId, true);
  const today = await todayFor(db, owner, options.now);
  const existing = await db
    .selectFrom('workout_logs')
    .selectAll()
    .where('plan_id', '=', planId)
    .where('athlete_id', '=', owner)
    .where('workout_lineage_id', '=', lineageId)
    .executeTakeFirst();
  let snapshot:
    | Pick<
        Selectable<DB['workout_logs']>,
        | 'title'
        | 'discipline'
        | 'session_type'
        | 'key_session'
        | 'placeholder'
        | 'logged_version_id'
        | 'scheduled_on'
        | 'planned_duration_seconds'
        | 'planned_distance_metres'
        | 'planned_rpe'
      >
    | undefined;
  if (!existing) {
    if (!plan.current_locked_version_id)
      throw new PlanError('LOCKED_SCHEDULE_REQUIRED', 'Lock a schedule before logging it.');
    const w = await db
      .selectFrom('workouts')
      .selectAll()
      .where('plan_version_id', '=', plan.current_locked_version_id)
      .where('lineage_id', '=', lineageId)
      .executeTakeFirst();
    if (!w)
      throw new PlanError('WORKOUT_NOT_FOUND', 'Workout not found in the locked schedule.', 404);
    const scheduled = date(w.scheduled_date);
    if (scheduled > today)
      throw new PlanError(
        'WORKOUT_IN_FUTURE',
        'Log a workout from its scheduled date onwards.',
        422,
      );
    const effort = await loadPlannedRpe(db, owner, [
      { id: w.id, date: scheduled, discipline: w.primary_discipline },
    ]);
    // Insertable values (rather than ColumnType) are inferred by Kysely at the insert boundary.
    snapshot = {
      title: w.title,
      discipline: w.primary_discipline,
      session_type:
        w.session_type ??
        inferSessionType({
          title: w.title,
          discipline: w.primary_discipline,
          racePriority: w.race_priority,
        }),
      key_session: w.priority === 'high' || w.race_priority !== null,
      placeholder: w.placeholder,
      logged_version_id: w.plan_version_id,
      scheduled_on: w.scheduled_date,
      planned_duration_seconds: w.estimated_duration_seconds,
      planned_distance_metres: w.estimated_distance_metres,
      planned_rpe: effort.get(w.id) == null ? null : String(effort.get(w.id)),
    };
  }
  const original = existing ?? snapshot!;
  const performed = input.performedOn ?? date(original.scheduled_on);
  if (
    performed > today ||
    (input.answers?.result?.observedOn && input.answers.result.observedOn > today)
  )
    throw new PlanError('LOG_IN_FUTURE', 'Actual training cannot be dated after today.', 422);
  if (input.actualSessionType && !original.placeholder)
    throw new PlanError(
      'LOG_ANSWERS_INVALID',
      'Only placeholder sessions record what they turned out to be.',
      422,
    );
  // Follow-up questions apply to what a placeholder turned out to be.
  validateAnswers(input, input.actualSessionType ?? original.session_type, original.discipline);
  const skipped = input.status === 'skipped';
  const values = {
    status: input.status,
    performed_on: performed,
    actual_duration_seconds: skipped
      ? null
      : input.actualDurationSeconds === undefined
        ? input.status === 'done'
          ? original.planned_duration_seconds
          : null
        : input.actualDurationSeconds,
    actual_distance_metres: skipped
      ? null
      : input.actualDistanceMetres === undefined
        ? input.status === 'done'
          ? original.planned_distance_metres
          : null
        : input.actualDistanceMetres,
    rpe: skipped ? null : (input.rpe ?? null),
    feel: input.feel ?? null,
    reasons: [...new Set(input.reasons ?? [])],
    answers: json(input.answers ?? {}),
    note: input.note ?? null,
    actual_session_type: skipped ? null : (input.actualSessionType ?? null),
    source: options.runId ? 'coach' : 'manual',
    recorded_by_run_id: options.runId ?? null,
    updated_at: new Date(),
  };
  const row = existing
    ? await db
        .updateTable('workout_logs')
        .set(values)
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await db
        .insertInto('workout_logs')
        .values({
          ...snapshot!,
          ...values,
          athlete_id: owner,
          plan_id: planId,
          workout_lineage_id: lineageId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
  return logView(row);
}
export async function clearLogRows(
  db: Transaction<DB>,
  owner: string,
  planId: string,
  lineageId: string,
) {
  await ownedPlan(db, owner, planId, true);
  await db
    .deleteFrom('workout_logs')
    .where('athlete_id', '=', owner)
    .where('plan_id', '=', planId)
    .where('workout_lineage_id', '=', lineageId)
    .execute();
  return { cleared: true };
}
/** Cache mutation outcomes so a retry cannot recreate a log after a later clear. */
export async function logCommand<T>(
  owner: string,
  scope: string,
  key: string | undefined,
  input: unknown,
  schema: z.ZodType<T>,
  run: (db: Transaction<DB>) => Promise<T>,
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const hash = contentHash(json(input) as SemanticValue);
      if (key) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([owner, scope, key])},0))`.execute(
          db,
        );
        const cached = await db
          .selectFrom('api_idempotency_keys')
          .selectAll()
          .where('athlete_id', '=', owner)
          .where('command_scope', '=', scope)
          .where('idempotency_key', '=', key)
          .executeTakeFirst();
        if (cached) {
          if (cached.request_hash !== hash)
            throw new PlanError(
              'IDEMPOTENCY_CONFLICT',
              'Request key was used for different input.',
            );
          return schema.parse(cached.response_body);
        }
      }
      const response = await run(db);
      if (key)
        await db
          .insertInto('api_idempotency_keys')
          .values({
            athlete_id: owner,
            command_scope: scope,
            idempotency_key: key,
            request_hash: hash,
            response_status: 200,
            response_body: json(response),
          })
          .execute();
      return response;
    });
}
export async function createCheckInRows(db: Transaction<DB>, owner: string, input: CheckInInput) {
  await ownedPlan(db, owner, input.planId, true);
  const today = await todayFor(db, owner);
  if (input.startsOn > today)
    throw new PlanError('CHECK_IN_IN_FUTURE', 'A check-in starts today or earlier.', 422);
  const row = await db
    .insertInto('athlete_check_ins')
    .values({
      athlete_id: owner,
      plan_id: input.planId,
      kind: input.kind,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      details: json(input.details),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return checkInView(row);
}
export async function feedbackReferences(
  db: Database,
  owner: string,
  planId: string | null,
  inputs: ReferenceInput[],
): Promise<FeedbackReference[]> {
  const out: FeedbackReference[] = [];
  for (const ref of inputs) {
    if (ref.type === 'workout_log') {
      const row = await db
        .selectFrom('workout_logs')
        .selectAll()
        .where('id', '=', ref.logId)
        .where('athlete_id', '=', owner)
        .executeTakeFirst();
      if (!row || row.plan_id !== planId)
        throw new PlanError(
          'FEEDBACK_NOT_FOUND',
          'Workout feedback not found for this conversation.',
          404,
        );
      out.push({ type: 'workout_log', logId: row.id, snapshot: logView(row) });
    } else {
      const row = await db
        .selectFrom('athlete_check_ins')
        .selectAll()
        .where('id', '=', ref.checkInId)
        .where('athlete_id', '=', owner)
        .executeTakeFirst();
      if (!row || row.plan_id !== planId)
        throw new PlanError('FEEDBACK_NOT_FOUND', 'Check-in not found for this conversation.', 404);
      out.push({ type: 'check_in', checkInId: row.id, snapshot: checkInView(row) });
    }
  }
  return out;
}
export async function resolveFeedback(db: Database, owner: string, raw: Json | null) {
  const refs = raw ? ReferenceSchema.array().parse(raw) : [];
  return Promise.all(
    refs.map(async (ref) => {
      if (ref.type === 'check_in') return { ...ref, state: 'saved' };
      const row = await db
        .selectFrom('workout_logs')
        .selectAll()
        .where('id', '=', ref.logId)
        .where('athlete_id', '=', owner)
        .executeTakeFirst();
      const current = row ? logView(row) : null;
      return {
        ...ref,
        current,
        state: current
          ? JSON.stringify(current) === JSON.stringify(ref.snapshot)
            ? 'saved'
            : 'changed'
          : 'cleared',
      };
    }),
  );
}
