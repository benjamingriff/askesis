import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
import type { Plan } from '../plan-data';
import { PlanPage, PlansPage } from './plans';

vi.mock('../api', () => ({ api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } }));
const draft = {
  id: 'draft-1',
  state: 'draft' as const,
  versionNumber: null,
  editNumber: 1,
  description: 'My plan',
  startDate: '2026-09-01',
  endDate: '2026-10-01',
  basedOnVersionId: null,
  supersedesVersionId: null,
  lockedAt: null,
};
const lockedPlan = (base: Plan): Plan => ({
  ...base,
  draft: null,
  locked: { ...draft, state: 'locked', versionNumber: 1 },
});
const plan = {
  id: 'plan-1',
  displayName: 'Autumn running',
  stateVersion: 1,
  active: false,
  archived: false,
  draft: draft as typeof draft | null,
  locked: null as
    (typeof draft & { state: 'locked' | 'draft'; versionNumber: number | null }) | null,
};
const briefState = {
  versionId: draft.id,
  editNumber: 1,
  startDate: draft.startDate,
  endDate: draft.endDate,
  readOnly: false,
  confirmed: false,
  hash: 'c'.repeat(64),
  scheduleReviewRequired: false,
  coverage: [{ startDate: '2026-09-01', endDate: '2026-09-07', current: true }],
  calibrations: [],
  findings: [],
  brief: {
    goal: 'Comfortable 10K',
    unit: 'kilometres',
    timezone: 'Europe/London',
    weeklyDistance: { status: 'known', value: 20000 },
    currentRuns: { status: 'known', value: 3 },
    longestRun: { status: 'known', value: 8000 },
    desiredRuns: 3,
    weekdays: Array(7).fill('available'),
    context: '',
  },
};
const preview = {
  draftId: draft.id,
  editNumber: 1,
  stateVersion: 1,
  contentHash: 'a'.repeat(64),
  validationDigest: 'b'.repeat(64),
  hasChanges: true,
  findings: [
    {
      code: 'EMPTY_PLAN',
      severity: 'warning' as const,
      message: 'The plan has no workouts.',
      path: 'workouts',
    },
  ],
  summary: { headerChanges: ['startDate', 'endDate'], entities: {} },
};
let current: Plan;
function mount(path = '/plans/plan-1') {
  const router = createMemoryRouter(
    [
      { path: '/plans', element: <PlansPage /> },
      { path: '/plans/:planId', element: <PlanPage /> },
      { path: '/chat/:conversationId', element: <h1>Plan chat</h1> },
    ],
    { initialEntries: [path] },
  );
  render(
    <AccountQueryProvider>
      <RouterProvider router={router} />
    </AccountQueryProvider>,
  );
  return router;
}
beforeEach(() => {
  vi.resetAllMocks();
  current = structuredClone(plan) as Plan;
  vi.mocked(api.GET).mockImplementation((async (path: string) => {
    const data =
      path === '/api/v1/plans/{planId}'
        ? structuredClone(current)
        : path === '/api/v1/plans'
          ? { plans: [] }
          : path === '/api/v1/workouts'
            ? { workouts: [] }
            : path.endsWith('/revisions')
              ? { revisions: [] }
              : structuredClone(briefState);
    return { data, response: new Response() };
  }) as typeof api.GET);
});
afterEach(cleanup);

