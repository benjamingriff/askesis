import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { WorkoutsPage } from './workouts';

describe('WorkoutsPage', () => {
  it('shows the empty-plan state', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/plan',
          loader: () => ({ workouts: [] }),
          element: <WorkoutsPage />,
        },
      ],
      { initialEntries: ['/plan'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Training plan' })).toBeInTheDocument();
    expect(screen.getByText('No workouts have been scheduled.')).toBeInTheDocument();
  });
});
