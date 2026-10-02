import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { paths } from '@askesis/api-client';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
import { PlanBriefPage } from './plan-brief';

vi.mock('../api', () => ({ api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } }));
type State =
  paths['/api/v1/plans/{planId}/draft/brief']['get']['responses'][200]['content']['application/json'];
let state: State;
beforeEach(() => {
  vi.resetAllMocks();
  state = {
    versionId: 'draft-1',
    editNumber: 1,
    startDate: '2026-09-01',
    endDate: '2026-12-01',
    readOnly: false,
    confirmed: false,
    hash: 'hash',
    scheduleReviewRequired: false,
    findings: [],
    coverage: [],
    calibrations: [],
    brief: {
      goal: 'Run a comfortable half marathon',
      unit: 'kilometres',
      timezone: 'Europe/London',
      weeklyDistance: { status: 'known', value: 30000 },
      currentRuns: { status: 'known', value: 4 },
      longestRun: { status: 'unknown', value: null },
      desiredRuns: 4,
      weekdays: [
        'available',
        'available',
        'available',
        'available',
        'available',
        'available',
        'available',
      ],
      context: '',
    },
  };
  vi.mocked(api.GET).mockImplementation(async () => ({
    data: structuredClone(state),
    response: new Response(),
  }));
});
afterEach(cleanup);
function mount() {
  const router = createMemoryRouter(
    [{ path: '/plans/:planId/brief', element: <PlanBriefPage /> }],
    {
      initialEntries: ['/plans/plan-1/brief'],
    },
  );
  render(
    <AccountQueryProvider>
      <RouterProvider router={router} />
    </AccountQueryProvider>,
  );
}

it('switches display units without changing the saved baseline distance', async () => {
  mount();
  fireEvent.change(await screen.findByLabelText('Units'), { target: { value: 'miles' } });
  expect(
    Number((screen.getByLabelText('Typical weekly running distance') as HTMLInputElement).value),
  ).toBeCloseTo(18.6411, 3);
  vi.mocked(api.PUT).mockResolvedValue({ data: state, response: new Response() });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.PUT).toHaveBeenCalledWith(
      '/api/v1/plans/{planId}/draft/brief',
      expect.objectContaining({
        body: expect.objectContaining({
          brief: expect.objectContaining({
            unit: 'miles',
            weeklyDistance: { status: 'known', value: 30000 },
          }),
        }),
      }),
    ),
  );
});

it('requires explicit review and warning acknowledgement before confirmation', async () => {
  state.findings = [
    { code: 'VOLUME', severity: 'warning', message: 'Review the increase in runs.', path: 'brief' },
  ];
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review brief for confirmation' }));
  expect(api.POST).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm brief' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Review the increase in runs.' }));
  vi.mocked(api.POST).mockResolvedValue({ data: state, response: new Response() });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm brief' }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/plans/{planId}/draft/brief/confirm',
      expect.objectContaining({
        body: expect.objectContaining({
          expectedHash: 'hash',
          acknowledgedWarningCodes: ['VOLUME'],
        }),
      }),
    ),
  );
});

it('converts a miles threshold input to canonical seconds per kilometre', async () => {
  state.brief.unit = 'miles';
  mount();
  fireEvent.change(await screen.findByLabelText('Fitness input'), {
    target: { value: 'threshold_pace' },
  });
  fireEvent.change(screen.getByLabelText('Threshold pace (min/mi)'), { target: { value: '8:00' } });
  vi.mocked(api.POST).mockResolvedValue({ data: state, response: new Response() });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate and save pace guides' }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/plans/{planId}/draft/calibrations',
      expect.objectContaining({
        body: expect.objectContaining({
          input: { method: 'threshold_pace', secondsPerKilometre: 480 / 1.609344 },
        }),
      }),
    ),
  );
});

it('shows a partial prescribed horizon, the unplanned remainder and estimated pace provenance', async () => {
  state.coverage = [{ startDate: '2026-09-01', endDate: '2026-09-30', current: true }];
  state.calibrations = [
    {
      id: 'estimate',
      effectiveFrom: '2026-09-01',
      effectiveUntil: null,
      method: 'threshold_pace',
      distanceMetres: null,
      durationSeconds: null,
      secondsPerKilometre: 330,
      calculatorVersion: 'v1',
      provenance: 'agent_estimate',
      estimateBasis: 'Reported comfortable pace; refine after early runs.',
      zones: [],
    },
  ];
  mount();
  expect(await screen.findByText('2026-09-01 – 2026-09-30')).toBeInTheDocument();
  expect(screen.getByText('2026-10-01 – 2026-12-01')).toBeInTheDocument();
  expect(screen.getAllByText(/Coach estimate: Reported comfortable pace/).length).toBeGreaterThan(
    0,
  );
  expect(screen.getAllByText(/These paces are estimates/).length).toBeGreaterThan(0);
});