async function openMenuItem(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Plan options' }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

it('requires archive confirmation and describes retention and deactivation', async () => {
  mount();
  await openMenuItem('Archive plan…');
  expect(api.POST).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', { name: 'Archive this plan?' });
  expect(
    within(dialog).getByText(/All saved draft content and locked versions are retained/),
  ).toBeInTheDocument();
  vi.mocked(api.POST).mockRejectedValue(new Error('Test request'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm archive' }));
  await screen.findByRole('alert');
  expect(api.POST).toHaveBeenCalledWith(
    '/api/v1/plans/{planId}/archive',
    expect.objectContaining({ body: { expectedStateVersion: 1 } }),
  );
});

it('keeps archived plans read-only and offers explicit unarchive', async () => {
  current = { ...current, archived: true };
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Plan options' }));
  expect(screen.queryByRole('menuitem', { name: 'Edit details' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Activate plan' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chat about this plan' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Unarchive plan…' }));
  expect(screen.getByText(/The plan will remain inactive/)).toBeInTheDocument();
  expect(api.POST).not.toHaveBeenCalled();
});

it('renames a locked plan without unlocking and keeps locked content read-only', async () => {
  current = lockedPlan(current);
  vi.mocked(api.PATCH).mockRejectedValue(new Error('Test request'));
  mount();
  await openMenuItem('Edit details');
  expect(screen.getByLabelText('Description')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'New name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('alert');
  expect(api.PATCH).toHaveBeenCalledTimes(1);
  expect(api.PATCH).toHaveBeenCalledWith(
    '/api/v1/plans/{planId}',
    expect.objectContaining({ body: { displayName: 'New name', expectedStateVersion: 1 } }),
  );
  expect(api.POST).not.toHaveBeenCalled();
});

it('saves draft details against the current edit and keeps edits after a failure', async () => {
  vi.mocked(api.PATCH).mockResolvedValue({
    error: {
      error: { code: 'STALE_DRAFT', requestId: 'test', message: 'Refresh and review changes.' },
    },
    response: new Response(null, { status: 409 }),
  });
  mount();
  await openMenuItem('Edit details');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Unsaved revision' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Refresh and review changes.');
  expect(api.PATCH).toHaveBeenCalledWith(
    '/api/v1/plans/{planId}/draft',
    expect.objectContaining({
      body: expect.objectContaining({
        expectedDraftId: draft.id,
        expectedEditNumber: 1,
        description: 'Unsaved revision',
      }),
    }),
  );
  expect(screen.getByLabelText('Description')).toHaveValue('Unsaved revision');
});

it('does not offer locking an unchanged draft', async () => {
  vi.mocked(api.POST).mockResolvedValue({
    data: { ...preview, hasChanges: false },
    response: new Response(),
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review and lock' }));
  const lock = await screen.findByRole('button', { name: 'Confirm and lock version' });
  await screen.findByText(/No content changes since the locked version/);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I have reviewed and accept all warnings listed above.' }),
  );
  expect(lock).toBeDisabled();
});

it('requires warning acknowledgement before sending the exact lock preview', async () => {
  vi.mocked(api.POST).mockResolvedValue({ data: preview, response: new Response() });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review and lock' }));
  const lock = await screen.findByRole('button', { name: 'Confirm and lock version' });
  await screen.findByText(/The plan has no workouts/);
  expect(lock).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I have reviewed and accept all warnings listed above.' }),
  );
  expect(lock).toBeEnabled();
  vi.mocked(api.POST).mockResolvedValue({
    error: {
      error: { code: 'STALE_DRAFT', requestId: 'test', message: 'The draft changed elsewhere.' },
    },
    response: new Response(null, { status: 409 }),
  });
  fireEvent.click(lock);
  expect(await screen.findByRole('alert')).toHaveTextContent('The draft changed elsewhere.');
  expect(api.POST).toHaveBeenLastCalledWith(
    '/api/v1/plans/{planId}/lock',
    expect.objectContaining({
      body: expect.objectContaining({
        expectedDraftId: draft.id,
        expectedEditNumber: 1,
        expectedContentHash: preview.contentHash,
        expectedValidationDigest: preview.validationDigest,
        acknowledgedWarningCodes: ['EMPTY_PLAN'],
      }),
    }),
  );
  // A rejected lock discards the stale review; it must be validated again.
  expect(screen.getByRole('button', { name: 'Confirm and lock version' })).toBeDisabled();
});

it('requires explicit unlock confirmation', async () => {
  current = lockedPlan(current);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Unlock plan' }));
  expect(api.POST).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Plan v1 is locked' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep locked' }));
  expect(screen.queryByRole('button', { name: 'Unlock and edit' })).not.toBeInTheDocument();
  expect(api.POST).not.toHaveBeenCalled();
});

it('reuses a create request key when retrying after a connection failure', async () => {
  vi.mocked(api.POST).mockRejectedValue(new Error('Connection lost'));
  mount('/plans');
  fireEvent.click(await screen.findByRole('button', { name: 'New plan' }));
  fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'A new plan' } });
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-10' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-12-10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.POST).mock.calls[0]).toEqual(vi.mocked(api.POST).mock.calls[1]);
});

