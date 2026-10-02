import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('@clerk/react', () => ({ useUser: () => ({ user: null }) }));
vi.mock('../chat', () => ({
  useConversations: () => ({ data: { pages: [{ conversations: [] }] } }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(['access', 'write'])(
  'keeps the signed-in shell and sidebar usable when storage %s fails',
  (failure) => {
    localStorage.clear();
    const deny = () => {
      throw new DOMException('Storage denied', 'SecurityError');
    };
    if (failure === 'access') vi.spyOn(window, 'localStorage', 'get').mockImplementation(deny);
    else vi.spyOn(Storage.prototype, 'setItem').mockImplementation(deny);
    const router = createMemoryRouter(
      [{ element: <AppShell />, children: [{ path: '/today', element: <h1>Your training</h1> }] }],
      { initialEntries: ['/today'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { name: 'Your training' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your training' })).toBeInTheDocument();
  },
);
