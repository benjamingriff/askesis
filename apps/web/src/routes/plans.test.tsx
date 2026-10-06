import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { focusManager } from '@tanstack/react-query';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
import type { Plan } from '../plan-data';
import { PlanPage, PlansPage } from './plans';
import { ActivePlansPage } from './active-plans';

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
      { path: '/plan', element: <ActivePlansPage /> },
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
  localStorage.clear();
  current = structuredClone(plan) as Plan;
  vi.mocked(api.GET).mockImplementation((async (
    path: string,
    options?: { params?: { query?: { collection?: string } } },
  ) => {
    const data = path.endsWith('/draft/changes')
      ? {
          versionId: current.draft?.id,
          editNumber: current.draft?.editNumber,
          baselineId: current.locked?.id ?? null,
          workouts: [],
          assumptionsChanged: false,
          paceGuidesChanged: false,
          datesChanged: false,
        }
      : path === '/api/v1/plans/{planId}'
        ? structuredClone(current)
        : path === '/api/v1/plans'
          ? {
              plans:
                options?.params?.query?.collection === 'active' ? [structuredClone(current)] : [],
            }
          : path === '/api/v1/workouts'
            ? { workouts: [] }
            : path.endsWith('/revisions')
              ? { revisions: [] }
              : structuredClone(briefState);
    return { data, response: new Response() };
  }) as typeof api.GET);
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

async function openMenuItem(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Plan options' }));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name })));
}

it.each(['/plans/plan-1', '/plan'])(
  'uses the intended schedule presentation on %s despite a saved calendar preference',
  async (path) => {
    current = { ...lockedPlan(current), active: true };
    localStorage.setItem('askesis-schedule-mode', 'calendar');
    mount(path);
    await screen.findByRole('heading', { name: 'Schedule' });
    if (path === '/plan') {
      expect(screen.getByRole('radio', { name: 'Calendar' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByRole('grid')).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('radio', { name: 'Calendar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    }
  },
);

it.each(['/plans/plan-1', '/plan'])(
  'refreshes metadata and brief on %s while preserving the details form concurrency baseline',
  async (path) => {
    current.active = true;
    mount(path);
    await screen.findByText('Comfortable 10K');
    await openMenuItem('Edit details');
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Unsaved changes' },
    });
    current = {
      ...current,
      stateVersion: 2,
      draft: { ...draft, editNumber: 2, description: 'Remote description' },
    };
    const original = vi.mocked(api.GET).getMockImplementation()!;
    vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) =>
      path.endsWith('/brief')
        ? {
            data: {
              ...briefState,
              editNumber: 2,
              brief: { ...briefState.brief, goal: 'Refreshed assumptions' },
            },
            response: new Response(),
          }
        : Reflect.apply(original, api, [path, ...args])) as typeof api.GET);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await screen.findByText('Refreshed assumptions');
    expect(screen.getByLabelText('Description')).toHaveValue('Unsaved changes');
    vi.mocked(api.PATCH).mockRejectedValueOnce(new Error('Review the remote changes first.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Review the remote changes first.');
    expect(api.PATCH).toHaveBeenCalledWith(
      '/api/v1/plans/{planId}/draft',
      expect.objectContaining({
        body: expect.objectContaining({ expectedEditNumber: 1, description: 'Unsaved changes' }),
      }),
    );
  },
);

it.each(['/plans/plan-1', '/plan'])(
  'preserves unsaved details on %s through a failed background refresh and recovery',
  async (path) => {
    current.active = true;
    mount(path);
    await openMenuItem('Edit details');
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Unsaved changes' },
    });
    const original = vi.mocked(api.GET).getMockImplementation()!;
    vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
      if (path === '/api/v1/plans/{planId}' || path === '/api/v1/plans')
        throw new Error('Connection lost');
      return Reflect.apply(original, api, [path, ...args]);
    }) as typeof api.GET);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await screen.findByText('Connection lost');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('Unsaved changes');
    vi.mocked(api.GET).mockImplementation(original);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(screen.queryByText('Connection lost')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('Unsaved changes');
  },
);

