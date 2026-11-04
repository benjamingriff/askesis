import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { ACCOUNT_KEY } from './account';
import { agentPrompt, RequireInAppCoach, useCoachWord } from './coach';

afterEach(cleanup);

function renderAt(path: string, inAppCoach: boolean | null) {
  const client = new QueryClient();
  if (inAppCoach !== null)
    client.setQueryData(ACCOUNT_KEY, { deletion: null, features: { inAppCoach } });
  function Word() {
    return <p>Your {useCoachWord()}</p>;
  }
  const router = createMemoryRouter(
    [
      { path: '/today', element: <h1>Today</h1> },
      { element: <RequireInAppCoach />, children: [{ path: '/chat', element: <Word /> }] },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

it('keeps chat routes and coach wording when the account offers the in-app coach', () => {
  renderAt('/chat', true);
  expect(screen.getByText('Your coach')).toBeInTheDocument();
});

it('sends chat links to Today when the in-app coach is hidden', () => {
  renderAt('/chat', false);
  expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
});

it('defaults to the in-app coach before an account has loaded', () => {
  renderAt('/chat', null);
  expect(screen.getByText('Your coach')).toBeInTheDocument();
});

it('names the plan so the agent can use an explicit planId', () => {
  expect(agentPrompt('Plan the remaining weeks', { id: 'p1', name: 'Spring 10K' })).toBe(
    'Using Askesis, for my plan “Spring 10K” (planId p1):\nPlan the remaining weeks',
  );
  expect(agentPrompt('Read my log.', { id: 'p1' })).toBe(
    'Using Askesis, for my plan (planId p1):\nRead my log.',
  );
  expect(agentPrompt('Help me start.')).toBe('Using Askesis: Help me start.');
});
