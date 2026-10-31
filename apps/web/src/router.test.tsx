import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Clerk from '@clerk/react';
import { api } from './api';
import { RequireAuthentication } from './router';

vi.mock('@clerk/react', async (original) => ({
  ...(await original<typeof Clerk>()),
  useAuth: () => ({ isSignedIn: true }),
}));
vi.mock('./api', () => ({ api: { GET: vi.fn() }, authenticatedFetch: vi.fn() }));
afterEach(cleanup);

it('waits for the account, with a retry, before rendering pages that depend on its features', async () => {
  vi.mocked(api.GET)
    .mockRejectedValueOnce(new Error('Network down'))
    .mockResolvedValueOnce({
      data: { deletion: null, features: { inAppCoach: false } },
    } as never);
  const router = createMemoryRouter(
    [
      {
        element: <RequireAuthentication />,
        children: [{ path: '/today', element: <h1>Today</h1> }],
      },
    ],
    { initialEntries: ['/today'] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your account.');
  expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
});
