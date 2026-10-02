import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
import { ChatPage } from './chat';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('../api', () => ({ api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } }));
const conversation = {
  id: 'c1',
  title: 'Test conversation',
  planId: null,
  planName: null,
  archived: false,
  planArchived: false,
  stateVersion: 1,
  context: null,
  activeRun: null,
  latestRun: null,
};
const response = (data: unknown) => ({ data, response: new Response() });
let available: boolean;
let detail: typeof conversation;
function mount(path = '/chat', client?: QueryClient) {
  const router = createMemoryRouter(
    [
      { path: '/chat', element: <ChatPage /> },
      { path: '/chat/:conversationId', element: <ChatPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    client ? (
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ) : (
      <AccountQueryProvider>
        <RouterProvider router={router} />
      </AccountQueryProvider>
    ),
  );
  return router;
}
beforeEach(() => {
  vi.resetAllMocks();
  available = true;
  detail = { ...conversation };
  vi.mocked(api.GET).mockImplementation((async (path: string) => {
    if (path === '/api/v1/chat-capabilities')
      return response({ executionAvailable: available, mode: available ? 'test' : 'unavailable' });
    if (path === '/api/v1/conversations') return response({ conversations: [], nextCursor: null });
    if (path.endsWith('/events')) return response({ events: [], nextAfterSequence: null });
    if (path.endsWith('/messages'))
      return response({
        messages: [
          { id: 'm1', sequence: 1, role: 'user', content: 'Saved message', context: null },
        ],
        nextBeforeSequence: null,
      });
    return response(detail);
  }) as typeof api.GET);
});
afterEach(cleanup);
it('allows a lost-response retry even after the accepted run becomes active', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(api.POST)
    .mockRejectedValueOnce(new TypeError('Response lost'))
    .mockResolvedValueOnce(response({}) as never);
  mount('/chat/c1', client);
  await screen.findByText('Saved message');
  await screen.findByText(/Test mode · replies are simulated/);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Already accepted' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText(/Response lost/);
  client.setQueryData(['chat', 'detail', 'c1'], {
    ...conversation,
    activeRun: { id: 'run-1', conversationId: 'c1', status: 'running', failureCode: null },
  });
  await screen.findByText('Working');
  expect(screen.getByRole('button', { name: 'Retry send' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry send' }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.POST).mock.calls[0]).toEqual(vi.mocked(api.POST).mock.calls[1]);
  client.clear();
});
it('finishes sending without waiting for background list refreshes', async () => {
  vi.mocked(api.POST).mockImplementationOnce((async () => {
    const original = vi.mocked(api.GET).getMockImplementation()!;
    vi.mocked(api.GET).mockImplementation(((path: string, ...args: unknown[]) =>
      path === '/api/v1/conversations'
        ? new Promise(() => {})
        : Reflect.apply(original, api, [path, ...args])) as typeof api.GET);
    return response({});
  }) as typeof api.POST);
  mount('/chat/c1');
  await screen.findByText('Saved message');
  await screen.findByText(/Test mode · replies are simulated/);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Send then refresh' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(screen.getByLabelText('Message')).toBeEnabled());
  expect(screen.getByLabelText('Message')).toHaveValue('');
});
it('sends with Enter and leaves Shift+Enter and IME composition alone', async () => {
  vi.mocked(api.POST).mockResolvedValue(response({ conversation }) as never);
  const router = mount();
  await screen.findByText(/Test mode · replies are simulated/);
  const input = screen.getByLabelText('Message');
  fireEvent.change(input, { target: { value: 'Keyboard message' } });
  expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(api.POST).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(router.state.location.pathname).toBe('/chat/c1'));
  expect(api.POST).toHaveBeenCalledTimes(1);
});
it('does not create a conversation when opening an empty chat and disables unavailable sends', async () => {
  available = false;
  mount();
  expect(await screen.findByText(/Coaching is not available yet/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(api.POST).not.toHaveBeenCalled();
});
it('keeps history and an unsent question when an agent worker goes offline and recovers', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount('/chat/c1', client);
  await screen.findByText('Saved message');
  await screen.findByText(/Test mode · replies are simulated/);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Pending question' } });
  client.setQueryData(['chat', 'capabilities'], { executionAvailable: false, mode: 'agent' });
  await screen.findByText(/Coaching is not available yet/);
  expect(screen.getByText('Saved message')).toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toHaveValue('Pending question');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(api.POST).not.toHaveBeenCalled();
  client.setQueryData(['chat', 'capabilities'], { executionAvailable: true, mode: 'agent' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
  expect(screen.queryByText(/Coaching is not available yet/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toHaveValue('Pending question');
  client.clear();
});
it('retries an uncertain first send with the same key and navigates to the durable conversation', async () => {
  vi.mocked(api.POST)
    .mockRejectedValueOnce(new TypeError('Network interrupted'))
    .mockResolvedValueOnce(response({ conversation }) as never);
  const router = mount();
  await screen.findByText(/Test mode · replies are simulated/);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText(/Network interrupted/);
  expect(screen.getByLabelText('Message')).toHaveValue('Hello');
  fireEvent.click(screen.getByRole('button', { name: 'Retry send' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/chat/c1'));
  const calls = vi.mocked(api.POST).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(await screen.findByText('Saved message')).toBeInTheDocument();
});
it('loads durable history after navigation and enforces archive read-only state', async () => {
  detail = { ...conversation, archived: true };
  mount('/chat/c1');
  expect(await screen.findByText('Saved message')).toBeInTheDocument();
  expect(await screen.findByText(/archived and read-only/)).toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toBeDisabled();
  for (const button of screen.getAllByRole('button', { name: 'Restore conversation' }))
    expect(button).toBeEnabled();
});
