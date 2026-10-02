import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { TodayPage } from './today';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get, POST: vi.fn() } }));

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
  calibrations: [
    {
      id: 'cal',
      effectiveFrom: '2027-01-01',
      effectiveUntil: null,
      method: 'threshold_pace',
      distanceMetres: null,
      durationSeconds: null,
      secondsPerKilometre: 330,
      calculatorVersion: 'v1',
      provenance: 'user_estimate',
      estimateBasis: null,
      zones: [{ key: 'easy', target: 400, fast: 380, slow: 420 }],
    },
  ],
  findings: [],
  brief: {
    goal: '',
    unit: 'kilometres',
    timezone: 'UTC',
    weeklyDistance: { status: 'unanswered', value: null },
    currentRuns: { status: 'unanswered', value: null },
    longestRun: { status: 'unanswered', value: null },
    desiredRuns: null,
    weekdays: Array(7).fill('available'),
    context: '',
  },
};
function mount() {
  const router = createMemoryRouter([{ path: '/today', element: <TodayPage /> }], {
    initialEntries: ['/today'],
  });
  render(
    <AccountQueryProvider accountId="athlete">
      <RouterProvider router={router} />
    </AccountQueryProvider>,
  );
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
  mocks.get.mockImplementation(async (path: string) => ({
    data:
      path === '/api/v1/plans'
        ? { plans: [plan] }
        : path === '/api/v1/workouts'
          ? { workouts: [] }
          : brief,
  }));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

it('shows the locked schedule and links pace details to the locked brief', async () => {
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
    '/plans/plan-a/versions/locked-a/brief',
  );
  expect(await screen.findByText('Rest day')).toBeInTheDocument();
});

it('distinguishes dates beyond the prescribed coverage from rest days', async () => {
  mount();
  await screen.findByText('Rest day');
  fireEvent.click(screen.getByRole('button', { name: 'Wednesday 13 January' }));
  expect(await screen.findByText('Not planned yet')).toBeInTheDocument();
  expect(screen.queryByText('Rest day')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Plan it with your coach' })).toBeInTheDocument();
});
