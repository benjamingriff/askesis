import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from './query-provider';
import { useBriefState, useWorkoutDetail, type PlanVersion } from './plan-data';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./api', () => ({ api: { GET: mocks.get } }));
const version: PlanVersion = {
  id: 'draft-1',
  state: 'draft',
  editNumber: 1,
  versionNumber: null,
  description: null,
  startDate: '2027-01-11',
  endDate: '2027-01-24',
  basedOnVersionId: null,
  supersedesVersionId: null,
  lockedAt: null,
};
function Brief({ version }: { version: PlanVersion }) {
  const brief = useBriefState('plan', version);
  return (
    <div>
      {brief.data?.brief.goal} / {brief.data?.coverage[0]?.endDate}
    </div>
  );
}
function Workout({ version }: { version: PlanVersion }) {
  const detail = useWorkoutDetail('workout', version);
  return <div>{detail.data?.workout.title}</div>;
}
beforeEach(() => mocks.get.mockReset());
afterEach(cleanup);

it.each([
  { ...version, editNumber: 2 },
  { ...version, id: 'draft-2' },
])('refreshes draft coverage when the version metadata changes: %j', async (updated) => {
  mocks.get
    .mockResolvedValueOnce({
      data: {
        brief: { goal: 'Earlier assumptions' },
        coverage: [{ endDate: '2027-01-12' }],
      },
    })
    .mockResolvedValueOnce({
      data: {
        brief: { goal: 'Latest assumptions' },
        coverage: [{ endDate: '2027-01-19' }],
      },
    });
  const page = render(
    <AccountQueryProvider>
      <Brief version={version} />
    </AccountQueryProvider>,
  );
  await screen.findByText('Earlier assumptions / 2027-01-12');
  page.rerender(
    <AccountQueryProvider>
      <Brief version={updated} />
    </AccountQueryProvider>,
  );
  await screen.findByText('Latest assumptions / 2027-01-19');
  expect(mocks.get).toHaveBeenCalledTimes(2);
});

it('reads the revision brief once a draft is locked in place with the same id and edit', async () => {
  mocks.get.mockResolvedValue({
    data: { brief: { goal: 'Assumptions' }, coverage: [] },
  });
  const page = render(
    <AccountQueryProvider>
      <Brief version={version} />
    </AccountQueryProvider>,
  );
  await screen.findByText(/Assumptions/);
  page.rerender(
    <AccountQueryProvider>
      <Brief version={{ ...version, state: 'locked', versionNumber: 1 }} />
    </AccountQueryProvider>,
  );
  await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  expect(mocks.get.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/plans/{planId}/draft/brief',
    '/api/v1/plans/{planId}/revisions/{revisionId}/brief',
  ]);
});

it('reloads a recently viewed workout when the draft edit advances', async () => {
  mocks.get
    .mockResolvedValueOnce({ data: { workout: { title: 'Earlier prescription' } } })
    .mockResolvedValueOnce({ data: { workout: { title: 'Latest prescription' } } });
  const page = render(
    <AccountQueryProvider>
      <Workout version={version} />
    </AccountQueryProvider>,
  );
  await screen.findByText('Earlier prescription');
  page.rerender(
    <AccountQueryProvider>
      <Workout version={{ ...version, editNumber: 2 }} />
    </AccountQueryProvider>,
  );
  await screen.findByText('Latest prescription');
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
