import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Plan } from '../plan-data';
import { AccountQueryProvider } from '../query-provider';
import { PlanToolbar } from './PlanLifecycle';

vi.mock('../api', () => ({ api: { POST: vi.fn() } }));
const version = {
  id: 'locked-1',
  state: 'locked' as const,
  versionNumber: 1,
  editNumber: 1,
  description: null,
  startDate: null,
  endDate: null,
  basedOnVersionId: null,
  supersedesVersionId: null,
  lockedAt: '2026-10-01T12:00:00Z',
};
const plan: Plan = {
  id: 'plan-1',
  displayName: 'Autumn running',
  stateVersion: 1,
  active: true,
  archived: false,
  locked: version,
  draft: {
    ...version,
    id: 'draft-1',
    state: 'draft',
    versionNumber: null,
    basedOnVersionId: version.id,
    lockedAt: null,
  },
};
const page = (current: Plan) => (
  <AccountQueryProvider>
    <MemoryRouter>
      <PlanToolbar plan={current} />
    </MemoryRouter>
  </AccountQueryProvider>
);
function openDiscard() {
  fireEvent.click(screen.getByRole('button', { name: 'Plan options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Discard draft…' }));
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(['edit', 'replace', 'lock', 'discard'])(
  'does not authorize a newer draft after a remote %s',
  async (change) => {
    const mounted = render(page(plan));
    openDiscard();
    const next: Plan = {
      ...plan,
      stateVersion: 2,
      draft:
        change === 'lock' || change === 'discard'
          ? null
          : {
              ...plan.draft!,
              id: change === 'replace' ? 'draft-2' : 'draft-1',
              editNumber: 2,
            },
      locked: change === 'lock' ? { ...version, id: 'locked-2', versionNumber: 2 } : version,
    };
    mounted.rerender(page(next));
    expect(screen.getByText(/The plan changed elsewhere/)).toBeInTheDocument();
    expect(screen.getByText(/Locked version 1 stays unchanged/)).toBeInTheDocument();
    vi.mocked(api.POST).mockRejectedValueOnce(new Error('Review the latest changes first.'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    await screen.findByRole('alert');
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/plans/{planId}/discard',
      expect.objectContaining({
        body: { expectedStateVersion: 1, expectedDraftId: 'draft-1', expectedEditNumber: 1 },
      }),
    );
  },
);

it('retries an uncertain discard with the same baseline and idempotency key, then requires a fresh review for a new baseline', async () => {
  vi.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
  const mounted = render(page(plan));
  openDiscard();
  vi.mocked(api.POST).mockRejectedValue(new Error('Connection lost'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  await screen.findByText('Connection lost');
  const next = { ...plan, stateVersion: 2, draft: { ...plan.draft!, editNumber: 2 } };
  mounted.rerender(page(next));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm discard' })).toBeEnabled(),
  );
  const calls = vi.mocked(api.POST).mock.calls;
  expect(calls[1]).toEqual(calls[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  openDiscard();
  expect(screen.queryByText(/The plan changed elsewhere/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(3));
  expect(api.POST).toHaveBeenLastCalledWith(
    '/api/v1/plans/{planId}/discard',
    expect.objectContaining({
      body: { expectedStateVersion: 2, expectedDraftId: 'draft-1', expectedEditNumber: 2 },
      params: expect.objectContaining({
        header: { 'idempotency-key': '00000000-0000-4000-8000-000000000002' },
      }),
    }),
  );
});

it.each(['archive', 'unarchive', 'unlock'] as const)(
  'retains the reviewed state for %s too',
  async (action) => {
    const initial = { ...plan, draft: null, archived: action === 'unarchive' };
    const mounted = render(page(initial));
    if (action === 'archive') {
      fireEvent.click(screen.getByRole('button', { name: 'Plan options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Archive plan…' }));
    } else
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'unlock' ? 'Unlock plan' : 'Unarchive plan…',
        }),
      );
    mounted.rerender(
      page({ ...initial, stateVersion: 2, locked: { ...version, versionNumber: 2 } }),
    );
    vi.mocked(api.POST).mockRejectedValueOnce(new Error('The plan changed elsewhere.'));
    fireEvent.click(
      screen.getByRole('button', {
        name: action === 'unlock' ? 'Unlock and edit' : `Confirm ${action}`,
      }),
    );
    await screen.findByRole('alert');
    expect(api.POST).toHaveBeenCalledWith(
      `/api/v1/plans/{planId}/${action}`,
      expect.objectContaining({ body: { expectedStateVersion: 1 } }),
    );
  },
);
