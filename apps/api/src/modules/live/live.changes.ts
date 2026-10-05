import { readAggregate, type Aggregate, type Database } from '../plans/plan.aggregate.js';
import { canonicalJson, type SemanticValue } from '../plans/plan.canonical.js';
import type { ChangeSummary } from './live.schemas.js';

type WorkoutChange = ChangeSummary['workouts'][number];
const byDate = (a: WorkoutChange, b: WorkoutChange) =>
  a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
const LISTED_WORKOUTS = 50;
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

/** Presentation storage must never reject a valid large schedule mutation. */
export function compactSummary(summary: ChangeSummary): ChangeSummary {
  const counts = { added: 0, changed: 0, moved: 0, removed: 0 };
  for (const workout of summary.workouts) counts[workout.change]++;
  return {
    ...summary,
    counts,
    omittedWorkouts:
      (summary.omittedWorkouts ?? 0) + Math.max(0, summary.workouts.length - LISTED_WORKOUTS),
    workouts: summary.workouts.slice(0, LISTED_WORKOUTS).map((workout) => ({
      ...workout,
      title:
        workout.title.length > 80
          ? workout.title.slice(0, 79).replace(/[\uD800-\uDBFF]$/, '') + '…'
          : workout.title,
    })),
  };
}

/**
 * The net effect of one run's committed operations, in commit order. A workout added and later
 * removed by the same run disappears; a workout edited twice is one change, keeping its
 * original date as the move origin. Operations that already omitted entries stay counted as
 * omitted, so the result never claims a complete list it does not have.
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
  return compactSummary({
    workouts: workouts.sort(byDate),
    assumptionsChanged: summaries.some((s) => s.assumptionsChanged),
    paceGuidesChanged: summaries.some((s) => s.paceGuidesChanged),
    datesChanged: summaries.some((s) => s.datesChanged),
    omittedWorkouts: summaries.reduce((total, s) => total + (s.omittedWorkouts ?? 0), 0),
  });
}