it.each(['/plans/plan-1', '/plan'])(
  'does not rename an unchanged title while saving content on %s',
  async (path) => {
    current.active = true;
    mount(path);
    await openMenuItem('Edit details');
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Unsaved changes' },
    });
    current = {
      ...current,
      displayName: 'Renamed elsewhere',
      stateVersion: 2,
      draft: { ...draft, description: 'Unsaved changes', editNumber: 2 },
    };
    vi.mocked(api.PATCH).mockResolvedValueOnce({ data: structuredClone(current) } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByRole('heading', { name: 'Renamed elsewhere' });
    expect(api.PATCH).toHaveBeenCalledTimes(1);
    expect(api.PATCH).toHaveBeenCalledWith('/api/v1/plans/{planId}/draft', expect.anything());
  },
);

it.each(['workout', 'remaining'])(
  'shows failed coach shortcuts and retries with the %s context',
  async (shortcut) => {
    current = { ...current, draft: { ...draft, startDate: '2027-01-11', endDate: '2027-01-24' } };
    const original = vi.mocked(api.GET).getMockImplementation()!;
    vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
      if (path === '/api/v1/workouts')
        return {
          data: {
            workouts:
              shortcut === 'workout'
                ? [
                    {
                      id: 'w1',
                      planId: current.id,
                      planVersionId: draft.id,
                      planTitle: current.displayName,
                      weekNumber: 1,
                      scheduledDate: '2027-01-12',
                      title: 'Easy run',
                      description: null,
                      purpose: null,
                      discipline: 'running',
                      priority: 'medium',
                      estimatedDurationSeconds: 2400,
                      estimatedDistanceMetres: 6000,
                    },
                  ]
                : [],
          },
          response: new Response(),
        };
      if (path.endsWith('/brief'))
        return {
          data: {
            ...briefState,
            coverage: [{ startDate: '2027-01-11', endDate: '2027-01-12', current: true }],
          },
          response: new Response(),
        };
      if (path === '/api/v1/workouts/{workoutId}') throw new Error('Prescription unavailable');
      return Reflect.apply(original, api, [path, ...args]);
    }) as typeof api.GET);
    vi.mocked(api.POST)
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({ data: { id: 'chat-id' }, response: new Response() } as never);
    const router = mount();
    if (shortcut === 'workout') {
      fireEvent.click(await screen.findByRole('button', { name: /Easy run/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Ask your coach about this' }));
    } else {
      await screen.findByRole('button', { name: 'Next week' });
      fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
      fireEvent.click(screen.getByRole('button', { name: 'Plan it with your coach' }));
    }
    const context =
      shortcut === 'workout' ? 'About “Easy run” on 2027-01-12: ' : 'Plan the remaining weeks';
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getByRole('alert')).toHaveTextContent(context.trim());
    fireEvent.click(screen.getByRole('button', { name: 'Retry opening coach' }));
    await screen.findByRole('heading', { name: 'Plan chat' });
    expect(router.state.location.state).toEqual({ prefill: context });
    expect(api.POST).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.POST).mock.calls[0]).toEqual(vi.mocked(api.POST).mock.calls[1]);
  },
);

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

it('refreshes stale details without losing edits and retries with the latest draft metadata', async () => {
  vi.mocked(api.PATCH).mockResolvedValueOnce({
    error: {
      error: { code: 'STALE_DRAFT', requestId: 'test', message: 'The draft changed elsewhere.' },
    },
    response: new Response(null, { status: 409 }),
  });
  mount();
  await openMenuItem('Edit details');
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'My unsaved changes' },
  });
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-02' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('The draft changed elsewhere.');
  current = {
    ...current,
    stateVersion: 3,
    draft: { ...draft, editNumber: 4, description: 'Changes from another session' },
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh latest plan' }));
  await screen.findByText('Saved description: Changes from another session');
  expect(screen.getByLabelText('Description')).toHaveValue('My unsaved changes');
  expect(screen.getByLabelText('Start date')).toHaveValue('2026-09-02');
  vi.mocked(api.PATCH).mockImplementation((async () => {
    current = {
      ...current,
      draft: { ...current.draft!, description: 'My unsaved changes', startDate: '2026-09-02' },
    };
    return { data: current, response: new Response() };
  }) as typeof api.PATCH);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.PATCH).toHaveBeenLastCalledWith(
    '/api/v1/plans/{planId}/draft',
    expect.objectContaining({
      body: expect.objectContaining({
        expectedDraftId: draft.id,
        expectedEditNumber: 4,
        description: 'My unsaved changes',
        startDate: '2026-09-02',
      }),
    }),
  );
});

