import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AccountQueryProvider } from '../query-provider';
import { PlanHistory, PlanRevisionPage } from './plan-history';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get, POST: mocks.post } }));
const summary = { headerChanges: ['description'], entities: {} };
const revision = {
  id: 'v1',
  versionNumber: 1,
  description: 'Original training',
  startDate: '2026-09-01',
  endDate: '2026-10-01',
  lockedAt: '2026-09-01T12:00:00Z',
  validatorVersion: 1,
  findings: [],
  acknowledgedWarningCodes: [],
  summary,
};
const current = {
  id: 'plan',
  displayName: 'Training',
  stateVersion: 4,
  archived: false,
  draft: null,
  locked: { id: 'v2', versionNumber: 2 },
};
const preview = {
  sourceRevisionId: 'v1',
  currentVersionId: 'v2',
  stateVersion: 4,
  sourceHash: 'a'.repeat(64),
  summary,
};
const emptyBrief = {
  coverage: [],
  findings: [],
  brief: { unit: 'kilometres' },
};
function mount(history = false) {
  const router = createMemoryRouter(
    [
      { path: '/plans/:planId/versions/:revisionId', element: <PlanRevisionPage /> },
      {
        path: '/plans/:planId',
        element: history ? (
          <PlanHistory planId="plan" basedOnVersionId="v1" />
        ) : (
          <h1>Restored draft</h1>
        ),
      },
    ],
    { initialEntries: [history ? '/plans/plan' : '/plans/plan/versions/v1'] },
  );
  render(
    <AccountQueryProvider>
      <RouterProvider router={router} />
    </AccountQueryProvider>,
  );
}
beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.get.mockImplementation(async (path: string) => ({
    data:
      path === '/api/v1/plans/{planId}'
        ? current
        : path === '/api/v1/plans/{planId}/revisions'
          ? { revisions: [revision] }
          : path === '/api/v1/workouts'
            ? { workouts: [] }
            : path.endsWith('/brief')
              ? emptyBrief
              : { revision, content: { description: revision.description } },
  }));
  mocks.post.mockImplementation(async (path: string) => ({
    data: path.endsWith('restore-preview') ? preview : { ...current, draft: { id: 'new-draft' } },
  }));
});
afterEach(cleanup);

it('shows history links and the historical source of a restored draft', async () => {
  mount(true);
  expect(await screen.findByRole('link', { name: 'Version 1' })).toHaveAttribute(
    'href',
    '/plans/plan/versions/v1',
  );
  expect(screen.getByText('The editable draft is based on version 1.')).toBeInTheDocument();
});

it('loads the exact historical schedule and requires preview before restoring', async () => {
  mount();
  const review = await screen.findByRole('button', { name: 'Review restore as draft' });
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/workouts', {
      params: { query: { planVersionId: 'v1' } },
    }),
  );
  expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.click(review);
  const confirm = await screen.findByRole('button', { name: 'Confirm restore as draft' });
  expect(
    screen.getByText(/Current locked version 2 and all history remain unchanged/),
  ).toBeInTheDocument();
  expect(mocks.post).toHaveBeenCalledTimes(1);
  fireEvent.click(confirm);
  await screen.findByRole('heading', { name: 'Restored draft' });
  expect(mocks.post).toHaveBeenLastCalledWith(
    '/api/v1/plans/{planId}/revisions/{revisionId}/restore',
    {
      params: {
        path: { planId: 'plan', revisionId: 'v1' },
        header: { 'idempotency-key': expect.any(String) },
      },
      body: {
        expectedStateVersion: 4,
        expectedCurrentVersionId: 'v2',
        expectedSourceHash: preview.sourceHash,
      },
    },
  );
});