it('requires review of assumptions and sends combined confirmation and lock as one command', async () => {
  const reviewed = {
    ...preview,
    briefReview: briefState,
    findings: [
      {
        code: 'brief.confirmation_required',
        severity: 'error',
        message: 'Confirm current assumptions',
        path: 'brief',
      },
    ],
  };
  vi.mocked(api.POST).mockImplementation(async (path) => ({
    data: String(path).endsWith('/validate') ? reviewed : lockedPlan(current),
    response: new Response(),
  }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review and lock' }));
  const lock = await screen.findByRole('button', { name: 'Confirm and lock version' });
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByText('Comfortable 10K');
  expect(lock).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: /I confirm the planning assumptions and pace guides shown above/,
    }),
  );
  expect(lock).not.toBeDisabled();
  fireEvent.click(lock);
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/plans/{planId}/lock',
      expect.objectContaining({
        body: expect.objectContaining({
          confirmBriefHash: briefState.hash,
          expectedContentHash: preview.contentHash,
          expectedValidationDigest: preview.validationDigest,
        }),
      }),
    ),
  );
  expect(await screen.findByRole('dialog', { name: 'Plan v1 locked' })).toBeInTheDocument();
});

it('opens the plan conversation from the toolbar', async () => {
  vi.mocked(api.POST).mockResolvedValue({ data: { id: 'c1' }, response: new Response() });
  const router = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Chat about this plan' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/chat/c1'));
  expect(api.POST).toHaveBeenCalledWith('/api/v1/plans/{planId}/conversations/open', {
    params: { path: { planId: 'plan-1' } },
  });
});

it('locks with the reviewed concurrency values even when the plan prop is stale', async () => {
  vi.mocked(api.POST).mockImplementation(async (path) => ({
    data: String(path).endsWith('/validate')
      ? { ...preview, findings: [], editNumber: 4, stateVersion: 7 }
      : lockedPlan(current),
    response: new Response(),
  }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review and lock' }));
  const lock = await screen.findByRole('button', { name: 'Confirm and lock version' });
  await waitFor(() => expect(lock).toBeEnabled());
  fireEvent.click(lock);
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/plans/{planId}/lock',
      expect.objectContaining({
        body: expect.objectContaining({
          expectedStateVersion: 7,
          expectedDraftId: draft.id,
          expectedEditNumber: 4,
        }),
      }),
    ),
  );
});

it('retries only the rename after the content save succeeded', async () => {
  const savedPlan = {
    ...current,
    stateVersion: 2,
    draft: { ...draft, editNumber: 2, description: 'Revised' },
  };
  vi.mocked(api.PATCH)
    .mockResolvedValueOnce({ data: savedPlan, response: new Response() })
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({
      data: { ...savedPlan, displayName: 'Renamed' },
      response: new Response(),
    });
  mount();
  await openMenuItem('Edit details');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Revised' } });
  fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Connection lost');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(3));
  const calls = (vi.mocked(api.PATCH).mock.calls as unknown as [string, unknown][]).map(
    ([path]) => path,
  );
  expect(calls).toEqual([
    '/api/v1/plans/{planId}/draft',
    '/api/v1/plans/{planId}',
    '/api/v1/plans/{planId}',
  ]);
  expect((vi.mocked(api.PATCH).mock.calls as unknown as [string, unknown][])[2]![1]).toEqual(
    expect.objectContaining({ body: { displayName: 'Renamed', expectedStateVersion: 2 } }),
  );
});

it('guards unsaved plan details against navigation', async () => {
  mount();
  await openMenuItem('Edit details');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Unsaved' } });
  fireEvent.click(screen.getByRole('link', { name: /All plans/ }));
  expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('Description')).toHaveValue('Unsaved');
  expect(screen.queryByText('Leave without saving?')).not.toBeInTheDocument();
});
