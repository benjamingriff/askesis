import { readAggregate, type Aggregate, type Database } from '../plans/plan.aggregate.js';
import { canonicalJson, type SemanticValue } from '../plans/plan.canonical.js';
import type { ChangeSummary } from './live.schemas.js';
export function compareAggregates(
  before: Aggregate | null,
  after: Aggregate,
  ids: Map<string, string>,
): ChangeSummary {
  const previous = new Map((before?.entities.workouts ?? []).map((w) => [w.lineage, w.value]));
  const next = new Map((after.entities.workouts ?? []).map((w) => [w.lineage, w.value]));
  const workouts: ChangeSummary['workouts'] = [];
  for (const lineage of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(lineage),
      current = next.get(lineage);
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
  const a = after.semantic as Record<string, SemanticValue>,
    b = (before?.semantic ?? {}) as Record<string, SemanticValue>;
  const changed = (keys: string[]) =>
    keys.some((k) => canonicalJson(b[k] ?? null) !== canonicalJson(a[k] ?? null));
  return {
    workouts: workouts.sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    ),
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
    omittedWorkouts: Math.max(0, summary.workouts.length - 50),
    workouts: summary.workouts.slice(0, 50).map((workout) => ({
      ...workout,
      title:
        workout.title.length > 80
          ? workout.title.slice(0, 79).replace(/[\uD800-\uDBFF]$/, '') + '…'
          : workout.title,
    })),
  };
}
