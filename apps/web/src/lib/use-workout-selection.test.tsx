import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { WorkoutSummary } from '@askesis/api-client';
import { useWorkoutSelection } from './use-workout-selection';

const workout: WorkoutSummary = {
  id: 'workout',
  planId: 'plan',
  planVersionId: 'version-1',
  planTitle: 'Training plan',
  weekNumber: 1,
  scheduledDate: '2027-01-11',
  title: 'Original effort',
  description: null,
  purpose: null,
  discipline: 'running',
  priority: 'medium',
  estimatedDurationSeconds: 1800,
  estimatedDistanceMetres: 5000,
};
afterEach(cleanup);

it('closes superseded selections as soon as the current version changes, even with old list data', () => {
  const { result, rerender } = renderHook(
    ({ versionId }) => useWorkoutSelection([workout], versionId),
    { initialProps: { versionId: 'version-1' } },
  );
  act(() => result.current.open(workout));
  expect(result.current.workout).toEqual(workout);
  rerender({ versionId: 'version-2' });
  expect(result.current.workout).toBeNull();
});

it('uses updated summaries within a version and closes when the workout is removed', () => {
  const { result, rerender } = renderHook(
    ({ workouts }) => useWorkoutSelection(workouts, 'version-1'),
    { initialProps: { workouts: [workout] } },
  );
  act(() => result.current.open(workout));
  const updated = { ...workout, title: 'Updated effort', estimatedDistanceMetres: 8000 };
  rerender({ workouts: [updated] });
  expect(result.current.workout).toEqual(updated);
  rerender({ workouts: [] });
  expect(result.current.workout).toBeNull();
});

it('allows explicitly opening a replacement workout and closing it', () => {
  const replacement = { ...workout, id: 'replacement', planVersionId: 'version-2' };
  const { result } = renderHook(() => useWorkoutSelection([replacement], 'version-2'));
  act(() => result.current.open(replacement));
  expect(result.current.workout).toEqual(replacement);
  act(() => result.current.close());
  expect(result.current.workout).toBeNull();
});
