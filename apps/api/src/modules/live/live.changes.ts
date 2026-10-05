import { readAggregate, type Aggregate, type Database } from '../plans/plan.aggregate.js';
import { canonicalJson, type SemanticValue } from '../plans/plan.canonical.js';
import type { ChangeSummary } from './live.schemas.js';

type WorkoutChange = ChangeSummary['workouts'][number];
const byDate = (a: WorkoutChange, b: WorkoutChange) =>
  a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
/** Workouts listed in a presented summary; counts always cover every change. */
const LISTED_WORKOUTS = 50;
/** Stored summaries stay well inside their column bound (4 MiB) by shedding titles first. */
const STORED_BYTES = 3_500_000;
const counted = () => ({ added: 0, changed: 0, moved: 0, removed: 0 });
function countChanges(workouts: WorkoutChange[]) {
  const counts = counted();
  for (const workout of workouts) counts[workout.change]++;
  return counts;
}
const shortTitle = (workout: WorkoutChange) => ({
  ...workout,
  title:
    workout.title.length > 80
      ? workout.title.slice(0, 79).replace(/[\uD800-\uDBFF]$/, '') + '…'
      : workout.title,
});
export function compareAggregates(
  before: Aggregate | null,
  after: Aggregate,
  ids: Map<string, string>,
): ChangeSummary {
  const previousWorkouts = new Map(
    (before?.entities.workouts ?? []).map((w) => [w.lineage, w.value]),
  );
  const nextWorkouts = new Map((after.entities.workouts ?? []).map((w) => [w.lineage, w.value]));
  const workouts: ChangeSummary['workouts'] = [];
  for (const lineage of new Set([...previousWorkouts.keys(), ...nextWorkouts.keys()])) {
    const old = previousWorkouts.get(lineage),
      current = nextWorkouts.get(lineage);
    if (old && current && canonicalJson(old) === canonicalJson(current)) continue;
    const value = (current ?? old) as { content: { title: string; scheduled_date: string } };
    const oldValue = old as typeof value | undefined;
    const moved =
      !!oldValue && !!current && oldValue.content.scheduled_date !== value.content.scheduled_date;
    const withoutDate = (v: SemanticValue | undefined) => {
      if (!v) return null;
      const o = v as { content: Record<string, SemanticValue> };
      const content = { ...o.content };
      delete content.scheduled_date;
      delete content.position;
      return canonicalJson(content);
    };
    workouts.push({
      lineageId: lineage,
      workoutId: current ? (ids.get(lineage) ?? null) : null,
      title: value.content.title,
      date: value.content.scheduled_date,
      previousDate: oldValue?.content.scheduled_date ?? null,
      change: !current ? 'removed' : !old ? 'added' : moved ? 'moved' : 'changed',
      prescriptionChanged: !!old && !!current && withoutDate(old) !== withoutDate(current),
    });
  }
  const next = after.semantic as Record<string, SemanticValue>,
    previous = (before?.semantic ?? {}) as Record<string, SemanticValue>;
  const changed = (keys: string[]) =>
    keys.some((k) => canonicalJson(previous[k] ?? null) !== canonicalJson(next[k] ?? null));
  return {
    workouts: workouts.sort(byDate),
    counts: countChanges(workouts),
    assumptionsChanged: changed(['brief', 'weekdays', 'description']),
    paceGuidesChanged: changed(['calibrations']),
    datesChanged: changed(['startDate', 'endDate']),
  };
}
export async function compareVersions(db: Database, before: Aggregate | null, versionId: string) {
  const after = await readAggregate(db, versionId);
  const rows = await db
    .selectFrom('workouts')
    .select(['id', 'lineage_id'])
    .where('plan_version_id', '=', versionId)
    .execute();
  return compareAggregates(before, after, new Map(rows.map((r) => [r.lineage_id, r.id])));
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
/**
 * The summary stored with a tool receipt: the identity and change of every workout, so a run's
 * operations combine exactly. Storage never rejects a valid schedule write: near the column
 * bound, titles are dropped first (latest first); only an operation affecting many thousands
 * of workouts then keeps as many identities as fit, with complete counts and an omitted count.
 */
export function storedSummary(summary: ChangeSummary): ChangeSummary {
  const workouts = summary.workouts.map(shortTitle);
  const sizes = workouts.map((workout) => bytes(workout) + 1);
  let total = bytes({ ...summary, workouts: [] }) + sizes.reduce((sum, size) => sum + size, 0);
  for (let i = workouts.length - 1; i >= 0 && total > STORED_BYTES; i--) {
    const untitled = { ...workouts[i]!, title: '' };
    total -= sizes[i]! - (bytes(untitled) + 1);
    sizes[i] = bytes(untitled) + 1;
    workouts[i] = untitled;
  }
  let kept = workouts.length;
  while (kept > 0 && total > STORED_BYTES) total -= sizes[--kept]!;
  return kept === workouts.length
    ? { ...summary, workouts }
    : { ...summary, workouts: workouts.slice(0, kept), omittedWorkouts: workouts.length - kept };
}

/** A summary for presentation: complete counts and the first workouts in date order. */
export function compactSummary(summary: ChangeSummary): ChangeSummary {
  const total = Object.values(summary.counts).reduce((sum, count) => sum + count, 0);
  const workouts = summary.workouts.slice(0, LISTED_WORKOUTS).map(shortTitle);
  return { ...summary, workouts, omittedWorkouts: Math.max(0, total - workouts.length) };
}

/**
 * The net effect of one run's committed operations, in commit order. A workout added and later
 * removed by the same run disappears; a workout edited twice is one change, keeping its
 * original date as the move origin. Stored summaries list every workout except in pathological
 * operations, so combination is exact for every realistic run.
 */
export function combineSummaries(summaries: ChangeSummary[]): ChangeSummary | null {
  if (!summaries.length) return null;
  type Entry = { first: WorkoutChange; last: WorkoutChange; edited: boolean; changed: boolean };
  const entries = new Map<string, Entry>();
  for (const summary of summaries)
    for (const workout of summary.workouts) {
      const entry = entries.get(workout.lineageId) ?? {
        first: workout,
        last: workout,
        edited: false,
        changed: false,
      };
      entry.last = workout;
      entry.edited ||= workout.prescriptionChanged;
      entry.changed ||= workout.change === 'changed';
      entries.set(workout.lineageId, entry);
    }
  const workouts: WorkoutChange[] = [];
  for (const { first, last, edited, changed } of entries.values()) {
    const existedBefore = first.change !== 'added',
      existsAfter = last.change !== 'removed';
    const originalDate = first.previousDate ?? first.date;
    if (!existedBefore && !existsAfter) continue;
    if (!existedBefore)
      workouts.push({ ...last, change: 'added', previousDate: null, prescriptionChanged: false });
    else if (!existsAfter)
      workouts.push({
        ...last,
        date: originalDate,
        previousDate: originalDate,
        change: 'removed',
        prescriptionChanged: false,
      });
    else if (originalDate !== last.date)
      workouts.push({
        ...last,
        previousDate: originalDate,
        change: 'moved',
        prescriptionChanged: edited,
      });
    // A workout moved away and back again, with no other edit, has no net change.
    else if (edited || changed)
      workouts.push({
        ...last,
        previousDate: originalDate,
        change: 'changed',
        prescriptionChanged: edited,
      });
  }
  // An operation too large to store every identity still contributes its complete counts.
  const counts = countChanges(workouts);
  for (const summary of summaries) {
    if (!summary.omittedWorkouts) continue;
    const listed = countChanges(summary.workouts);
    for (const kind of Object.keys(counts) as (keyof typeof counts)[])
      counts[kind] += Math.max(0, summary.counts[kind] - listed[kind]);
  }
  return compactSummary({
    workouts: workouts.sort(byDate),
    counts,
    assumptionsChanged: summaries.some((s) => s.assumptionsChanged),
    paceGuidesChanged: summaries.some((s) => s.paceGuidesChanged),
    datesChanged: summaries.some((s) => s.datesChanged),
  });
}
