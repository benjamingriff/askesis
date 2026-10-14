import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IntegrationsState, WorkoutActual, WorkoutSummary } from '@askesis/api-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountQueryProvider } from '../query-provider';
import { rangeAdherence, type AdherenceView } from '../activity-data';
import { SettingsProvider } from '../settings';
import { outcomeLabel, StravaConnection, WorkoutActualSection } from './Activity';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get, POST: mocks.post, DELETE: mocks.del } }));

const connected: IntegrationsState = {
  strava: {
    available: true,
    connection: {
      status: 'active',
      displayName: 'Ben G',
      connectedAt: '2026-10-13T08:00:00.000Z',
      lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      lastSyncError: null,
      syncing: false,
      activityCount: 12,
    },
  },
};
const activity = {
  id: '00000000-0000-4000-8000-000000000a01',
  source: 'strava' as const,
  sourceUrl: 'https://www.strava.com/activities/1',
  name: 'Morning tempo',
  sport: 'cycle' as const,
  sourceSportType: 'Ride',
  date: '2026-10-13',
  startedAt: '2026-10-13T06:00:00.000Z',
  elapsedSeconds: 3900,
  movingSeconds: 3840,
  distanceMetres: 28000,
  elevationGainMetres: 40,
  averageSpeed: 7.3,
  averageWatts: 165,
  trainer: false,
  manual: false,
  race: false,
};
const rep = (index: number, watts: number, intensity: 'on_target' | 'below') => ({
  stepId: 'rep',
  label: 'Tempo effort',
  role: 'work',
  measure: 'duration' as const,
  amount: 300,
  band: { metric: 'power' as const, low: 200, high: 220 },
  repeat: { index, count: 3 },
  lapIndexes: [index + 1],
  actualSeconds: 300,
  actualMetres: 2400,
  actualIntensity: watts,
  completion: 1,
  status: 'done' as const,
  intensity,
});
const actual: WorkoutActual = {
  workoutId: '00000000-0000-4000-8000-000000000a01',
  connected: true,
  outcome: {
    workoutId: '00000000-0000-4000-8000-000000000a01',
    status: 'completed',
    activityIds: [activity.id],
    matchedBy: 'auto',
    completion: 1.02,
    dayOffset: 1,
    actualSeconds: 3840,
    actualMetres: 28000,
  },
  activities: [
    {
      ...activity,
      lapsPending: false,
      lapCount: 8,
      efforts: {
        verdict: 'aligned',
        segments: [rep(1, 210, 'on_target'), rep(2, 212, 'on_target'), rep(3, 181, 'below')],
        work: { planned: 3, done: 3, onTarget: 2, checked: 3 },
      },
    },
  ],
  candidates: [],
};
const workout: WorkoutSummary = {
  id: actual.outcome.workoutId,
  planId: '00000000-0000-4000-8000-000000000b01',
  planVersionId: '00000000-0000-4000-8000-000000000b02',
  planTitle: 'Autumn',
  weekNumber: 2,
  scheduledDate: '2026-10-12',
  title: 'Tempo intervals',
  description: null,
  purpose: null,
  discipline: 'cycle',
  priority: 'medium',
  racePriority: null,
  estimatedDurationSeconds: 3600,
  estimatedDistanceMetres: null,
};

function mount(children: React.ReactNode) {
  render(
    <AccountQueryProvider accountId="athlete">
      <SettingsProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </SettingsProvider>
    </AccountQueryProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.del.mockReset();
});
afterEach(cleanup);

it('describes outcomes, including sessions moved earlier or later', () => {
  const base = actual.outcome;
  expect(outcomeLabel({ ...base, dayOffset: 0 })).toBe('Done');
  expect(outcomeLabel({ ...base, dayOffset: 1 })).toBe('Done a day late');
  expect(outcomeLabel({ ...base, status: 'partial', dayOffset: -2 })).toBe('Partial early');
  expect(outcomeLabel({ ...base, status: 'missed', dayOffset: null })).toBe('Missed');
});

it('offers Strava only when the server is configured, and syncs a connection', async () => {
  mocks.get.mockResolvedValueOnce({ data: { strava: { available: false, connection: null } } });
  mount(<StravaConnection />);
  expect(await screen.findByText('Not configured on this server.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Connect with Strava' })).toBeNull();
  cleanup();

  mocks.get.mockResolvedValue({ data: connected });
  mocks.post.mockResolvedValue({
    data: { imported: 2, updated: 10, removed: 1, lapsFetched: 3, integrations: connected },
  });
  mount(<StravaConnection />);
  expect(
    await screen.findByText(/Connected as Ben G · synced .* · 12 activities/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
  expect(
    await screen.findByText('2 new, 10 refreshed, 1 removed · laps for 3.'),
  ).toBeInTheDocument();
  expect(mocks.post).toHaveBeenCalledWith('/api/v1/integrations/strava/sync');
  expect(screen.getByText(/never shared with your coach/)).toBeInTheDocument();
});

it('drops cached activity reads on disconnect and refreshes state after a failed sync', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['adherence', 'plan', 'version', 3], { connected: true });
  let state = connected;
  mocks.get.mockImplementation(async () => ({ data: state }));
  // The server marks the grant for reauthorization while the sync request fails.
  mocks.post.mockImplementation(async () => {
    state = {
      strava: {
        available: true,
        connection: {
          ...connected.strava.connection!,
          status: 'reauthorization_required',
          lastSyncError: 'STRAVA_REAUTHORIZATION_REQUIRED',
        },
      },
    };
    return { error: { error: { message: 'Strava no longer accepts this connection.' } } };
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider>
        <StravaConnection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
  expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeInTheDocument();

  mocks.del.mockImplementation(async () => {
    state = { strava: { available: true, connection: null } };
    return { data: state };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }),
  );
  expect(await screen.findByRole('button', { name: 'Connect with Strava' })).toBeInTheDocument();
  expect(client.getQueryCache().findAll({ queryKey: ['adherence'] })).toEqual([]);
});

