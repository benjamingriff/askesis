import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AccountQueryProvider } from '../query-provider';
import { TrainingLogProvider, WorkoutLogActions, TrainingHistory } from './TrainingLog';
import type { WorkoutLog } from '../training-log';
import type { WorkoutSummary } from '@askesis/api-client';
import type { Plan } from '../plan-data';
import type * as Live from '../live';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), remove: vi.fn() }));
vi.mock('../api', () => ({
  api: { GET: mocks.get, PUT: mocks.put, POST: mocks.post, DELETE: mocks.remove },
}));
vi.mock('../live', async (original) => ({
  ...(await original<typeof Live>()),
  useLiveState: () => 'live',
}));
vi.mock('../lib/use-local-today', () => ({ useLocalToday: () => '2026-10-14' }));
const workout: WorkoutSummary = {
  id: 'workout',
  lineageId: 'lineage',
  planId: 'plan',
  planVersionId: 'locked',
  planTitle: 'Example',
  weekNumber: 2,
  scheduledDate: '2026-10-14',
  title: 'Easy ride',
  description: null,
  purpose: null,
  discipline: 'cycle',
  priority: 'medium',
  racePriority: null,
  sessionType: 'easy',
  plannedRpe: 3,
  estimatedDurationSeconds: 1800,
  estimatedDistanceMetres: null,
};
const plan = {
  id: 'plan',
  displayName: 'Example',
  archived: false,
  active: true,
  stateVersion: 1,
  draft: null,
  locked: { id: 'locked', state: 'locked', editNumber: 1, versionNumber: 1 },
} as Plan;
let logs: WorkoutLog[] = [],
  activeWorkout = workout;
beforeEach(() => {
  vi.resetAllMocks();
  logs = [];
  mocks.get.mockImplementation(async () => ({
    data: { today: '2026-10-14', logs, checkIns: [], summary: { done: logs.length } },
  }));
  mocks.put.mockImplementation(async (_path, options) => {
    const body = options.body;
    const log: WorkoutLog = {
      id: 'log',
      planId: 'plan',
      lineageId: 'lineage',
      loggedVersionId: 'locked',
      scheduledOn: '2026-10-14',
      title: workout.title,
      discipline: 'cycle',
      sessionType: activeWorkout.sessionType,
      keySession: activeWorkout.priority === 'high',
      plannedDurationSeconds: 1800,
      plannedDistanceMetres: null,
      plannedRpe: 3,
      status: body.status,
      performedOn: body.performedOn ?? '2026-10-14',
      actualDurationSeconds:
        body.status === 'skipped'
          ? null
          : body.actualDurationSeconds === undefined
            ? 1800
            : body.actualDurationSeconds,
      actualDistanceMetres: null,
      rpe: body.rpe ?? null,
      feel: body.feel ?? null,
      reasons: body.reasons ?? [],
      answers: body.answers ?? {},
      answersSchemaVersion: 1,
      note: body.note ?? null,
      source: 'manual',
      createdAt: '2026-10-14T12:00:00Z',
      updatedAt: '2026-10-14T12:00:00Z',
    };
    logs = [log];
    return { data: log };
  });
  mocks.remove.mockImplementation(async () => {
    logs = [];
    return { data: { cleared: true } };
  });
});
afterEach(cleanup);
function mount(w = workout) {
  activeWorkout = w;
  return createMemoryRouter([
    {
      path: '/',
      element: (
        <AccountQueryProvider accountId="test">
          <TrainingLogProvider plan={plan}>
            <WorkoutLogActions workout={w} />
            <TrainingHistory planId="plan" workouts={[w]} />
          </TrainingLogProvider>
        </AccountQueryProvider>
      ),
    },
    { path: '/chat/:id', element: <h1>Coach</h1> },
  ]);
}
it('records an easy session in one tap while locked, saves optional effort, and clears it', async () => {
  render(<RouterProvider router={mount()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
  await screen.findByRole('button', { name: 'Edit' });
  expect(mocks.put.mock.calls[0]?.[1].body).toEqual({ status: 'done' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Effort 3: Easy · comfortable conversation' }),
  );
  await waitFor(() => expect(logs[0]?.rpe).toBe(3));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await screen.findByRole('button', { name: 'Done' });
  expect(logs).toEqual([]);
});
it('opens selective feedback after recording a key session, and corrections do not invoke coaching', async () => {
  render(
    <RouterProvider router={mount({ ...workout, priority: 'high', sessionType: 'intervals' })} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('How did the intervals go?');
  expect(logs).toHaveLength(1);
  expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Actual time (minutes)'), { target: { value: '25' } });
  fireEvent.change(screen.getByLabelText('Anything else for your coach?'), {
    target: { value: 'Shortened the final rep' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(logs[0]).toMatchObject({ actualDurationSeconds: 1500, note: 'Shortened the final rep' });
  expect(mocks.post).not.toHaveBeenCalled();
});
it('saves feedback before sending a typed reference and keeps the saved log when chat fails', async () => {
  mocks.post
    .mockResolvedValueOnce({ data: { id: 'chat', context: null } })
    .mockRejectedValueOnce(new Error('Coach unavailable'));
  render(<RouterProvider router={mount({ ...workout, priority: 'high' })} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText('Anything else for your coach?'), {
    target: { value: 'Heavy legs' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save and talk it through' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your log is saved. Coach unavailable',
  );
  expect(logs[0]?.note).toBe('Heavy legs');
  expect(mocks.post.mock.calls[1]?.[1].body.references).toEqual([
    { type: 'workout_log', logId: 'log' },
  ]);
});
