import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { TodayPage } from './today';
import type { WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { focusManager } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get, POST: mocks.post } }));

const locked = {
  id: 'locked-a',
  state: 'locked',
  editNumber: 1,
  versionNumber: 1,
  description: null,
  startDate: '2027-01-01',
  endDate: '2027-03-31',
  basedOnVersionId: null,
  supersedesVersionId: null,
  lockedAt: null,
};
const plan = {
  id: 'plan-a',
  displayName: 'Spring 10K',
  stateVersion: 1,
  active: true,
  archived: false,
  locked,
  draft: { ...locked, id: 'draft-a', state: 'draft', versionNumber: null },
};
const brief = {
  versionId: 'locked-a',
  editNumber: 1,
  startDate: locked.startDate,
  endDate: locked.endDate,
  readOnly: true,
  confirmed: true,
  hash: 'h',
  scheduleReviewRequired: false,
  coverage: [{ startDate: '2027-01-01', endDate: '2027-01-12', current: true }],
  findings: [],
  brief: {
    goal: '',
    unit: 'kilometres',
    sports: [
      {
        sport: 'run',
        currentSessions: { status: 'unanswered', value: null },
        desiredSessions: null,
        weeklyDistance: { status: 'unanswered', value: null },
        longestDistance: { status: 'unanswered', value: null },
      },
    ],
    weekdays: Array(7).fill('available'),
    context: '',
  },
};
/** The athlete's pace guides, shared by every plan. */
const performance = {
  timezone: 'UTC',
  today: '2027-01-12',
  current: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      system: 'run_pace',
      method: 'threshold_pace',
      input: { method: 'threshold_pace', secondsPerKilometre: 330 },
      calculatorVersion: 'run-pace-v1',
      provenance: 'user_estimate',
      estimateBasis: null,
      observedOn: null,
      effectiveFrom: '2027-01-01',
      recordedAt: '2027-01-01T09:00:00.000Z',
      recordedBy: 'athlete',
      conversationId: null,
      retractedAt: null,
      zones: [
        {
          key: 'easy',
          metric: 'pace',
          unit: 'seconds_per_kilometre',
          minimum: 380,
          target: 400,
          maximum: 420,
        },
      ],
    },
  ],
  entries: [],
  usedByPlans: ['run_pace'],
};
function mount(entry = '/today') {
  const router = createMemoryRouter(
    [
      { path: '/today', element: <TodayPage /> },
      { path: '/chat/:conversationId', element: <h1>Coach conversation</h1> },
    ],
    {
      initialEntries: [entry],
    },
  );
  render(
    <AccountQueryProvider accountId="athlete">
      <RouterProvider router={router} />
    </AccountQueryProvider>,
  );
  return router;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-12T09:00:00'));
  localStorage.clear();
  // A draft preference from the Plan tab must not change what Today prescribes.
  localStorage.setItem(
    'askesis-plan-selection:athlete',
    JSON.stringify({ planId: 'plan-a', view: 'draft' }),
  );
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.get.mockImplementation(async (path: string) => ({
    data:
      path === '/api/v1/plans'
        ? { plans: [plan] }
        : path === '/api/v1/blocks'
          ? { blocks: [] }
          : path === '/api/v1/workouts'
            ? { workouts: [] }
            : path === '/api/v1/performance'
              ? performance
              : brief,
  }));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  focusManager.setFocused(undefined);
});

it('shows the locked schedule and links the athlete’s pace guides to Performance', async () => {
  mount();
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/workouts', {
      params: { query: { planVersionId: 'locked-a' } },
    }),
  );
  expect(
    mocks.get.mock.calls.some(([, options]) => options?.params?.query?.planVersionId === 'draft-a'),
  ).toBe(false);
  expect(await screen.findByRole('link', { name: 'Details' })).toHaveAttribute(
    'href',
    '/performance',
  );
  expect(screen.getByText('6:40')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Rest day' })).toBeInTheDocument();
});

