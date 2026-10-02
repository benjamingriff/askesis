import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AccountQueryProvider } from '../query-provider';
import { ActivePlansPage } from './active-plans';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get, POST: vi.fn() } }));
const version = {
  id: 'locked-a',
  state: 'locked',
  editNumber: 1,
  versionNumber: 1,
  description: 'Stable schedule',
  startDate: '2026-09-01',
  endDate: '2026-10-01',
};
const plans = [
  {
    id: 'plan-a',
    displayName: 'First plan',
    active: true,
    archived: false,
    stateVersion: 1,
    locked: version,
    draft: { ...version, id: 'draft-a', state: 'draft', description: 'Draft schedule' },
  },
  {
    id: 'plan-b',
    displayName: 'Second plan',
    active: true,
    archived: false,
    stateVersion: 1,
    locked: { ...version, id: 'locked-b' },
    draft: null,
  },
];
const brief = {
  versionId: 'locked-a',
  editNumber: 1,
  startDate: version.startDate,
  endDate: version.endDate,
  readOnly: true,
  confirmed: true,
  hash: 'h',
  scheduleReviewRequired: false,
  coverage: [],
  calibrations: [],
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
function mount(accountId = 'athlete-a') {
  const router = createMemoryRouter([{ path: '/plan', element: <ActivePlansPage /> }], {
    initialEntries: ['/plan'],
  });
  return render(
    <AccountQueryProvider accountId={accountId}>
      <RouterProvider router={router} />
    </AccountQueryProvider>,
  );
}
const workoutCalls = () =>
  mocks.get.mock.calls
    .filter(([path]) => path === '/api/v1/workouts')
    .map(([, options]) => options.params.query.planVersionId);
beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (path: string) => ({
    data:
      path === '/api/v1/plans'
        ? { plans }
        : path === '/api/v1/workouts'
          ? { workouts: [] }
          : path.endsWith('/revisions')
            ? { revisions: [] }
            : brief,
  }));
});
afterEach(cleanup);

it('requests explicit versions when switching source and plans, and remembers the selection', async () => {
  const page = mount();
  await screen.findByText('Stable schedule');
  await waitFor(() => expect(workoutCalls()).toContain('locked-a'));
  fireEvent.click(screen.getByRole('radio', { name: 'Draft' }));
  await screen.findByText('Draft schedule');
  await waitFor(() => expect(workoutCalls()).toContain('draft-a'));
  page.unmount();
  mount();
  expect(await screen.findByRole('radio', { name: 'Draft' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  fireEvent.change(screen.getByLabelText('Active plan'), { target: { value: 'plan-b' } });
  await waitFor(() => expect(workoutCalls()).toContain('locked-b'));
  expect(screen.queryByRole('radiogroup', { name: 'Content source' })).not.toBeInTheDocument();
});

it('falls back safely when a remembered plan or draft no longer exists', async () => {
  localStorage.setItem(
    'askesis-plan-selection:athlete-a',
    JSON.stringify({ planId: 'archived-plan', view: 'draft' }),
  );
  mount();
  expect(await screen.findByLabelText('Active plan')).toHaveValue('plan-a');
  expect(screen.getByRole('radio', { name: 'Locked v1' })).toHaveAttribute('aria-checked', 'true');
  expect(
    mocks.get.mock.calls.some(
      ([, options]) => options?.params?.query?.planVersionId === 'archived-plan',
    ),
  ).toBe(false);
});

it('does not reuse another account’s preference', async () => {
  localStorage.setItem(
    'askesis-plan-selection:athlete-a',
    JSON.stringify({ planId: 'plan-b', view: 'locked' }),
  );
  mount('athlete-b');
  expect(await screen.findByLabelText('Active plan')).toHaveValue('plan-a');
});

it('shows an empty state without requesting an implicit schedule', async () => {
  mocks.get.mockResolvedValue({ data: { plans: [] } });
  mount();
  await screen.findByRole('heading', { name: 'No active plans' });
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
