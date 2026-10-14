import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IntegrationsState, WorkoutActual, WorkoutSummary } from '@askesis/api-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AccountQueryProvider } from '../query-provider';
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
      lapsSynced: true,
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
  mount(<WorkoutActualSection workout={workout} units="km" today="2026-10-14" />);
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