it('distinguishes dates beyond the prescribed coverage from rest days', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Rest day' });
  fireEvent.click(screen.getByRole('button', { name: 'Wednesday 13 January' }));
  expect(await screen.findByText('Not planned yet')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Rest day' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Plan it with your coach' })).toBeInTheDocument();
});

it('advances the displayed date and followed session after resuming on a new day', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Rest day' });
  vi.setSystemTime(new Date('2027-01-13T09:00:00'));
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText('Not planned yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Wednesday 13 January' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByText('Today’s workout')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Rest day' })).not.toBeInTheDocument();
});

it('preserves an explicitly browsed date and resumes following after selecting today', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Rest day' });
  fireEvent.click(screen.getByRole('button', { name: 'Monday 11 January' }));
  vi.setSystemTime(new Date('2027-01-13T09:00:00'));
  fireEvent(window, new Event('focus'));
  expect(screen.getByRole('button', { name: 'Monday 11 January' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.queryByText('Today’s workout')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Wednesday 13 January' }));
  vi.setSystemTime(new Date('2027-01-14T09:00:00'));
  fireEvent(window, new Event('focus'));
  expect(screen.getByRole('button', { name: 'Thursday 14 January' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByText('Today’s workout')).toBeInTheDocument();
});

it('rolls its week strip forward across Sunday without retaining yesterday as today', async () => {
  vi.setSystemTime(new Date('2027-01-17T23:59:59'));
  mount();
  await screen.findByText('Not planned yet');
  vi.setSystemTime(new Date('2027-01-18T00:00:00'));
  fireEvent(window, new Event('focus'));
  expect(screen.getByRole('button', { name: 'Monday 18 January' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.queryByRole('button', { name: 'Sunday 17 January' })).not.toBeInTheDocument();
  expect(screen.getByText('Today’s workout')).toBeInTheDocument();
});

it('does not declare a rest day when coverage could not be loaded', async () => {
  mocks.get.mockImplementation(async (path: string) =>
    path === '/api/v1/plans'
      ? { data: { plans: [plan] } }
      : path === '/api/v1/blocks'
        ? { blocks: [] }
        : path === '/api/v1/workouts'
          ? { data: { workouts: [] } }
          : path === '/api/v1/performance'
            ? { data: performance }
            : { error: { error: { message: 'Brief unavailable' } } },
  );
  mount();
  expect(await screen.findByText(/Couldn’t load this plan’s coverage/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Rest day' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

it('shows failed Today coach shortcuts and retries the original planning request', async () => {
  mocks.post
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ data: { id: 'chat-id' } });
  const router = mount();
  await screen.findByRole('heading', { name: 'Rest day' });
  fireEvent.click(screen.getByRole('button', { name: 'Wednesday 13 January' }));
  fireEvent.click(screen.getByRole('button', { name: 'Plan it with your coach' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  expect(screen.getByRole('alert')).toHaveTextContent('Plan the remaining weeks');
  fireEvent.click(screen.getByRole('button', { name: 'Retry opening coach' }));
  await screen.findByRole('heading', { name: 'Coach conversation' });
  expect(router.state.location.state).toEqual({ prefill: 'Plan the remaining weeks' });
  expect(mocks.post).toHaveBeenCalledTimes(2);
  expect(mocks.post.mock.calls[0]).toEqual(mocks.post.mock.calls[1]);
});

it('closes a superseded workout after locking a new version without resetting the browsed date', async () => {
  const originalWorkout: WorkoutSummary = {
    id: 'old-workout',
    planId: plan.id,
    planVersionId: locked.id,
    planTitle: plan.displayName,
    weekNumber: 2,
    scheduledDate: '2027-01-11',
    title: 'Original session',
    description: null,
    purpose: null,
    discipline: 'running',
    priority: 'medium',
    racePriority: null,
    estimatedDurationSeconds: 1800,
    estimatedDistanceMetres: 5000,
  };
  const replacement = {
    ...originalWorkout,
    id: 'new-workout',
    planVersionId: 'locked-b',
    title: 'Replacement session',
  };
  let currentPlan = { ...plan, draft: plan.draft as typeof plan.draft | null };
  mocks.get.mockImplementation(
    async (
      path: string,
      options?: { params?: { path?: { workoutId: string }; query?: { planVersionId: string } } },
    ) => ({
      data:
        path === '/api/v1/plans'
          ? { plans: [currentPlan] }
          : path === '/api/v1/blocks'
            ? { blocks: [] }
            : path === '/api/v1/workouts'
              ? {
                  workouts: [
                    options?.params?.query?.planVersionId === locked.id
                      ? originalWorkout
                      : replacement,
                  ],
                }
              : path === '/api/v1/workouts/{workoutId}'
                ? {
                    workout:
                      options?.params?.path?.workoutId === originalWorkout.id
                        ? originalWorkout
                        : replacement,
                    tags: [],
                    prescription: { kind: 'sequence', steps: [] },
                  }
                : path === '/api/v1/performance'
                  ? performance
                  : brief,
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Rest day' });
  fireEvent.click(screen.getByRole('button', { name: 'Monday 11 January' }));
  fireEvent.click(await screen.findByRole('button', { name: /Original session/ }));
  await screen.findByRole('dialog', { name: /Original session/ });
  const oldDetailCalls = () =>
    mocks.get.mock.calls.filter(
      ([path, options]) =>
        path === '/api/v1/workouts/{workoutId}' &&
        options.params.path.workoutId === originalWorkout.id,
    ).length;
  await waitFor(() => expect(oldDetailCalls()).toBe(1));
  currentPlan = {
    ...plan,
    stateVersion: 2,
    draft: null,
    locked: { ...locked, id: 'locked-b', versionNumber: 2 },
  };
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await screen.findByRole('button', { name: /Replacement session/ });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Monday 11 January' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(oldDetailCalls()).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: /Replacement session/ }));
  await screen.findByRole('dialog', { name: /Replacement session/ });
});

it('counts down to the next goal race rather than the plan’s end', async () => {
  const race = (id: string, scheduledDate: string, racePriority: 'A' | 'B') => ({
    id,
    planId: plan.id,
    planVersionId: locked.id,
    planTitle: plan.displayName,
    weekNumber: 1,
    scheduledDate,
    title: `${racePriority} race ${id}`,
    description: null,
    purpose: null,
    discipline: 'run',
    priority: 'high',
    racePriority,
    estimatedDurationSeconds: 3600,
    estimatedDistanceMetres: 10000,
  });
  const fallback = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string, init: unknown) =>
    path === '/api/v1/workouts'
      ? {
          data: {
            workouts: [
              race('past', '2027-01-05', 'A'),
              race('tune-up', '2027-01-16', 'B'),
              race('goal', '2027-01-24', 'A'),
            ],
          },
        }
      : fallback(path, init),
  );
  mount();
  const chip = await screen.findByText(/to A race goal/);
  expect(chip.closest('.status-chip')).toHaveTextContent('12 days to A race goal');
});

describe('session briefing', () => {
  const session: WorkoutSummary = {
    id: 'cruise',
    planId: plan.id,
    planVersionId: locked.id,
    planTitle: plan.displayName,
    weekNumber: 2,
    scheduledDate: '2027-01-12',
    title: 'Cruise intervals',
    description: null,
    purpose: 'Raise threshold without a long recovery.',
    discipline: 'run',
    priority: 'medium',
    racePriority: null,
    estimatedDurationSeconds: 2700,
    estimatedDistanceMetres: null,
  };
  const zone = (key: string, minimumValue: number, maximumValue: number) => ({
    type: 'zone' as const,
    minimumValue: null,
    targetValue: null,
    maximumValue: null,
    unit: null,
    zoneSystem: 'run_pace',
    zoneKey: key,
    text: null,
    resolvedZone: {
      calibrationId: '00000000-0000-4000-8000-000000000001',
      effectiveFrom: '2027-01-01',
      calculatorVersion: 'run-pace-v1',
      method: 'threshold_pace',
      metric: 'pace',
      minimumValue,
      targetValue: null,
      maximumValue,
      unit: 'seconds_per_kilometre',
    },
  });
  const step = (id: string, overrides: Partial<WorkoutStep>): WorkoutStep => ({
    id,
    kind: 'effort',
    role: 'work',
    discipline: 'run',
    repeatCount: null,
    label: id,
    instructions: null,
    movement: null,
    completion: {
      type: 'duration',
      value: 600,
      unit: 'seconds',
      conditionType: null,
      conditionValue: null,
    },
    targets: [],
    steps: [],
    ...overrides,
  });
  const prescription = step('root', {
    kind: 'sequence',
    completion: null,
    steps: [
      step('Jog', { role: 'warmup', targets: [zone('easy', 380, 420)] }),
      step('Cruise set', {
        kind: 'repeat',
        repeatCount: 3,
        completion: null,
        steps: [
          step('Cruise', { targets: [zone('threshold', 300, 310)] }),
          step('Float', {
            role: 'recovery',
            completion: {
              type: 'duration',
              value: 90,
              unit: 'seconds',
              conditionType: null,
              conditionValue: null,
            },
          }),
        ],
      }),
    ],
  });
  const thresholdZone = {
    key: 'threshold',
    metric: 'pace',
    unit: 'seconds_per_kilometre',
    minimum: 300,
    target: 305,
    maximum: 310,
  };

  const intervalZone = {
    ...thresholdZone,
    key: 'interval',
    minimum: 265,
    target: 270,
    maximum: 275,
  };

  beforeEach(() => {
    const fallback = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string, init: unknown) =>
      path === '/api/v1/workouts'
        ? { data: { workouts: [session] } }
        : path === '/api/v1/workouts/{workoutId}'
          ? { data: { workout: session, tags: [], prescription } }
          : path === '/api/v1/performance'
            ? {
                data: {
                  ...performance,
                  current: [
                    {
                      ...performance.current[0]!,
                      zones: [...performance.current[0]!.zones, thresholdZone, intervalZone],
                    },
                  ],
                },
              }
            : fallback(path, init),
    );
  });

  it('shows the session’s shape with resolved targets, without opening it', async () => {
    mount();
    const structure = await screen.findByRole('list', { name: 'Session structure' });
    expect(structure).toHaveTextContent('Warm-up');
    expect(structure).toHaveTextContent('Easy · 6:20–7:00/km');
    expect(structure).toHaveTextContent('3×');
    expect(structure).toHaveTextContent('Threshold · 5:00–5:10/km');
    expect(structure).toHaveTextContent('90s');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Full workout/ }));
    expect(await screen.findByRole('dialog', { name: /Cruise intervals/ })).toBeInTheDocument();
  });

  it('narrows the zones to the ones today’s session uses', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Today’s targets' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All zones' })).toHaveAttribute('href', '/performance');
    const zones = screen.getByRole('region', { name: 'Running pace guides' });
    await waitFor(() => expect(zones).toHaveTextContent('5:05'));
    expect(zones).toHaveTextContent('6:40');
    expect(zones).not.toHaveTextContent('4:30');
    expect(zones).not.toHaveTextContent('Interval');
  });
});

describe('layouts', () => {
  it('remembers the chosen layout', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Rest day' });
    fireEvent.click(screen.getByRole('radio', { name: /Load/ }));
    expect(await screen.findByRole('heading', { name: 'Weekly load' })).toBeInTheDocument();
    expect(localStorage.getItem('askesis-today-layout')).toBe('load');
    cleanup();
    mount();
    expect(await screen.findByRole('heading', { name: 'Weekly load' })).toBeInTheDocument();
  });

  it('opens a layout from the link', async () => {
    mount('/today?layout=journey');
    expect(await screen.findByRole('heading', { name: /^78\s*days$/ })).toBeInTheDocument();
    expect(screen.getByText('until this plan is complete')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Journey/ })).toHaveAttribute('aria-checked', 'true');
  });
});