it('keeps edits and the refresh action when loading the latest plan fails', async () => {
  vi.mocked(api.PATCH).mockRejectedValue(new Error('The draft changed elsewhere.'));
  mount();
  await openMenuItem('Edit details');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Unsaved changes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('The draft changed elsewhere.');
  vi.mocked(api.GET).mockRejectedValueOnce(new Error('Connection lost'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh latest plan' }));
  await screen.findByText('Couldn’t refresh the plan: Connection lost');
  expect(screen.getByLabelText('Description')).toHaveValue('Unsaved changes');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh latest plan' }));
  await screen.findByText(/Latest plan loaded/);
  expect(screen.getByLabelText('Description')).toHaveValue('Unsaved changes');
});

it('disables all plan-detail inputs until a pending save settles', async () => {
  let finish!: () => void;
  vi.mocked(api.PATCH).mockImplementation(
    (() =>
      new Promise<{ data: Plan; response: Response }>((resolve) => {
        finish = () => resolve({ data: current, response: new Response() });
      })) as typeof api.PATCH,
  );
  mount();
  await openMenuItem('Edit details');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Revised' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(1));
  for (const label of ['Plan name', 'Description', 'Start date', 'End date'])
    expect(screen.getByLabelText(label)).toBeDisabled();
  finish();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it.each(['locked', 'discarded'])(
  'preserves unsaved content when the draft was %s elsewhere',
  async (action) => {
    vi.mocked(api.PATCH).mockRejectedValue(new Error('The draft is no longer available.'));
    mount();
    await openMenuItem('Edit details');
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Unsaved changes' },
    });
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('The draft is no longer available.');
    current =
      action === 'locked'
        ? lockedPlan(current)
        : {
            ...lockedPlan(current),
            locked: { ...draft, state: 'locked', versionNumber: 1, id: 'previous' },
          };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh latest plan' }));
    await screen.findByText(/There is no editable draft any more/);
    expect(screen.getByLabelText('Description')).toHaveValue('Unsaved changes');
    expect(screen.getByLabelText('Plan name')).toHaveValue('Unsaved name');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    // Form submission also refuses the unsavable content rather than saving only the name.
    fireEvent.submit(screen.getByLabelText('Description').closest('form')!);
    expect(api.PATCH).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  },
);

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

it('refreshes concurrency metadata after a partially saved details edit', async () => {
  const savedPlan = {
    ...current,
    stateVersion: 2,
    draft: { ...draft, editNumber: 2, description: 'Revised' },
  };
  vi.mocked(api.PATCH)
    .mockResolvedValueOnce({ data: savedPlan, response: new Response() })
    .mockResolvedValueOnce({
      error: {
        error: { code: 'STALE_PLAN', requestId: 'test', message: 'The plan changed elsewhere.' },
      },
      response: new Response(null, { status: 409 }),
    });
  mount();
  await openMenuItem('Edit details');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Revised' } });
  fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('The plan changed elsewhere.');
  current = { ...savedPlan, stateVersion: 3, displayName: 'Another name' };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh latest plan' }));
  await screen.findByText('Saved name: Another name');
  vi.mocked(api.PATCH).mockImplementation((async () => {
    current = { ...current, displayName: 'Renamed' };
    return { data: current, response: new Response() };
  }) as typeof api.PATCH);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.PATCH).toHaveBeenCalledTimes(3);
  expect(api.PATCH).toHaveBeenLastCalledWith(
    '/api/v1/plans/{planId}',
    expect.objectContaining({ body: { displayName: 'Renamed', expectedStateVersion: 3 } }),
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
