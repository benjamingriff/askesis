import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { z } from 'zod';
import type { DB } from '../../database/generated.js';
import { Id } from '../plans/plan.common.js';
import { PlanError } from '../plans/plan.service.js';
import { readBrief, recordDraftChange } from '../plans/brief.service.js';
import { readAggregate } from '../plans/plan.aggregate.js';
import { validatePlan } from '../plans/plan.validation.js';
import { nearestZone } from '../performance/run-pace.calculator.js';
import { CALIBRATORS, systemForDiscipline } from '../performance/performance.calibrators.js';
import { readEntries, resolveCalibration } from '../performance/performance.service.js';
import { SPORT_NAMES, type StepDiscipline } from '../plans/disciplines.js';
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

export async function writeSchedule(
  db: Tx,
  versionId: string,
  input: Schedule,
  runId: string,
  range?: Range,
) {
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
  for (const part of [range, input.coverage, input.generation].filter((p): p is Range => !!p))
    if (part.endDate < part.startDate || !inside(part.startDate, part.endDate, planRange))
      bad('The prescribed range must fit within the plan dates.');
  if (range && input.coverage && !inside(input.coverage.startDate, input.coverage.endDate, range))
    bad('Replacement coverage must fit inside its explicit range.');
  const run = await db
    .selectFrom('agent_runs')
    .selectAll()
    .where('id', '=', runId)
    .executeTakeFirstOrThrow();
  let intended: Range;
  if (run.generation_start_date && run.generation_end_date) {
    intended = {
      startDate: String(run.generation_start_date),
      endDate: String(run.generation_end_date),
    };
    if (
      input.generation &&
      (input.generation.startDate !== intended.startDate ||
        input.generation.endDate !== intended.endDate)
    )
      bad(
        'Keep this run’s original generation horizon; continue a different horizon in a new turn.',
      );
  } else {
    if (!input.generation)
      throw new PlanError(
        'GENERATION_REQUIRED',
        'Set generation to the full intended horizon on the first schedule batch.',
        422,
      );
    intended = input.generation;
    await db
      .updateTable('agent_runs')
      .set({ generation_start_date: intended.startDate, generation_end_date: intended.endDate })
      .where('id', '=', runId)
      .execute();
    // Previous coverage cannot make an unfinished regeneration appear complete.
    // Workouts remain saved until the caller explicitly edits or replaces them.
    await removeCoverage(db, versionId, intended);
  }
  for (const part of [range, input.coverage].filter((p): p is Range => !!p))
    if (!inside(part.startDate, part.endDate, intended))
      bad('Coverage and replacement ranges must fit within this run’s intended horizon.');
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
    if (!row) return bad('Referenced content does not belong to this draft.');
    return row;
  }
  const affected: Range[] = range ? [range] : [];
  const affect = (startDate: string, endDate = startDate) => affected.push({ startDate, endDate });
  async function affectExisting(
    table: 'training_blocks' | 'training_weeks' | 'workouts',
    id: string,
    cascading = false,
  ) {
    const row = await existing(table, id);
    if (table === 'workouts') affect(String(row.scheduled_date));
    else affect(String(row.start_date), String(row.end_date));
    if (!cascading || table === 'workouts') return;
    // Capture children before deletion, even if an editable draft has dates
    // outside its parents. Their prescriptions and rest days lose coverage too.
    if (table === 'training_blocks') {
      const weeks = await db
        .selectFrom('training_weeks')
        .select(['start_date', 'end_date'])
        .where('plan_version_id', '=', versionId)
        .where('block_id', '=', id)
        .execute();
      for (const week of weeks) affect(String(week.start_date), String(week.end_date));
    }
    const workouts = await db
      .selectFrom('workouts as w')
      .innerJoin('training_weeks as tw', 'tw.id', 'w.week_id')
      .select('w.scheduled_date')
      .where('w.plan_version_id', '=', versionId)
      .where(table === 'training_weeks' ? 'tw.id' : 'tw.block_id', '=', id)
      .execute();
    for (const workout of workouts) affect(String(workout.scheduled_date));
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
      await affectExisting(table, id, true);
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
    if (b.id) await affectExisting('training_blocks', b.id);
    affect(b.startDate, b.endDate);
    const id = b.id ?? randomUUID();
    const values = {
      title: b.title,
      phase: b.phase,
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
    if (w.id) await affectExisting('training_weeks', w.id);
    affect(w.startDate, w.endDate);
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
  type Target = Schedule['workouts'][number]['steps'][number]['targets'][number];
  // Explicit paces and powers also get the calibrated zone they fall in, so every client can
  // colour the effort by zone. The coach's value stays as written; a zone it chose is never
  // replaced. Zones come from the athlete's fitness on the workout date, as reads resolve them.
  const calibrations = await readEntries(db, run.owner_id);
  const withZone = (targets: Target[], discipline: StepDiscipline, date: string): Target[] => {
    const system = systemForDiscipline(discipline);
    const explicit = targets.find(
      (t) => t.type === 'pace' || t.type === 'swim_pace' || t.type === 'power',
    );
    if (!system || !explicit || targets.some((t) => t.type === 'zone')) return targets;
    const value =
      explicit.type === 'pace'
        ? explicit.secondsPerKilometre
        : explicit.type === 'swim_pace'
          ? explicit.secondsPer100Metres
          : explicit.type === 'power'
            ? explicit.watts
            : null;
    const calibration = resolveCalibration(calibrations, system, date);
    // Zone minimums are the fast (or low-power) end of each band, maximums the other end.
    const zones = (calibration?.zones ?? []).map((zone) => ({
      key: zone.key,
      fast: zone.minimum,
      target: zone.target,
      slow: zone.maximum,
    }));
    const zone = value === null ? null : nearestZone(value, zones);
    return zone ? [...targets, { type: 'zone', key: zone.key }] : targets;
  };
  /** Which sports may carry each kind of target. */
  const allowed: Partial<Record<Target['type'], StepDiscipline[]>> = {
    pace: ['run'],
    swim_pace: ['swim'],
    power: ['cycle'],
    rir: ['strength'],
    load: ['strength'],
  };
  const checkTargets = (targets: Target[], discipline: StepDiscipline) => {
    const name = SPORT_NAMES[discipline];
    for (const t of targets) {
      const sports = allowed[t.type];
      if (sports && !sports.includes(discipline))
        bad(`A ${t.type} target does not apply to a ${name} effort.`);
      if (t.type !== 'zone') continue;
      const system = systemForDiscipline(discipline);
      if (!system)
        bad(
          `Zones apply to run, cycle and swim efforts; use rpe, rir, load or instructions for ${name}.`,
        );
      else if (!CALIBRATORS[system].zoneKeys.includes(t.key))
        bad(
          `'${t.key}' is not a ${name} zone. Use one of: ${CALIBRATORS[system].zoneKeys.join(', ')}.`,
        );
    }
  };
  for (const w of input.workouts) {
    if (range && (!inside(w.date, w.date, range) || w.id))
      bad('Range replacement accepts new workouts only, dated within its range.');
    if (w.id) await affectExisting('workouts', w.id);
    affect(w.date);
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
      primary_discipline: w.discipline,
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
      const discipline =
        s.kind === 'effort'
          ? (s.discipline ?? (w.discipline === 'mixed' ? null : w.discipline))
          : null;
      if (s.kind === 'effort' && !discipline)
        bad('Each effort in a mixed workout needs its own discipline.');
      if (discipline) checkTargets(s.targets, discipline);
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
          discipline,
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
      const targets = discipline ? withZone(s.targets, discipline, w.date) : s.targets;
      for (const [j, t] of targets.entries())
        await db
          .insertInto('step_targets')
          .values({
            step_id: sid,
            plan_version_id: versionId,
            position: j + 1,
            ...targetColumns(t, discipline),
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
    if (daily.get(d)! > 2) bad('At most two sessions can be scheduled per day.');
  }
  // Every mutation invalidates its old and new dates. A later unfinished batch
  // must not inherit completion from an earlier batch in this same run.
  // Merge affected ranges to avoid repeatedly splitting the same coverage rows.
  const invalidated: Range[] = [];
  for (const part of affected.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const previous = invalidated.at(-1);
    if (previous && part.startDate <= day(previous.endDate, 1)) {
      if (part.endDate > previous.endDate) previous.endDate = part.endDate;
    } else invalidated.push({ ...part });
  }
  for (const part of invalidated) await removeCoverage(db, versionId, part);
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
    .orderBy('start_date')
    .execute();
  let next = intended.startDate;
  let prescribedThrough: string | null = null;
  for (const c of coverage) {
    if (c.brief_hash !== state.hash || String(c.end_date) < next) continue;
    if (String(c.start_date) > next || next > intended.endDate) break;
    prescribedThrough =
      String(c.end_date) < intended.endDate ? String(c.end_date) : intended.endDate;
    if (prescribedThrough === intended.endDate) break;
    next = day(prescribedThrough, 1);
  }
  await db
    .updateTable('agent_runs')
    .set({ generation_prescribed_through: prescribedThrough })
    .where('id', '=', runId)
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
  await recordDraftChange(db, versionId, 'edit-only');
  return { ids: result, findings };
}
type Target = Schedule['workouts'][number]['steps'][number]['targets'][number];
/** Stored columns for a coaching target. Zones resolve in the system of the step's sport. */
function targetColumns(t: Target, discipline: StepDiscipline | null) {
  const none = {
    zone_system: null,
    zone_key: null,
    target_value: null,
    unit: null,
    text_value: null,
  };
  switch (t.type) {
    case 'zone':
      return {
        ...none,
        target_type: 'zone',
        zone_system: systemForDiscipline(discipline),
        zone_key: t.key,
      };
    case 'pace':
      return {
        ...none,
        target_type: 'pace',
        target_value: t.secondsPerKilometre,
        unit: 'seconds_per_kilometre',
      };
    case 'swim_pace':
      return {
        ...none,
        target_type: 'pace',
        target_value: t.secondsPer100Metres,
        unit: 'seconds_per_100_metres',
      };
    case 'power':
      return { ...none, target_type: 'power', target_value: t.watts, unit: 'watts' };
    case 'rpe':
      return { ...none, target_type: 'rpe', target_value: t.value, unit: 'rpe' };
    case 'rir':
      return { ...none, target_type: 'rir', target_value: t.value, unit: 'repetitions' };
    case 'load':
      return { ...none, target_type: 'load', target_value: t.kilograms, unit: 'kilograms' };
    case 'instruction':
      return { ...none, target_type: 'instruction', text_value: t.text };
  }
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