it('totals the displayed calendar week, whatever weeks the plan stores', () => {
  const day = (date: string, id: string, seconds: number) => ({
    ...workout,
    id,
    scheduledDate: date,
    estimatedDurationSeconds: seconds,
  });
  const outcome = (workoutId: string, status: 'completed' | 'missed' | 'planned', seconds = 0) => ({
    ...actual.outcome,
    workoutId,
    status,
    activityIds: status === 'completed' ? [`activity-${workoutId}`] : [],
    actualSeconds: seconds,
    actualMetres: 0,
  });
  const extraRun = { ...activity, id: 'extra', date: '2026-10-13' };
  const view: AdherenceView = {
    connected: true,
    outcomes: new Map([
      ['mon', outcome('mon', 'completed', 1800)],
      ['tue', outcome('tue', 'missed')],
      ['fri', outcome('fri', 'completed', 3000)], // done early
      ['sun-before', outcome('sun-before', 'completed', 600)],
    ]),
    activities: new Map([['extra', extraRun]]),
    data: {
      extra: [{ activityId: 'extra', countsTowardPlan: true, seconds: 900, metres: 3000 }],
    } as AdherenceView['data'],
  };
  const workouts = [
    day('2026-10-11', 'sun-before', 600),
    day('2026-10-12', 'mon', 1800),
    day('2026-10-13', 'tue', 1200),
    day('2026-10-16', 'fri', 3600),
  ];
  expect(rangeAdherence(view, workouts, '2026-10-12', '2026-10-18', '2026-10-14')).toEqual({
    planned: { sessions: 3, seconds: 6600, metres: 0 },
    due: { sessions: 3, seconds: 6600, metres: 0 },
    actual: { sessions: 3, seconds: 5700, metres: 3000 },
    completed: 2,
    partial: 0,
    missed: 1,
    extra: 1,
  });
  expect(
    rangeAdherence(
      { ...view, connected: false },
      workouts,
      '2026-10-12',
      '2026-10-18',
      '2026-10-14',
    ),
  ).toBeNull();
});

it('asks to reconnect when Strava stops accepting the connection', async () => {
  const strava = connected.strava.connection!;
  mocks.get.mockResolvedValue({
    data: {
      strava: {
        available: true,
        connection: {
          ...strava,
          status: 'reauthorization_required',
          lastSyncError: 'STRAVA_REAUTHORIZATION_REQUIRED',
        },
      },
    },
  });
  mount(<StravaConnection />);
  expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  expect(screen.getByText(/Reconnect to keep syncing/)).toBeInTheDocument();
});

it('shows what was done rep by rep and lets the athlete reject the match', async () => {
  let current = actual;
  mocks.get.mockImplementation(async (path: string) => ({
    data: path === '/api/v1/integrations' ? connected : current,
  }));
  mocks.post.mockImplementation(async () => {
    current = {
      ...actual,
      outcome: { ...actual.outcome, status: 'missed', activityIds: [], matchedBy: null },
      activities: [],
      candidates: [{ ...activity, linkedWorkoutId: null }],
    };
    return { data: current };
  });
  mount(
    <WorkoutActualSection
      workout={workout}
      version={{ id: workout.planVersionId, editNumber: 1 }}
      units="km"
      today="2026-10-14"
    />,
  );
  const section = await screen.findByRole('region', { name: 'What you did' });
  expect(within(section).getByText('Done a day late')).toBeInTheDocument();
  expect(within(section).getByText('3 of 3 reps done')).toBeInTheDocument();
  expect(within(section).getByText(/2 of 3 on target/)).toBeInTheDocument();
  expect(within(section).getByLabelText('Easier than target')).toBeInTheDocument();
  expect(within(section).getByRole('link', { name: /View on Strava/ })).toHaveAttribute(
    'href',
    'https://www.strava.com/activities/1',
  );
  fireEvent.click(within(section).getByRole('button', { name: 'Not this session' }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('/api/v1/workouts/{workoutId}/activity-links', {
      params: { path: { workoutId: workout.id } },
      body: { activityId: activity.id, decision: 'reject' },
    }),
  );
  expect(await screen.findByText('No activity matched this session.')).toBeInTheDocument();
});
