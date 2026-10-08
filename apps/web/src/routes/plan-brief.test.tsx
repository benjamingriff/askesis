import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { paths, PerformanceState } from '@askesis/api-client';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
import { PlanBriefPage } from './plan-brief';
import { CoverageSummary } from '../components/PlanningReview';

vi.mock('../api', () => ({ api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } }));
type State =
  paths['/api/v1/plans/{planId}/draft/brief']['get']['responses'][200]['content']['application/json'];
let state: State;
let performance: PerformanceState;
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
    brief: {
      goal: 'Run a comfortable half marathon',
      unit: 'kilometres',
      sports: [
        {
          sport: 'run',
          currentSessions: { status: 'known', value: 4 },
          desiredSessions: 4,
          weeklyDistance: { status: 'known', value: 30000 },
          longestDistance: { status: 'unknown', value: null },
        },
      ],
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
  performance = {
    timezone: 'Europe/London',
    today: '2026-09-01',
    current: [],
    entries: [],
    usedByPlans: [],
  };
  vi.mocked(api.GET).mockImplementation(
    async (path) =>
      ({
        data: structuredClone(path === '/api/v1/performance' ? performance : state),
        response: new Response(),
      }) as Awaited<ReturnType<typeof api.GET>>,
  );
});
afterEach(cleanup);
it('distinguishes the intended month from completed coverage after generation stops', () => {
  state.coverage = [{ startDate: '2026-09-01', endDate: '2026-09-07', current: true }];
  state.generations = [
    {
      runId: 'run-1',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      prescribedThrough: '2026-09-07',
      status: 'interrupted',
    },
  ];
  render(<CoverageSummary state={state} />);
  expect(screen.getByLabelText('Generation attempts')).toHaveTextContent(
    'Intended horizon: 1 Sept – 30 Sept 2026',
  );
  expect(screen.getByLabelText('Generation attempts')).toHaveTextContent(
    'Generation stopped before the intended horizon was complete',
  );
  expect(screen.getByLabelText('Generation attempts')).toHaveTextContent(
    'Fully prescribed through 7 Sept 2026',
  );
  expect(screen.getByText('Still unplanned')).toBeInTheDocument();
  expect(screen.getByText('8 Sept – 1 Dec 2026')).toBeInTheDocument();
});
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
            sports: [
              expect.objectContaining({ weeklyDistance: { status: 'known', value: 30000 } }),
            ],
          }),
        }),
      }),
    ),
  );
});

it.each(['save', 'confirm'] as const)(
  'reuses the body request key when retrying %s after a connection failure',
  async (action) => {
    vi.mocked(api.PUT).mockRejectedValue(new Error('Connection lost'));
    vi.mocked(api.POST).mockRejectedValue(new Error('Connection lost'));
    mount();
    await screen.findByLabelText('Goal');
    if (action === 'save') {
      fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'A revised goal' } });
    }
    const submit = () => {
      if (action === 'confirm') {
        fireEvent.click(screen.getByRole('button', { name: 'Review brief for confirmation' }));
      }
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'save' ? 'Save changes' : 'Confirm brief',
        }),
      );
    };
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    const calls = action === 'save' ? vi.mocked(api.PUT) : vi.mocked(api.POST);
    expect(calls.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          expectedDraftId: 'draft-1',
          expectedEditNumber: 1,
          idempotencyKey: expect.any(String),
        }),
      }),
    );
    submit();
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
    expect(calls.mock.calls[1]).toEqual(calls.mock.calls[0]);
  },
);

