import type { ChangeSummary, WorkoutChange } from '../data/chat';
import type { WorkoutSummary } from './api-types';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatSwimDistance,
  formatSwimPace,
  type PoolUnits,
  type Units,
} from './format';
import { SPORT_META, type Sport } from './sports';
import { expectedEffort } from './workouts';

export function workoutMeta(workout: WorkoutSummary, units: Units, pool: PoolUnits = 'm'): string {
  const parts = [];
  if (workout.estimatedDistanceMetres !== null)
    parts.push(
      workout.discipline === 'swim'
        ? formatSwimDistance(workout.estimatedDistanceMetres, pool)
        : formatDistance(workout.estimatedDistanceMetres, units),
    );
  if (workout.estimatedDurationSeconds !== null)
    parts.push(
      `${workout.placeholder ? '~' : ''}${formatDuration(workout.estimatedDurationSeconds)}`,
    );
  const effort = expectedEffort(workout);
  if (effort) parts.push(effort);
  return parts.join(' · ') || SPORT_META[workout.discipline as Sport]?.label || workout.discipline;
}

/** Headline numbers for a workout, in the units its sport is usually described in. */
export function workoutStats(workout: WorkoutSummary, units: Units, pool: PoolUnits) {
  const { estimatedDistanceMetres: metres, estimatedDurationSeconds: seconds } = workout;
  const stats: { label: string; value: string; unit?: string }[] = [];
  if (metres !== null)
    stats.push(
      workout.discipline === 'swim'
        ? { label: 'Distance', value: formatSwimDistance(metres, pool) }
        : { label: 'Distance', value: formatDistance(metres, units, false), unit: units },
    );
  if (seconds !== null)
    stats.push({
      label: 'Time',
      value: `${workout.placeholder ? '~' : ''}${formatDuration(seconds)}`,
    });
  if (workout.expectedRpe)
    stats.push({
      label: 'Effort',
      value: expectedEffort(workout)!.replace('RPE ', ''),
      unit: 'RPE',
    });
  if (metres && seconds && !workout.placeholder) {
    if (workout.discipline === 'run')
      stats.push({
        label: 'Avg pace',
        value: formatPace((seconds / metres) * 1000, units, false),
        unit: `/${units}`,
      });
    if (workout.discipline === 'swim')
      stats.push({
        label: 'Avg pace',
        value: formatSwimPace((seconds / metres) * 100, pool, false),
        unit: `/100${pool}`,
      });
    if (workout.discipline === 'cycle')
      stats.push({ label: 'Avg speed', value: formatSpeed(metres / seconds, units) });
  }
  return stats;
}

export function changeLabel(change: WorkoutChange) {
  const label = { added: 'Added', changed: 'Changed', moved: 'Moved', removed: 'Removed' }[
    change.change
  ];
  return change.change === 'moved' && change.prescriptionChanged ? `${label} · Changed` : label;
}

export function hasChanges(summary: ChangeSummary) {
  return (
    summary.workouts.length > 0 ||
    !!summary.omittedWorkouts ||
    summary.assumptionsChanged ||
    summary.datesChanged
  );
}

/** One line: workout counts by kind, then assumption and date changes. */
export function describeChanges(summary: ChangeSummary) {
  const counts = summary.counts ?? { added: 0, changed: 0, moved: 0, removed: 0 };
  return [
    ...(['added', 'moved', 'changed', 'removed'] as const)
      .filter((kind) => counts[kind] > 0)
      .map((kind) => `${counts[kind]} ${kind}`),
    ...(summary.assumptionsChanged ? ['assumptions updated'] : []),
    ...(summary.datesChanged ? ['plan dates updated'] : []),
  ]
    .join(' · ')
    .replace(/^./, (first) => first.toUpperCase())
    .concat(summary.approximate ? ' (approximate)' : '');
}

export function countdown(days: number) {
  return days === 0 ? 'Race day' : days === 1 ? '1 day to go' : `${days} days to go`;
}
