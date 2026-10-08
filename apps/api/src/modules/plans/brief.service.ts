import { sql } from 'kysely';
import { generationState } from './schedule-generation.js';
import type { z } from '@hono/zod-openapi';
import { getDatabase } from '../../database/client.js';
import { PlanError } from './plan.service.js';
import { contentHash, type SemanticValue } from './plan.canonical.js';
import type { Database } from './plan.aggregate.js';
import type { Json } from '../../database/generated.js';
import { BRIEF_SPORTS, SPORT_NAMES } from './disciplines.js';
import {
  BriefSchema,
  BriefStateSchema,
  emptyBrief,
  type Brief,
  type SportBaseline,
  type SaveBriefSchema,
  type ConfirmBriefSchema,
  type BriefCommand,
} from './brief.schemas.js';
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
  const sportRows =
    await sql<Row>`SELECT * FROM plan_brief_sports WHERE plan_version_id = ${versionId}::uuid`.execute(
      db,
    );
  const brief = row
    ? BriefSchema.parse({
        goal: row.goal_text,
        unit: row.distance_unit,
        sports: sortSports(sportRows.rows.map(sportFromRow)),
        weekdays: days.rows.map((day) => day.availability),
        context: row.context,
      })
    : emptyBrief();
  const hash = contentHash(
    semantic({
      brief: hashedFacts(brief),
      startDate: date(version.start_date),
      endDate: date(version.end_date),
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
  if (!brief.goal) add('brief.goal_required', 'Describe your training goal.');
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
  if (!brief.sports.length) add('brief.sport_required', 'Choose at least one sport to train.');
  for (const sport of brief.sports) sportFindings(sport, add);
  const capacity = brief.weekdays.filter((day) => day !== 'unavailable').length * 2;
  const desired = brief.sports.reduce((total, sport) => total + (sport.desiredSessions ?? 0), 0);
  if (!capacity) add('brief.allowed_day_required', 'Allow training on at least one weekday.');
  else if (desired > capacity)
    add(
      'brief.desired_frequency_exceeds_capacity',
      'Allow enough days for at most two sessions per day.',
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
  });
}

/**
 * The facts a confirmation covers; display units are excluded. A running-only brief keeps the
 * shape it had before per-sport baselines, so confirmations and coverage recorded against
 * existing briefs (including locked versions) still match after the multi-sport migration.
 */
function hashedFacts({ unit: _unit, sports, ...rest }: Brief) {
  const [run] = sports;
  if (sports.length === 1 && run?.sport === 'run')
    return {
      ...rest,
      weeklyDistance: run.weeklyDistance,
      currentRuns: run.currentSessions,
      longestRun: run.longestDistance,
      desiredRuns: run.desiredSessions,
    };
  return { ...rest, sports };
}

const SPORT_ORDER = new Map<string, number>(BRIEF_SPORTS.map((sport, index) => [sport, index]));
function sortSports<Sport extends { sport: unknown }>(sports: Sport[]) {
  return [...sports].sort(
    (a, b) => SPORT_ORDER.get(String(a.sport))! - SPORT_ORDER.get(String(b.sport))!,
  );
}
const answer = (status: unknown, value: unknown) => ({ status, value: number(value) });
function sportFromRow(row: Row) {
  const common = {
    sport: row.sport,
    currentSessions: answer(row.current_sessions_status, row.current_sessions_per_week),
    desiredSessions: number(row.desired_sessions_per_week),
  };
  if (row.sport === 'strength') return common;
  const weekly = answer(row.weekly_volume_status, row.weekly_volume);
  const longest = answer(row.longest_session_status, row.longest_session);
  return row.sport === 'cycle'
    ? { ...common, weeklyDuration: weekly, longestDuration: longest }
    : { ...common, weeklyDistance: weekly, longestDistance: longest };
}
/** Weekly volume and longest session in their stored units: metres, or seconds for cycling. */
function volume(sport: SportBaseline) {
  if (sport.sport === 'strength') return null;
  return sport.sport === 'cycle'
    ? { weekly: sport.weeklyDuration, longest: sport.longestDuration }
    : { weekly: sport.weeklyDistance, longest: sport.longestDistance };
}
function sportFindings(
  sport: SportBaseline,
  add: (code: string, message: string, severity?: 'error' | 'warning') => void,
) {
  const name = SPORT_NAMES[sport.sport];
  const code = (suffix: string) => `brief.${sport.sport}.${suffix}`;
  const unit = sport.sport === 'cycle' ? 'time' : 'distance';
  const amounts = volume(sport);
  if (sport.currentSessions.status === 'unanswered')
    add(
      code('current_sessions_unanswered'),
      `Answer current ${name} sessions per week, or choose unknown.`,
    );
  if (amounts?.weekly.status === 'unanswered')
    add(
      code('weekly_volume_unanswered'),
      `Answer typical weekly ${name} ${unit}, or choose unknown.`,
    );
  if (amounts?.longest.status === 'unanswered')
    add(
      code('longest_session_unanswered'),
      `Answer your longest recent ${name} session, or choose unknown.`,
    );
  if (sport.desiredSessions === null)
    add(code('desired_frequency_required'), `Choose your desired ${name} sessions per week.`);
  if (
    amounts?.longest.value != null &&
    amounts.weekly.value != null &&
    amounts.longest.value > amounts.weekly.value
  )
    add(
      code('longest_exceeds_weekly'),
      `Your longest ${name} session exceeds your typical weekly ${name} ${unit}. Check that this represents your recent training.`,
      'warning',
    );
  if (
    sport.currentSessions.value !== null &&
    sport.desiredSessions !== null &&
    sport.desiredSessions > sport.currentSessions.value + 2
  )
    add(
      code('frequency_increase_unusual'),
      `Your desired ${name} frequency is more than two sessions above your current frequency.`,
      'warning',
    );
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
          return BriefStateSchema.parse(cached.response_body);
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
type DraftChangeEffect =
  'edit-only' | 'invalidate-confirmation' | 'invalidate-confirmation-and-review-schedule';

export async function recordDraftChange(db: Database, id: string, effect: DraftChangeEffect) {
  if (effect !== 'edit-only') {
    const reviewSchedule = effect === 'invalidate-confirmation-and-review-schedule';
    await sql`UPDATE plan_briefs SET confirmed_hash = NULL, confirmed_at = NULL,
    confirmed_edit_number = NULL, validator_version = NULL, acknowledged_warning_codes = NULL,
    schedule_review_required = schedule_review_required OR (${reviewSchedule} AND EXISTS (SELECT 1 FROM workouts WHERE plan_version_id = ${id}::uuid))
    WHERE plan_version_id = ${id}::uuid`.execute(db);
  }
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
  // Sports are stored and read in a fixed order; compare like with like.
  const b = { ...brief, sports: sortSports(brief.sports) };
  if (JSON.stringify(b) === JSON.stringify(state.brief)) return;
  const clear =
    contentHash(semantic(hashedFacts(state.brief))) !== contentHash(semantic(hashedFacts(b)));
  await sql`INSERT INTO plan_briefs (plan_version_id, goal_text, distance_unit, context)
      VALUES (${state.versionId}::uuid, ${b.goal}, ${b.unit}, ${b.context})
      ON CONFLICT (plan_version_id) DO UPDATE SET goal_text = EXCLUDED.goal_text,
      distance_unit = EXCLUDED.distance_unit, context = EXCLUDED.context`.execute(db);
  // Upsert by sport so a baseline keeps its lineage across edits and versions.
  await sql`DELETE FROM plan_brief_sports WHERE plan_version_id = ${state.versionId}::uuid
      AND NOT (sport = ANY(${b.sports.map((sport) => sport.sport)}::text[]))`.execute(db);
  for (const sport of b.sports) {
    const amounts = volume(sport);
    await sql`INSERT INTO plan_brief_sports (plan_version_id, sport, current_sessions_status,
        current_sessions_per_week, desired_sessions_per_week, weekly_volume_status, weekly_volume,
        longest_session_status, longest_session)
        VALUES (${state.versionId}::uuid, ${sport.sport}, ${sport.currentSessions.status},
        ${sport.currentSessions.value}, ${sport.desiredSessions}, ${amounts?.weekly.status ?? null},
        ${amounts?.weekly.value ?? null}, ${amounts?.longest.status ?? null}, ${amounts?.longest.value ?? null})
        ON CONFLICT (plan_version_id, sport) DO UPDATE SET
        current_sessions_status = EXCLUDED.current_sessions_status,
        current_sessions_per_week = EXCLUDED.current_sessions_per_week,
        desired_sessions_per_week = EXCLUDED.desired_sessions_per_week,
        weekly_volume_status = EXCLUDED.weekly_volume_status, weekly_volume = EXCLUDED.weekly_volume,
        longest_session_status = EXCLUDED.longest_session_status,
        longest_session = EXCLUDED.longest_session`.execute(db);
  }
  for (const [i, availability] of b.weekdays.entries())
    await sql`INSERT INTO plan_brief_weekdays (plan_version_id, weekday, availability) VALUES (${state.versionId}::uuid,${i + 1},${availability})
        ON CONFLICT (plan_version_id,weekday) DO UPDATE SET availability = EXCLUDED.availability`.execute(
      db,
    );
  await recordDraftChange(
    db,
    state.versionId,
    clear ? 'invalidate-confirmation-and-review-schedule' : 'edit-only',
  );
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
export async function briefLockFindings(
  db: Database,
  versionId: string,
): Promise<ValidationFinding[]> {
  const state = await readBrief(db, versionId);
  const findings = [...state.findings];
  const workouts = await db
    .selectFrom('workouts')
    .select('scheduled_date')
    .where('plan_version_id', '=', versionId)
    .execute();
  const counts = new Map<string, number>();
  for (const workout of workouts) {
    const scheduled = date(workout.scheduled_date)!;
    counts.set(scheduled, (counts.get(scheduled) ?? 0) + 1);
  }
  for (const [scheduled, count] of counts) {
    const weekday = (new Date(`${scheduled}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (state.brief.weekdays[weekday] === 'unavailable')
      findings.push({
        code: `brief.unavailable_day:${scheduled}`,
        severity: 'error',
        message: `A session is scheduled on an unavailable day (${scheduled}).`,
        path: 'workouts',
      });
    if (count > 2)
      findings.push({
        code: `brief.too_many_daily_sessions:${scheduled}`,
        severity: 'error',
        message: `More than two sessions are scheduled on ${scheduled}.`,
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
