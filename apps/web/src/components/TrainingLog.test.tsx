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
  placeholder: false,
  expectedRpe: null,
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
      placeholder: activeWorkout.placeholder,
      actualSessionType: body.actualSessionType ?? null,
      plannedDurationSeconds: 1800,
      plannedDistanceMetres: activeWorkout.estimatedDistanceMetres,
      plannedRpe: 3,
      status: body.status,
      performedOn: body.performedOn ?? '2026-10-14',
      actualDurationSeconds:
        body.status === 'skipped'
          ? null
          : body.actualDurationSeconds === undefined
            ? 1800
            : body.actualDurationSeconds,
      actualDistanceMetres:
        body.actualDistanceMetres === undefined
          ? activeWorkout.estimatedDistanceMetres
          : body.actualDistanceMetres,
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
function mount(w = workout, p = plan) {
  activeWorkout = w;
  return createMemoryRouter([
    {
      path: '/',
      element: (
        <AccountQueryProvider accountId="test">
          <TrainingLogProvider plan={p}>
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

it('preserves explicitly unknown actuals when reopening and saving another correction', async () => {
  render(<RouterProvider router={mount({ ...workout, estimatedDistanceMetres: 5000 })} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Actual time (minutes)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Actual distance (metres)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Actual time (minutes)')).toHaveValue(null);
  expect(screen.getByLabelText('Actual distance (metres)')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('Anything else for your coach?'), {
    target: { value: 'Amounts unknown' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(logs[0]).toMatchObject({
    actualDurationSeconds: null,
    actualDistanceMetres: null,
    note: 'Amounts unknown',
  });
});
it.each(['draft', 'new-draft-workout'])(
  'does not create logs from a displayed %s prescription',
  async (versionId) => {
    render(
      <RouterProvider
        router={mount(
          { ...workout, planVersionId: versionId },
          { ...plan, draft: { ...plan.locked!, id: 'draft', state: 'draft' } },
        )}
      />,
    );
    await screen.findByText(/Log the published workout from Today/);
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  },
);
it('corrects an existing log from a draft view using its original snapshot', async () => {
  await mocks.put('', { body: { status: 'done' } });
  render(
    <RouterProvider
      router={mount({
        ...workout,
        planVersionId: 'draft',
        title: 'Changed draft title',
        scheduledDate: '2026-11-01',
      })}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Easy ride');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('Changed draft title');
  fireEvent.change(screen.getByLabelText('Anything else for your coach?'), {
    target: { value: 'Corrected from draft view' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(logs[0]?.note).toBe('Corrected from draft view'));
});
it('waits for a result preview before allowing feedback to be saved', async () => {
  let finish!: (value: unknown) => void;
  mocks.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<RouterProvider router={mount({ ...workout, sessionType: 'test' })} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText('Average power (watts)'), { target: { value: '260' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview and attach result' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Save and talk it through' })).toBeDisabled();
  finish({ data: { zones: [] } });
  await screen.findByText('Result previewed and attached.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(logs[0]?.answers.result?.input).toEqual({
      method: 'twenty_minute_test',
      averageWatts: 260,
    }),
  );
});
it('asks what a placeholder turned out to be and follows up on that session type', async () => {
  render(
    <RouterProvider
      router={mount({
        ...workout,
        title: 'Saturday club ride',
        sessionType: 'steady',
        placeholder: true,
        expectedRpe: { minimum: 4, maximum: 7 },
      })}
    />,
  );
  expect(
    await screen.findByText('Tell your coach what the session turned out to be.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('What was it?');
  expect(dialog).toHaveTextContent('Your coach assumed steady');
  expect(dialog).toHaveTextContent('expected RPE 4–7');
  expect(dialog).not.toHaveTextContent('How did the intervals go?');
  fireEvent.click(screen.getByRole('button', { name: 'Intervals' }));
  expect(dialog).toHaveTextContent('How did the intervals go?');
  fireEvent.click(screen.getByRole('button', { name: 'Faded on the last reps' }));
  fireEvent.change(screen.getByLabelText('What did you do?'), {
    target: { value: 'Chain gang with 5 × 3 min turns' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.put.mock.calls.at(-1)?.[1].body).toMatchObject({
    status: 'done',
    actualSessionType: 'intervals',
    answers: { intervals: 'faded' },
    note: 'Chain gang with 5 × 3 min turns',
  });
  expect(logs[0]).toMatchObject({ placeholder: true, actualSessionType: 'intervals' });
});
