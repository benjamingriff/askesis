import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ACCOUNT_KEY } from '../account';
import { AccountDeletionPending } from './AccountDeletionPending';

const signOut = vi.fn();
vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut }) }));
vi.mock('../api', () => ({ api: { DELETE: vi.fn() }, authenticatedFetch: vi.fn() }));
afterEach(cleanup);

it('shows when the account goes and lets the athlete keep it', async () => {
  const client = new QueryClient();
  client.setQueryData(ACCOUNT_KEY, {
    deletion: { requestedAt: '2026-10-19T09:00:00.000Z', purgeAfter: '2026-10-26T09:00:00.000Z' },
  });
  vi.mocked(api.DELETE).mockResolvedValue({
    data: { deletion: null },
    response: new Response(),
  } as never);
  render(
    <QueryClientProvider client={client}>
      <AccountDeletionPending purgeAfter="2026-10-26T09:00:00.000Z" />
    </QueryClientProvider>,
  );
  screen.getByRole('heading', { name: 'Your account will be deleted on Monday 26 October' });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Keep my account' })));
  expect(api.DELETE).toHaveBeenCalledWith('/api/v1/account/deletion');
  expect(client.getQueryData(ACCOUNT_KEY)).toEqual({ deletion: null });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalled();
});