it('clears the confirmation after a stale restore rejection', async () => {
  mocks.post.mockImplementation(async (path: string) =>
    path.endsWith('restore-preview')
      ? { data: preview }
      : { error: { error: { message: 'This plan changed elsewhere.' } } },
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review restore as draft' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm restore as draft' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This plan changed elsewhere.');
  expect(
    screen.queryByRole('button', { name: 'Confirm restore as draft' }),
  ).not.toBeInTheDocument();
});

it('retains restore retry keys while distinguishing changed reviewed metadata', async () => {
  let reviewed = preview;
  mocks.post.mockImplementation(async (path: string) => {
    if (path.endsWith('restore-preview')) return { data: reviewed };
    throw new Error('Connection lost');
  });
  mount();
  for (const sourceHash of [
    preview.sourceHash,
    preview.sourceHash,
    'b'.repeat(64),
    preview.sourceHash,
  ]) {
    reviewed = { ...preview, sourceHash };
    fireEvent.click(await screen.findByRole('button', { name: 'Review restore as draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm restore as draft' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Confirm restore as draft' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  }
  const restores = mocks.post.mock.calls.filter(([path]) => path.endsWith('/restore'));
  expect(restores).toHaveLength(4);
  expect(restores[0]?.[1]).toEqual({
    params: {
      path: { planId: 'plan', revisionId: 'v1' },
      header: { 'idempotency-key': expect.any(String) },
    },
    body: {
      expectedStateVersion: 4,
      expectedCurrentVersionId: 'v2',
      expectedSourceHash: preview.sourceHash,
    },
  });
  expect(restores[1]).toEqual(restores[0]);
  expect(restores[2]?.[1].params.header['idempotency-key']).not.toBe(
    restores[0]?.[1].params.header['idempotency-key'],
  );
  expect(restores[2]?.[1].body.expectedSourceHash).toBe('b'.repeat(64));
  expect(restores[3]).toEqual(restores[0]);
});

it.each([
  [{ ...current, archived: true }, 'Unarchive this plan before restoring.'],
  [{ ...current, draft: { id: 'draft' } }, 'Lock or discard the existing draft before restoring.'],
  [
    { ...current, locked: { id: 'v1', versionNumber: 1 } },
    'This is already the current locked version.',
  ],
])('keeps ineligible versions inspectable without allowing restore', async (plan, message) => {
  mocks.get.mockImplementation(async (path: string) => ({
    data:
      path === '/api/v1/plans/{planId}'
        ? plan
        : path === '/api/v1/workouts'
          ? { workouts: [] }
          : path.endsWith('/brief')
            ? emptyBrief
            : { revision, content: {} },
  }));
  mount();
  expect(await screen.findByRole('button', { name: 'Review restore as draft' })).toBeDisabled();
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByText('Original training')).toBeInTheDocument();
});

it.each(['loaded', 'failed'])(
  'renders historical rest days only with loaded coverage (%s request)',
  async (status) => {
    const brief = {
      versionId: 'v1',
      editNumber: 1,
      startDate: '2027-01-11',
      endDate: '2027-01-24',
      readOnly: true,
      confirmed: true,
      hash: 'h',
      scheduleReviewRequired: false,
      coverage: [{ startDate: '2027-01-11', endDate: '2027-01-12', current: true }],
      findings: [],
      brief: { unit: 'kilometres' },
    };
    const historical = { ...revision, startDate: '2027-01-11', endDate: '2027-01-24' };
    mocks.get.mockImplementation(async (path: string) => ({
      data:
        path === '/api/v1/plans/{planId}'
          ? current
          : path === '/api/v1/plans/{planId}/revisions'
            ? { revisions: [historical] }
            : path === '/api/v1/plans/{planId}/revisions/{revisionId}/brief'
              ? brief
              : path === '/api/v1/workouts'
                ? {
                    workouts: [
                      {
                        id: 'w1',
                        planId: 'plan',
                        planVersionId: 'v1',
                        planTitle: 'Training',
                        weekNumber: 1,
                        scheduledDate: '2027-01-12',
                        title: '6 km easy run',
                        description: null,
                        purpose: null,
                        discipline: 'running',
                        priority: 'medium',
                        estimatedDurationSeconds: 2400,
                        estimatedDistanceMetres: 6000,
                      },
                    ],
                  }
                : { revision: historical, content: {} },
    }));
    if (status === 'failed') {
      const loaded = mocks.get.getMockImplementation()!;
      let rejectBrief!: (error: Error) => void;
      const pendingBrief = new Promise((_, reject) => {
        rejectBrief = reject;
      });
      mocks.get.mockImplementation((path: string) =>
        path.endsWith('/brief') ? pendingBrief : loaded(path),
      );
      mount();
      await screen.findByText('Loading historical schedule…');
      await waitFor(() =>
        expect(mocks.get).toHaveBeenCalledWith('/api/v1/workouts', expect.anything()),
      );
      expect(screen.queryByRole('button', { name: /6 km easy run/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Rest day')).not.toBeInTheDocument();
      rejectBrief(new Error('Connection lost'));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t load this version’s coverage: Connection lost',
      );
      expect(screen.queryByRole('button', { name: /6 km easy run/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Rest day')).not.toBeInTheDocument();
      mocks.get.mockImplementation(loaded);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    } else {
      mount();
    }
    await screen.findByRole('button', { name: /6 km easy run/ });
    await waitFor(() => expect(screen.getAllByText('Not planned yet')).toHaveLength(5));
    expect(screen.getAllByText('Rest day')).toHaveLength(1);
  },
);
