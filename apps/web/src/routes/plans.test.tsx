import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
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
const plan = {
  id: 'plan-1',
  displayName: 'Autumn running',
  stateVersion: 1,
  active: false,
  archived: false,
  draft,
  locked: null,
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
function mount(path = '/plans/plan-1') {
  const router = createMemoryRouter(
    [
      { path: '/plans', element: <PlansPage /> },
      { path: '/plans/:planId', element: <PlanPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <AccountQueryProvider>
      <RouterProvider router={router} />
    </AccountQueryProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.GET).mockResolvedValue({ data: structuredClone(plan), response: new Response() });
});
afterEach(cleanup);

it('warns before navigating away from unsaved edits', async () => {
  mount();
  fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'Unsaved' } });
  fireEvent.click(screen.getByRole('link', { name: '← Plan library' }));
  expect(await screen.findByRole('heading', { name: 'Leave without saving?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('Description')).toHaveValue('Unsaved');
});

it('does not offer locking an unchanged draft', async () => {
  vi.mocked(api.POST).mockResolvedValue({
    data: { ...preview, hasChanges: false },
    response: new Response(),
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Validate and review lock' }));
  const lock = await screen.findByRole('button', { name: 'Confirm and lock version' });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(lock).toBeDisabled();
  expect(screen.getByText(/No content changes since the locked version/)).toBeInTheDocument();
});

it('requires warning acknowledgement before sending the exact lock preview', async () => {
  vi.mocked(api.POST).mockResolvedValue({ data: preview, response: new Response() });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Validate and review lock' }));
  const lock = await screen.findByRole('button', { name: 'Confirm and lock version' });
  expect(lock).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(lock).toBeEnabled();
  vi.mocked(api.POST).mockResolvedValue({
    error: {
      error: { code: 'STALE_DRAFT', requestId: 'test', message: 'The draft changed elsewhere.' },
    },
    response: new Response(null, { status: 409 }),
  });
  fireEvent.click(lock);
  await screen.findByRole('alert');
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
  expect(
    screen.queryByRole('button', { name: 'Confirm and lock version' }),
  ).not.toBeInTheDocument();
});

it('invalidates a preview when fields change and keeps unsaved edits on a failed save', async () => {
  vi.mocked(api.POST).mockResolvedValue({ data: preview, response: new Response() });
  vi.mocked(api.PATCH).mockResolvedValue({
    error: {
      error: {
        code: 'STALE_DRAFT',
        requestId: 'test',
        message: 'Refresh and review your changes.',
      },
    },
    response: new Response(null, { status: 409 }),
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Validate and review lock' }));
  await screen.findByRole('button', { name: 'Confirm and lock version' });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Unsaved revision' } });
  expect(
    screen.queryByRole('button', { name: 'Confirm and lock version' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Validate and review lock' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Description')).toHaveValue('Unsaved revision');
});

it('requires explicit unlock confirmation and makes locked fields read-only', async () => {
  vi.mocked(api.GET).mockResolvedValue({
    data: { ...plan, draft: null, locked: { ...draft, state: 'locked', versionNumber: 1 } },
    response: new Response(),
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Unlock plan' }));
  expect(api.POST).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Description')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Confirm unlock' })).not.toBeInTheDocument();
});

it('reuses a create request key when retrying after a connection failure', async () => {
  vi.mocked(api.GET).mockResolvedValue({ data: { plans: [] }, response: new Response() });
  vi.mocked(api.POST).mockRejectedValue(new Error('Connection lost'));
  mount('/plans');
  fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'A new plan' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.POST).mock.calls[0]).toEqual(vi.mocked(api.POST).mock.calls[1]);
});
