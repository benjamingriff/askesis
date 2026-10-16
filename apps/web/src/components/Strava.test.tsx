import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { ActivityLink, WorkoutSummary } from '@askesis/api-client';
import { AccountQueryProvider } from '../query-provider';
import { TrainingLogProvider, WorkoutLogActions } from './TrainingLog';
import type { WorkoutLog } from '../training-log';
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
  title: 'Easy run',
  description: null,
  purpose: null,
  discipline: 'run',
  priority: 'medium',
  racePriority: null,
  sessionType: 'easy',
  plannedRpe: 3,
  estimatedDurationSeconds: 1800,
  estimatedDistanceMetres: 5000,
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
const log: WorkoutLog = {
  id: 'log',
  planId: 'plan',
  lineageId: 'lineage',
  loggedVersionId: 'locked',
  scheduledOn: '2026-10-14',
  title: 'Easy run',
  discipline: 'run',
  sessionType: 'easy',
  keySession: false,
  placeholder: false,
  actualSessionType: null,
  plannedDurationSeconds: 1800,
  plannedDistanceMetres: 5000,
  plannedRpe: 3,
  status: 'done',
  performedOn: '2026-10-14',
  actualDurationSeconds: 1800,
  actualDistanceMetres: 5000,
  rpe: null,
  feel: null,
  reasons: [],
  answers: {},
  answersSchemaVersion: 1,
  note: null,
  source: 'manual',
  createdAt: '2026-10-14T12:00:00Z',
  updatedAt: '2026-10-14T12:00:00Z',
};
const summary = (id: string, name: string, date: string, startTime: string) => ({
  provider: 'strava' as const,
  id,
  url: `https://www.strava.com/activities/${id}`,
  name,
  sport: 'run' as const,
  sportType: 'Run',
  date,
  startTime,
  elapsedSeconds: 2010,
  movingSeconds: 1950,
  distanceMetres: 6200,
  elevationGainMetres: 41,
});
let links: ActivityLink[] = [];
let connection: { status: string } | null = { status: 'active' };

beforeEach(() => {
  vi.resetAllMocks();
  links = [];
  connection = { status: 'active' };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/api/v1/integrations')
      return {
        data: {
          strava: {
            available: true,
            connection: connection && {
              ...connection,
              displayName: 'Test Runner',
              connectedAt: '2026-10-01T00:00:00Z',
            },
          },
        },
      };
    if (path === '/api/v1/plans/{planId}/activity-links') return { data: { links } };
    if (path === '/api/v1/integrations/strava/activities')
      return {
        data: {
          from: '2026-10-07',
          to: '2026-10-21',
          activities: [
            summary('202', 'Morning Run', '2026-10-14', '07:05'),
            summary('101', 'Lunch shakeout', '2026-10-12', '12:30'),
          ],
        },
      };
    if (path === '/api/v1/integrations/strava/activities/{activityId}')
      return {
        data: {
          ...summary('202', 'Morning Run', '2026-10-14', '07:05'),
          description: 'Legs felt heavy.',
          deviceName: 'Garmin Forerunner 965',
          averageSpeed: 3.18,
          maxSpeed: 4.1,
          averageHeartrate: 147,
          maxHeartrate: 166,
          averageCadence: 84,
          averageWatts: null,
          calories: 410,
          trainer: false,
          manual: false,
          laps: [1, 2].map((index) => ({
            index,
            name: `Lap ${index}`,
            elapsedSeconds: 315,
            movingSeconds: 312,
            distanceMetres: 1000,
            averageSpeed: 3.2,
            averageHeartrate: 145 + index,
            averageCadence: 84,
            averageWatts: null,
          })),
        },
      };
    return { data: { today: '2026-10-14', logs: [log], checkIns: [], summary: {} } };
  });
  mocks.put.mockImplementation(async (_path: string, options: { body: { activityId: string } }) => {
    links = [
      {
        lineageId: 'lineage',
        provider: 'strava',
        activityId: options.body.activityId,
        url: `https://www.strava.com/activities/${options.body.activityId}`,
        linkedAt: '2026-10-14T12:00:00Z',
      },
    ];
    return { data: { links } };
  });
  mocks.remove.mockImplementation(async () => {
    links = [];
    return { data: { links } };
  });
});
afterEach(cleanup);