it('uses a distinct key for changed brief input and retains the previous input key', async () => {
  vi.mocked(api.PUT).mockRejectedValue(new Error('Connection lost'));
  mount();
  const goal = await screen.findByLabelText('Goal');
  for (const value of ['First goal', 'Changed goal', 'First goal']) {
    fireEvent.change(goal, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  }
  const calls = vi.mocked(api.PUT).mock.calls;
  expect(calls).toHaveLength(3);
  expect(calls[1]?.[1]?.body?.idempotencyKey).not.toBe(calls[0]?.[1]?.body?.idempotencyKey);
  expect(calls[2]).toEqual(calls[0]);
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

it('reveals a failed confirmation and lets the athlete refresh and review the latest brief', async () => {
  vi.mocked(api.POST).mockRejectedValueOnce(new Error('The brief changed elsewhere.'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review brief for confirmation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm brief' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The brief changed elsewhere.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  state = {
    ...state,
    editNumber: 2,
    hash: 'latest-hash',
    brief: { ...state.brief, goal: 'Updated goal' },
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh latest brief' }));
  await waitFor(() => expect(screen.getByLabelText('Goal')).toHaveValue('Updated goal'));
  fireEvent.click(screen.getByRole('button', { name: 'Review brief for confirmation' }));
  vi.mocked(api.POST).mockResolvedValue({ data: state, response: new Response() });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm brief' }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(api.POST).toHaveBeenLastCalledWith(
    '/api/v1/plans/{planId}/draft/brief/confirm',
    expect.objectContaining({
      body: expect.objectContaining({ expectedEditNumber: 2, expectedHash: 'latest-hash' }),
    }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('shows a partial prescribed horizon, the unplanned remainder and the athlete’s estimated paces', async () => {
  state.coverage = [{ startDate: '2026-09-01', endDate: '2026-09-30', current: true }];
  const estimate: PerformanceState['current'][number] = {
    id: '00000000-0000-4000-8000-000000000001',
    system: 'run_pace',
    method: 'threshold_pace',
    input: { method: 'threshold_pace', secondsPerKilometre: 330 },
    calculatorVersion: 'run-pace-v1',
    provenance: 'agent_estimate',
    estimateBasis: 'Reported comfortable pace; refine after early runs.',
    observedOn: null,
    effectiveFrom: '2026-09-01',
    recordedAt: '2026-09-01T09:00:00.000Z',
    recordedBy: 'coach',
    conversationId: null,
    retractedAt: null,
    zones: [],
  };
  performance = { ...performance, current: [estimate], entries: [estimate] };
  mount();
  expect(await screen.findByText('1 Sept – 30 Sept 2026')).toBeInTheDocument();
  expect(screen.getByText('1 Oct – 1 Dec 2026')).toBeInTheDocument();
  expect(screen.getAllByText(/Coach estimate: Reported comfortable pace/).length).toBeGreaterThan(
    0,
  );
  expect(screen.getAllByText(/These are estimates/).length).toBeGreaterThan(0);
});

it('links fitness to the Performance page instead of editing it in the brief', async () => {
  mount();
  expect(await screen.findByRole('link', { name: 'Update' })).toHaveAttribute(
    'href',
    '/performance',
  );
  expect(screen.queryByLabelText('Fitness input')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Plan timezone')).not.toBeInTheDocument();
});

it('adds sports with their own baselines and saves them in sport order', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Swim' }));
  fireEvent.click(screen.getByRole('button', { name: 'Strength' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ride' }));
  expect(screen.getByText('Swimming background')).toBeInTheDocument();
  expect(screen.getByText('Cycling background')).toBeInTheDocument();
  expect(screen.queryByLabelText('Longest recent strength session')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ride' }));
  expect(screen.queryByText('Cycling background')).not.toBeInTheDocument();
  vi.mocked(api.PUT).mockResolvedValue({ data: state, response: new Response() });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalled());
  const body = (vi.mocked(api.PUT).mock.calls[0]![1] as { body: { brief: { sports: object[] } } })
    .body;
  expect(body.brief.sports).toEqual([
    expect.objectContaining({ sport: 'run' }),
    {
      sport: 'swim',
      currentSessions: { status: 'unanswered', value: null },
      desiredSessions: null,
      weeklyDistance: { status: 'unanswered', value: null },
      longestDistance: { status: 'unanswered', value: null },
    },
    {
      sport: 'strength',
      currentSessions: { status: 'unanswered', value: null },
      desiredSessions: null,
    },
  ]);
});
