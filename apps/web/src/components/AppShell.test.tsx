import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('@clerk/react', () => ({ useUser: () => ({ user: null }) }));
vi.mock('../chat', () => ({
  useConversations: () => ({ data: { pages: [{ conversations: [] }] } }),
}));
const coach = vi.hoisted(() => ({ enabled: true }));
vi.mock('../coach', async (original) => ({
  ...(await original<typeof import('../coach')>()),
  useInAppCoach: () => coach.enabled,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  coach.enabled = true;
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

function renderShell(path: string) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const page = (name: string) => (
    <div>
      <h1>{name}</h1>
      <div data-no-tab-swipe>Week chart</div>
    </div>
  );
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { path: '/today', element: page('Today page') },
          { path: '/plan', element: page('Plan page') },
          { path: '/plans/:planId', element: page('Plan detail') },
          { path: '/chat', element: page('Coach page') },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function drag(target: Element, pointerType: string, fromX: number, toX: number) {
  const init = { pointerId: 1, pointerType, isPrimary: true, clientY: 300 };
  fireEvent.pointerDown(target, { ...init, clientX: fromX });
  for (let x = fromX; Math.abs(x - toX) > 0; x += Math.sign(toX - fromX) * 20)
    fireEvent.pointerMove(target, { ...init, clientX: x });
  fireEvent.pointerUp(target, { ...init, clientX: toX });
}

it('marks the current section in the mobile top bar, including plan detail pages', () => {
  renderShell('/plans/abc');
  const bar = screen.getByRole('banner');
  expect(within(bar).getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
  expect(within(bar).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');
  expect(within(bar).getByRole('link', { name: 'You' })).toHaveAttribute('href', '/settings');
});

it('switches to the neighbouring tab when a touch swipes the page sideways', async () => {
  vi.useFakeTimers();
  try {
    const router = renderShell('/today');
    drag(screen.getByRole('heading', { name: 'Today page' }), 'touch', 300, 80);
    await act(() => vi.runAllTimersAsync());
    expect(router.state.location.pathname).toBe('/plan');

    drag(screen.getByRole('heading', { name: 'Plan page' }), 'touch', 80, 300);
    await act(() => vi.runAllTimersAsync());
    expect(router.state.location.pathname).toBe('/today');
  } finally {
    vi.useRealTimers();
  }
});

it('ignores mouse drags, opted-out areas and detail pages', async () => {
  vi.useFakeTimers();
  try {
    const router = renderShell('/today');
    drag(screen.getByRole('heading', { name: 'Today page' }), 'mouse', 300, 80);
    drag(screen.getByText('Week chart'), 'touch', 300, 80);
    await act(() => vi.runAllTimersAsync());
    expect(router.state.location.pathname).toBe('/today');

    await act(() => router.navigate('/plans/abc'));
    drag(screen.getByRole('heading', { name: 'Plan detail' }), 'touch', 300, 80);
    await act(() => vi.runAllTimersAsync());
    expect(router.state.location.pathname).toBe('/plans/abc');
  } finally {
    vi.useRealTimers();
  }
});

it('lets a tab tapped mid-swipe win over the swipe', async () => {
  vi.useFakeTimers();
  try {
    const router = renderShell('/today');
    drag(screen.getByRole('heading', { name: 'Today page' }), 'touch', 300, 80);
    fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Coach' }));
    await act(() => vi.runAllTimersAsync());
    expect(router.state.location.pathname).toBe('/chat');
  } finally {
    vi.useRealTimers();
  }
});

it('opens the next tab at the top when motion is reduced', async () => {
  // Narrow screen, reduced motion.
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  try {
    const router = renderShell('/today');
    drag(screen.getByRole('heading', { name: 'Today page' }), 'touch', 300, 80);
    await act(async () => undefined);
    expect(router.state.location.pathname).toBe('/plan');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('leaves out the coach, new chat and recent chats when the in-app coach is hidden', () => {
  coach.enabled = false;
  renderShell('/plan');
  const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
  expect(within(sidebar).queryByRole('link', { name: 'Coach' })).not.toBeInTheDocument();
  expect(within(sidebar).queryByRole('link', { name: 'New chat' })).not.toBeInTheDocument();
  expect(within(sidebar).queryByText('Recent chats')).not.toBeInTheDocument();
  const tabs = within(screen.getByRole('banner')).getByRole('navigation');
  expect(
    within(tabs)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Today', 'Plan']);
  expect(tabs.style.getPropertyValue('--tab-count')).toBe('2');
  expect(within(tabs).getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
});
