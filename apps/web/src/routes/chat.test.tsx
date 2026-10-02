import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

it('keeps rename failures visible in the dialog and retries with refreshed conversation metadata', async () => {
  vi.mocked(api.PATCH)
    .mockImplementationOnce((async () => {
      detail = { ...conversation, title: 'Changed elsewhere', stateVersion: 2 };
      return {
        error: {
          error: { code: 'STALE_CONVERSATION', message: 'The conversation changed elsewhere.' },
        },
        response: new Response(null, { status: 409 }),
      };
    }) as typeof api.PATCH)
    .mockImplementationOnce((async () => {
      detail = { ...detail, title: 'My title', stateVersion: 3 };
      return response(detail);
    }) as typeof api.PATCH);
  mount('/chat/c1');
  await screen.findByText('Saved message');
  fireEvent.click(screen.getByRole('button', { name: 'Conversation options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
  const dialog = screen.getByRole('dialog', { name: 'Rename conversation' });
  fireEvent.change(within(dialog).getByLabelText('Conversation title'), {
    target: { value: 'My title' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'The conversation changed elsewhere.',
  );
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(within(dialog).getByLabelText('Conversation title')).toHaveValue('My title');
  await screen.findByRole('heading', { name: 'Changed elsewhere' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.PATCH).toHaveBeenLastCalledWith(
    '/api/v1/conversations/{conversationId}',
    expect.objectContaining({ body: { title: 'My title', expectedStateVersion: 2 } }),
  );
  expect(screen.getByRole('heading', { name: 'My title' })).toBeInTheDocument();
});

it('clears an old rename error when opening a fresh rename dialog', async () => {
  vi.mocked(api.PATCH).mockRejectedValueOnce(new Error('Connection lost'));
  mount('/chat/c1');
  await screen.findByText('Saved message');
  fireEvent.click(screen.getByRole('button', { name: 'Conversation options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
  fireEvent.change(screen.getByLabelText('Conversation title'), { target: { value: 'Unsaved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await within(screen.getByRole('dialog')).findByText('Connection lost');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversation options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Conversation title')).toHaveValue(conversation.title);
});
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
it('formats assistant Markdown while preserving the literal user message', async () => {
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation(((path: string, ...args: unknown[]) =>
    path.endsWith('/messages')
      ? Promise.resolve(
          response({
            messages: [
              { id: 'm1', sequence: 1, role: 'user', content: '**My question**', context: null },
              {
                id: 'm2',
                sequence: 2,
                role: 'assistant',
                content: '**Easy running** is the goal.',
                context: null,
              },
            ],
            nextBeforeSequence: null,
          }),
        )
      : Reflect.apply(original, api, [path, ...args])) as typeof api.GET);
  mount('/chat/c1');
  expect(await screen.findByText('**My question**')).toBeInTheDocument();
  expect(await screen.findByText('Easy running', { selector: 'strong' })).toBeInTheDocument();
});

it('shows a plan-wide run from another chat in an empty conversation', async () => {
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation(((path: string, ...args: unknown[]) =>
    path.endsWith('/messages')
      ? Promise.resolve(response({ messages: [], nextBeforeSequence: null }))
      : Reflect.apply(original, api, [path, ...args])) as typeof api.GET);
  detail = {
    ...conversation,
    planId: 'plan-1',
    activeRun: {
      id: 'run-9',
      conversationId: 'other',
      status: 'running',
      failureCode: null,
    },
  } as never;
  mount('/chat/c1');
  expect(await screen.findByText('Working')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'another chat for this plan' })).toHaveAttribute(
    'href',
    '/chat/other',
  );
});
