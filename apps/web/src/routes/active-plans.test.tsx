import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AccountQueryProvider } from '../query-provider';
import { ActivePlansPage } from './active-plans';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get } }));
const version = {
  id: 'locked-a',
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
    locked: version,
    draft: { ...version, id: 'draft-a', description: 'Draft schedule' },
  },
  {
    id: 'plan-b',
    displayName: 'Second plan',
    active: true,
    archived: false,
    locked: { ...version, id: 'locked-b' },
    draft: null,
  },
];
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
beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (path: string) => ({
    data: path === '/api/v1/plans' ? { plans } : { workouts: [] },
  }));
});
afterEach(cleanup);

it('requests explicit versions when switching source and plans, and remembers the selection', async () => {
  const page = mount();
  await screen.findByText('Stable schedule');
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/workouts', {
      params: { query: { planVersionId: 'locked-a' } },
    }),
  );
  fireEvent.change(screen.getByLabelText('Content source'), { target: { value: 'draft' } });
  await screen.findByText('Draft schedule');
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/workouts', {
      params: { query: { planVersionId: 'draft-a' } },
    }),
  );
  page.unmount();
  mount();
  expect(await screen.findByLabelText('Content source')).toHaveValue('draft');
  fireEvent.change(screen.getByLabelText('Active plan'), { target: { value: 'plan-b' } });
  expect(screen.getByLabelText('Content source')).toHaveValue('locked');
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/workouts', {
      params: { query: { planVersionId: 'locked-b' } },
    }),
  );
});

it('falls back safely when a remembered plan or draft no longer exists', async () => {
  localStorage.setItem(
    'askesis-plan-selection:athlete-a',
    JSON.stringify({ planId: 'archived-plan', view: 'draft' }),
  );
  mount();
  expect(await screen.findByLabelText('Active plan')).toHaveValue('plan-a');
  expect(screen.getByLabelText('Content source')).toHaveValue('locked');
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
