import { createContext, useContext } from 'react';
import type { paths } from '@askesis/api-client';
import { formatShort } from '../lib/format';
import { Card, Pill } from './ui';
export type ChangeSummary =
  paths['/api/v1/agent-runs/{runId}/changes']['get']['responses'][200]['content']['application/json']['summaries'][number];
export type WorkoutChange = ChangeSummary['workouts'][number];
export const WorkoutChangesContext = createContext<WorkoutChange[]>([]);
export function WorkoutChangeBadge({ id }: { id: string }) {
  const change = useContext(WorkoutChangesContext).find((change) => change.workoutId === id);
  if (!change) return null;
  return (
    <span className="workout-change">
      <Pill tone="accent">
        {change.change === 'added' ? 'Added' : change.change === 'moved' ? 'Moved' : 'Changed'}
        {change.change === 'moved' && change.prescriptionChanged ? ' · Changed' : ''}
      </Pill>
    </span>
  );
}
export function PlanChanges({
  summary,
  title = 'Saved changes',
  onOpen,
}: {
  summary: ChangeSummary;
  title?: string;
  onOpen?: ((id: string) => void) | undefined;
}) {
  const counts =
    summary.counts ??
    summary.workouts.reduce(
      (result, item) => ({ ...result, [item.change]: (result[item.change] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
  const changed =
    summary.workouts.length ||
    summary.assumptionsChanged ||
    summary.paceGuidesChanged ||
    summary.datesChanged;
  return (
    <Card className="plan-changes">
      <strong>{title}</strong>
      <p className="muted">
        {changed
          ? [
              ...Object.entries(counts)
                .filter(([, count]) => count > 0)
                .map(([kind, count]) => `${count} ${kind}`),
              ...(summary.assumptionsChanged ? ['Assumptions updated'] : []),
              ...(summary.paceGuidesChanged ? ['Pace guides updated'] : []),
              ...(summary.datesChanged ? ['Plan dates updated'] : []),
            ].join(' · ')
          : 'No changes from the locked version.'}
      </p>
      {summary.omittedWorkouts ? (
        <p className="muted">
          {summary.omittedWorkouts} additional workout changes were saved. Review the plan for its
          current schedule.
        </p>
      ) : null}
      {summary.workouts.length ? (
        <details>
          <summary>Review workout changes</summary>
          <ul className="workout-changes">
            {summary.workouts.map((change, index) => (
              <li key={`${change.lineageId}-${index}`}>
                <span className="label">
                  {change.change}
                  {change.change === 'moved' && change.prescriptionChanged ? ' · changed' : ''}
                </span>
                {change.workoutId && onOpen ? (
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => onOpen(change.workoutId!)}
                  >
                    {change.title}
                  </button>
                ) : (
                  <strong>{change.title}</strong>
                )}
                <small>
                  {change.change === 'moved' && change.previousDate
                    ? `${formatShort(change.previousDate)} → `
                    : ''}
                  {formatShort(change.date)}
                </small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
