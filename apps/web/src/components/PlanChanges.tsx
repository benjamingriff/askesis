import { createContext, useContext } from 'react';
import type { paths } from '@askesis/api-client';
import { formatShort } from '../lib/format';
import { Card } from './ui';

export type ChangeSummary = NonNullable<
  paths['/api/v1/agent-runs/{runId}/turn']['get']['responses'][200]['content']['application/json']['changes']
>;
export type WorkoutChange = ChangeSummary['workouts'][number];

/** Net draft differences for the schedule being shown; empty outside a draft. */
export const WorkoutChangesContext = createContext<WorkoutChange[]>([]);
export const useWorkoutChange = (id: string) =>
  useContext(WorkoutChangesContext).find((change) => change.workoutId === id);

export function changeLabel(change: WorkoutChange) {
  const label = { added: 'Added', changed: 'Changed', moved: 'Moved', removed: 'Removed' }[
    change.change
  ];
  return change.change === 'moved' && change.prescriptionChanged ? `${label} · Changed` : label;
}

/** The prototype's change chip: a small accent label beside the workout kind. */
export function ChangeBadge({ change }: { change: WorkoutChange }) {
  return <span className={`change-badge ${change.change}`}>{changeLabel(change)}</span>;
}

export function WorkoutChangeBadge({ id }: { id: string }) {
  const change = useWorkoutChange(id);
  return change ? <ChangeBadge change={change} /> : null;
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

/**
 * Compact summary of everything pending in the draft. Changed workouts are highlighted in the
 * schedule itself; removed ones are listed here because they are no longer in it.
 */
export function PlanChanges({
  summary,
  firstDraft,
  onOpen,
}: {
  summary: ChangeSummary;
  firstDraft: boolean;
  onOpen?: ((workoutId: string) => void) | undefined;
}) {
  const changed = hasChanges(summary);
  const listed = summary.workouts.filter((w) => w.change !== 'removed');
  const removed = summary.workouts.filter((w) => w.change === 'removed');
  return (
    <Card className="plan-changes">
      <div className="plan-changes-header">
        <strong>{firstDraft ? 'New plan draft' : 'Changes in this draft'}</strong>
        {summary.workouts.length ? (
          <small>
            {summary.workouts.length} {summary.workouts.length === 1 ? 'workout' : 'workouts'}
          </small>
        ) : null}
      </div>
      <p className="muted">
        {changed
          ? describeChanges(summary)
          : firstDraft
            ? 'Nothing saved yet. Ask your coach to plan your first weeks.'
            : 'No pending changes from your locked plan.'}
      </p>
      {summary.omittedWorkouts ? (
        <p className="muted">
          More workouts changed than are listed. They are all in the schedule.
        </p>
      ) : null}
      {removed.length ? (
        <ul className="workout-changes">
          {removed.map((change) => (
            <li key={change.lineageId}>
              <ChangeBadge change={change} />
              <span>{change.title}</span>
              <small>{formatShort(change.date)}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {listed.length && onOpen ? (
        <details>
          <summary>Show changed workouts</summary>
          <ul className="workout-changes">
            {listed.map((change) => (
              <li key={change.lineageId}>
                <ChangeBadge change={change} />
                <button
                  className="link-button"
                  type="button"
                  onClick={() => change.workoutId && onOpen(change.workoutId)}
                >
                  {change.title}
                </button>
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
