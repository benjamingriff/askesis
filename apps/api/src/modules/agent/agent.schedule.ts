import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { z } from 'zod';
import type { DB } from '../../database/generated.js';
import { Id } from '../plans/plan.common.js';
import { PlanError } from '../plans/plan.service.js';
import { readBrief, changed } from '../plans/brief.service.js';
import { readAggregate } from '../plans/plan.aggregate.js';
import { validatePlan } from '../plans/plan.validation.js';
import type { ScheduleSchema, CoverageSchema } from './agent.schemas.js';

type Tx = Transaction<DB>;
type Schedule = z.infer<typeof ScheduleSchema>;
type Range = z.infer<typeof CoverageSchema>;
const bad = (message: string): never => {
  throw new PlanError('SCHEDULE_INVALID', message, 422);
};
const day = (value: string, delta: number) =>
  new Date(Date.parse(`${value}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
const inside = (start: string, end: string, range: Range) =>
  start >= range.startDate && end <= range.endDate;

export async function writeSchedule(db: Tx, versionId: string, input: Schedule, range?: Range) {
  const version = await db
    .selectFrom('plan_versions')
    .selectAll()
    .where('id', '=', versionId)
    .executeTakeFirstOrThrow();
  const state = await readBrief(db, versionId);
  const planRange =
    version.start_date && version.end_date
      ? { startDate: String(version.start_date), endDate: String(version.end_date) }
      : null;
  if (!planRange) return bad('Set plan dates before prescribing workouts.');
  for (const part of [range, input.coverage].filter((p): p is Range => !!p))
    if (part.endDate < part.startDate || !inside(part.startDate, part.endDate, planRange))
      bad('The prescribed range must fit within the plan dates.');
  if (range && input.coverage && !inside(input.coverage.startDate, input.coverage.endDate, range))
    bad('Replacement coverage must fit inside its explicit range.');
  if (input.workouts.reduce((n, w) => n + w.steps.length, 0) > 2000)
    bad('This batch contains too many prescription steps.');
  if (
    range &&
    (input.deleteWorkoutIds.length || input.deleteWeekIds.length || input.deleteBlockIds.length)
  )
    bad('Range replacement determines deletions from dates; explicit deletions are not allowed.');
  const blockIds = new Map<string, string>();
  const weekIds = new Map<string, string>();
  const result: Record<string, string> = {};
  const keys = new Set<string>();
  for (const entity of [...input.blocks, ...input.weeks, ...input.workouts]) {
    if (keys.has(entity.key)) bad('Use unique local keys within each batch.');
    keys.add(entity.key);
  }
  async function existing(table: 'training_blocks' | 'training_weeks' | 'workouts', id: string) {
    // Unknown local keys fall through as raw strings; reject them before Postgres sees a bad uuid.
    if (!Id.safeParse(id).success) bad('Referenced content does not belong to this draft.');
    const row = await db
      .selectFrom(table)
      .selectAll()
      .where('plan_version_id', '=', versionId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) bad('Referenced content does not belong to this draft.');
    return row;
  }
  if (range) {
    await db
      .deleteFrom('workouts')
      .where('plan_version_id', '=', versionId)
      .where('scheduled_date', '>=', sql<Date>`${range.startDate}::date`)
      .where('scheduled_date', '<=', sql<Date>`${range.endDate}::date`)
      .execute();
    // Preserve all structural parents. The caller can reuse their IDs, including
    // weeks spanning the range boundary, without touching unrelated prescriptions.
  }
  for (const [table, ids] of [
    ['workouts', input.deleteWorkoutIds],
    ['training_weeks', input.deleteWeekIds],
    ['training_blocks', input.deleteBlockIds],
  ] as const) {
    for (const id of ids) {
      await existing(table, id);
      await db
        .deleteFrom(table)
        .where('id', '=', id)
        .where('plan_version_id', '=', versionId)
        .execute();
    }
  }
  for (const b of input.blocks) {
    if (b.endDate < b.startDate) bad('Block dates are reversed.');
    if (range && b.id)
      bad(
        'Reuse existing block IDs as parent keys; range replacement cannot edit existing blocks.',
      );
    if (range && !inside(b.startDate, b.endDate, range))
      bad('New blocks must fit inside the replacement range.');
    if (b.id) await existing('training_blocks', b.id);
    const id = b.id ?? randomUUID();
    const values = {
      title: b.title,
      description: b.description,
      start_date: b.startDate,
      end_date: b.endDate,
      position: b.position,
    };
    if (b.id) await db.updateTable('training_blocks').set(values).where('id', '=', id).execute();
    else
      await db
        .insertInto('training_blocks')
        .values({ id, plan_version_id: versionId, ...values })
        .execute();
    blockIds.set(b.key, id);
    result[b.key] = id;
  }
  for (const w of input.weeks) {
    if (w.endDate < w.startDate) bad('Week dates are reversed.');
    if (range && w.id)
      bad('Reuse existing week IDs as parent keys; range replacement cannot edit existing weeks.');
    if (range && !inside(w.startDate, w.endDate, range))
      bad('New weeks must fit inside the replacement range.');
    if (w.id) await existing('training_weeks', w.id);
    const parent = blockIds.get(w.blockKey) ?? w.blockKey;
    await existing('training_blocks', parent);
    const id = w.id ?? randomUUID();
    const values = {
      block_id: parent,
      week_number: w.weekNumber,
      position: w.position,
      title: w.title,
      description: w.description,
      start_date: w.startDate,
      end_date: w.endDate,
    };
    if (w.id) await db.updateTable('training_weeks').set(values).where('id', '=', id).execute();
    else
      await db
        .insertInto('training_weeks')
        .values({ id, plan_version_id: versionId, ...values })
        .execute();
    weekIds.set(w.key, id);
    result[w.key] = id;
  }
  for (const w of input.workouts) {
    if (range && (!inside(w.date, w.date, range) || w.id))
      bad('Range replacement accepts new workouts only, dated within its range.');
    if (w.id) await existing('workouts', w.id);
    const week = weekIds.get(w.weekKey) ?? w.weekKey;
    await existing('training_weeks', week);
    const id = w.id ?? randomUUID();
    const values = {
      week_id: week,
      scheduled_date: w.date,
      position: w.position,
      title: w.title,
      description: w.description,
      purpose: w.purpose,
      primary_discipline: 'run',
      priority: w.priority,
      estimated_duration_seconds: w.estimatedDurationSeconds,
      estimated_distance_metres: w.estimatedDistanceMetres,
    };
    if (w.id) {
      await db
        .updateTable('workouts')
        .set({ ...values, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await db.deleteFrom('workout_tags').where('workout_id', '=', id).execute();
      await db.deleteFrom('workout_steps').where('workout_id', '=', id).execute();
    } else
      await db
        .insertInto('workouts')
        .values({ id, plan_version_id: versionId, ...values })
        .execute();
    for (const tag of new Set(w.tags))
      await db
        .insertInto('workout_tags')
        .values({ workout_id: id, plan_version_id: versionId, tag })
        .execute();
    const stepIds: string[] = [];
    const siblingCounts = new Map<number | null, number>();
    for (const [i, s] of w.steps.entries()) {
      if (
        (i === 0 && s.parentIndex !== null) ||
        (i > 0 && (s.parentIndex === null || s.parentIndex >= i))
      )
        bad('Steps need one root, with every child pointing to an earlier parent.');
      if (s.parentIndex !== null && w.steps[s.parentIndex]?.kind === 'effort')
        bad('Effort steps cannot contain children.');
      const children = w.steps.filter((c) => c.parentIndex === i);
      if (
        s.kind === 'effort'
          ? !s.completion || children.length > 0 || s.repeatCount !== null
          : !!s.completion ||
            s.targets.length > 0 ||
            !children.length ||
            (s.kind === 'repeat' ? s.repeatCount === null : s.repeatCount !== null)
      )
        bad('Provide complete effort steps and valid sequence/repeat containers.');
      const sid = randomUUID();
      stepIds.push(sid);
      const position = (siblingCounts.get(s.parentIndex) ?? 0) + 1;
      siblingCounts.set(s.parentIndex, position);
      await db
        .insertInto('workout_steps')
        .values({
          id: sid,
          plan_version_id: versionId,
          workout_id: id,
          parent_step_id: s.parentIndex === null ? null : stepIds[s.parentIndex]!,
          position,
          kind: s.kind,
          discipline: s.kind === 'effort' ? 'run' : null,
          repeat_count: s.repeatCount,
          role: s.role,
          label: s.label,
          instructions: s.instructions,
        })
        .execute();
      if (s.completion)
        await db
          .insertInto('step_completions')
          .values({
            step_id: sid,
            plan_version_id: versionId,
            completion_type: s.completion.type,
            numeric_value: s.completion.type === 'open' ? null : s.completion.value,
            unit: s.completion.type === 'open' ? null : s.completion.unit,
          })
          .execute();
      for (const [j, t] of s.targets.entries())
        await db
          .insertInto('step_targets')
          .values({
            step_id: sid,
            plan_version_id: versionId,
            position: j + 1,
            target_type: t.type,
            zone_system: t.type === 'zone' ? 'run_pace' : null,
            zone_key: t.type === 'zone' ? t.key : null,
            target_value:
              t.type === 'pace' ? t.secondsPerKilometre : t.type === 'rpe' ? t.value : null,
            unit: t.type === 'pace' ? 'seconds_per_kilometre' : t.type === 'rpe' ? 'rpe' : null,
            text_value: t.type === 'instruction' ? t.text : null,
          })
          .execute();
    }
    result[w.key] = id;
  }
  const findings = validatePlan((await readAggregate(db, versionId)).validation);
  if (findings.some((f) => f.severity === 'error'))
    bad(
      findings
        .filter((f) => f.severity === 'error')
        .map((f) => f.message)
        .join(' '),
    );
  // Availability is a hard planning constraint, even before human confirmation.
  const all = await db
    .selectFrom('workouts')
    .select('scheduled_date')
    .where('plan_version_id', '=', versionId)
    .execute();
  const daily = new Map<string, number>();
  for (const w of all) {
    const d = String(w.scheduled_date);
    const weekday = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (state.brief.weekdays[weekday] === 'unavailable')
      bad('A workout falls on an unavailable weekday.');
    daily.set(d, (daily.get(d) ?? 0) + 1);
    if (daily.get(d)! > 2) bad('At most two runs can be scheduled per day.');
  }
  if (range) await removeCoverage(db, versionId, range);
  if (input.coverage) {
    await removeCoverage(db, versionId, input.coverage);
    await db
      .insertInto('plan_schedule_coverage')
      .values({
        plan_version_id: versionId,
        start_date: input.coverage.startDate,
        end_date: input.coverage.endDate,
        brief_hash: state.hash,
      })
      .execute();
  }
  const coverage = await db
    .selectFrom('plan_schedule_coverage')
    .selectAll()
    .where('plan_version_id', '=', versionId)
    .execute();
  // Clear the stale review flag only when all existing workout dates have coverage
  // based on the current assumptions. A one-workout edit cannot clear it.
  if (
    input.coverage &&
    coverage.every((c) => c.brief_hash === state.hash) &&
    all.every((w) =>
      coverage.some(
        (c) =>
          c.brief_hash === state.hash &&
          String(c.start_date) <= String(w.scheduled_date) &&
          String(c.end_date) >= String(w.scheduled_date),
      ),
    )
  )
    await sql`UPDATE plan_briefs SET schedule_review_required = false WHERE plan_version_id = ${versionId}::uuid`.execute(
      db,
    );
  await changed(db, versionId, false, false);
  return { ids: result, findings };
}
async function removeCoverage(db: Tx, versionId: string, range: Range) {
  const overlaps = await db
    .selectFrom('plan_schedule_coverage')
    .selectAll()
    .where('plan_version_id', '=', versionId)
    .where('start_date', '<=', sql<Date>`${range.endDate}::date`)
    .where('end_date', '>=', sql<Date>`${range.startDate}::date`)
    .execute();
  for (const c of overlaps) {
    await db.deleteFrom('plan_schedule_coverage').where('id', '=', c.id).execute();
    const start = String(c.start_date),
      end = String(c.end_date);
    if (start < range.startDate)
      await db
        .insertInto('plan_schedule_coverage')
        .values({
          plan_version_id: versionId,
          start_date: start,
          end_date: day(range.startDate, -1),
          brief_hash: c.brief_hash,
        })
        .execute();
    if (end > range.endDate)
      await db
        .insertInto('plan_schedule_coverage')
        .values({
          plan_version_id: versionId,
          start_date: day(range.endDate, 1),
          end_date: end,
          brief_hash: c.brief_hash,
        })
        .execute();
  }
}