function mount() {
  return createMemoryRouter([
    {
      path: '/',
      element: (
        <AccountQueryProvider accountId="test">
          <TrainingLogProvider plan={plan}>
            <WorkoutLogActions workout={workout} />
          </TrainingLogProvider>
        </AccountQueryProvider>
      ),
    },
  ]);
}

it('links an activity the athlete chooses, then always offers View on Strava', async () => {
  render(<RouterProvider router={mount()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Find my activity' }));
  const picker = await screen.findByRole('dialog', { name: /Find my activity/ });
  expect(await within(picker).findByText('Planned day')).toBeInTheDocument();
  expect(within(picker).getByText('2 days before')).toBeInTheDocument();
  expect(within(picker).getByText(/Strava details are displayed temporarily/)).toBeInTheDocument();
  fireEvent.click(within(picker).getByRole('button', { name: /Link Morning Run/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.put).toHaveBeenCalledWith(
    '/api/v1/plans/{planId}/workouts/{lineageId}/activity-link',
    {
      params: { path: { planId: 'plan', lineageId: 'lineage' } },
      body: { provider: 'strava', activityId: '202' },
    },
  );
  expect(screen.getByRole('link', { name: /View on Strava/ })).toHaveAttribute(
    'href',
    'https://www.strava.com/activities/202',
  );
  // Outside the log sheet only the link is known: no activity details are fetched.
  expect(mocks.get).not.toHaveBeenCalledWith(
    '/api/v1/integrations/strava/activities/{activityId}',
    expect.anything(),
  );
});

it('shows the linked activity beside the log sheet without filling in the form', async () => {
  links = [
    {
      lineageId: 'lineage',
      provider: 'strava',
      activityId: '202',
      url: 'https://www.strava.com/activities/202',
      linkedAt: '2026-10-14T12:00:00Z',
    },
  ];
  render(<RouterProvider router={mount()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add details' }));
  const sheet = await screen.findByRole('dialog', { name: /Easy run/ });
  fireEvent.click(await within(sheet).findByRole('button', { name: 'Show details' }));
  const panel = await within(sheet).findByRole('region', { name: 'Strava activity details' });
  expect(await within(panel).findByText('Morning Run')).toBeInTheDocument();
  expect(within(panel).getByText('147 bpm')).toBeInTheDocument();
  expect(within(panel).getByText('Legs felt heavy.')).toBeInTheDocument();
  expect(within(panel).getAllByRole('row')).toHaveLength(3);
  expect(within(panel).getByRole('link', { name: /View on Strava/ })).toBeInTheDocument();
  expect(within(panel).getByText(/saved separately/)).toBeInTheDocument();
  // The athlete's own numbers stay as they were: 30 minutes and 5,000 m, not Strava's.
  expect(within(sheet).getByLabelText('Actual time (minutes)')).toHaveValue(30);
  expect(within(sheet).getByLabelText('Actual distance (metres)')).toHaveValue(5000);

  fireEvent.click(within(panel).getByRole('button', { name: 'Hide Strava details' }));
  expect(within(sheet).queryByRole('region', { name: 'Strava activity details' })).toBeNull();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Unlink' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalled());
  expect(await within(sheet).findByRole('button', { name: 'Find my activity' })).toBeVisible();
});

it('keeps the Strava link but hides lookups when the grant needs reconnecting', async () => {
  connection = { status: 'reauthorization_required' };
  links = [
    {
      lineageId: 'lineage',
      provider: 'strava',
      activityId: '202',
      url: 'https://www.strava.com/activities/202',
      linkedAt: '2026-10-14T12:00:00Z',
    },
  ];
  render(<RouterProvider router={mount()} />);
  expect(await screen.findByRole('link', { name: /View on Strava/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Find my activity' })).toBeNull();
});

it('offers to connect Strava from the log sheet when it isn’t connected', async () => {
  connection = null;
  render(<RouterProvider router={mount()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add details' }));
  const sheet = await screen.findByRole('dialog', { name: /Easy run/ });
  expect(await within(sheet).findByRole('link', { name: 'Connect Strava' })).toHaveAttribute(
    'href',
    '/settings#connections',
  );
  expect(within(sheet).queryByRole('button', { name: 'Find my activity' })).toBeNull();
});
