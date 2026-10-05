import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
import { ChatPage } from './chat';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('../api', () => ({ api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } }));
const turnFields = { activity: [], changes: null, legacyChanges: false, replyTruncated: false };
const conversation = {
  id: 'c1',
  title: 'Test conversation',
  planId: null,
  planName: null,
  archived: false,
  planArchived: false,
  stateVersion: 1,
  context: null,
  activeRun: null as Record<string, unknown> | null,
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
    if (path.endsWith('/runs')) return response({ runs: [], nextBeforeSequence: null });
    if (path.endsWith('/output'))
      return response({
        runId: 'run-1',
        status: 'running',
        finalMessageId: null,
        items: [],
        timings: {},
      });
    if (path.endsWith('/turn'))
      return response({
        ...detail.activeRun!,
        activity: [],
        changes: null,
        legacyChanges: false,
        output: [],
        replyTruncated: false,
      });
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    activeRun: {
      id: 'run-1',
      userMessageId: 'm1',
      conversationId: 'c1',
      status: 'running',
      failureCode: null,
    },
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
  const suggestion = screen.getByRole('button', { name: 'How should I pace my long run?' });
  expect(suggestion).toBeDisabled();
  fireEvent.click(suggestion);
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

it('recovers older interrupted turns and renders the durable final message once', async () => {
  const original = vi.mocked(api.GET).getMockImplementation()!;
  const run = (id: string, status: string, userMessageId: string) => ({
    id,
    status,
    userMessageId,
    conversationId: 'c1',
    planId: null,
    context: null,
    failureCode: status === 'failed' ? 'PROVIDER_ERROR' : null,
    createdAt: '2026-10-05T10:00:00Z',
    startedAt: '2026-10-05T10:00:00Z',
    finishedAt: '2026-10-05T10:00:01Z',
    ...turnFields,
    // The final segment of a completed run is the durable message, so it is not repeated.
    output:
      status === 'completed'
        ? []
        : [
            {
              itemId: 'text',
              position: 0,
              content: `${id} visible prefix`,
              revision: 1,
              isFinal: false,
              truncated: false,
            },
          ],
  });
  const runs = [
    run('stopped', 'cancelled', 'm1'),
    run('failed', 'failed', 'm2'),
    run('finished', 'completed', 'm3'),
  ];
  vi.mocked(api.GET).mockImplementation((async (
    path: string,
    options?: { params?: { path?: { runId?: string } } },
  ) => {
    if (path.endsWith('/runs')) return response({ runs, nextBeforeSequence: null });
    if (path.endsWith('/messages'))
      return response({
        messages: [
          ...['m1', 'm2', 'm3'].map((id, index) => ({
            id,
            sequence: index + 1,
            role: 'user',
            content: `Question ${index + 1}`,
            producingRunId: null,
            context: null,
          })),
          {
            id: 'final',
            sequence: 4,
            role: 'assistant',
            content: 'Completed answer',
            producingRunId: 'finished',
            context: null,
          },
        ],
        nextBeforeSequence: null,
      });
    return Reflect.apply(original, api, [path, options]);
  }) as typeof api.GET);
  mount('/chat/c1');
  expect(await screen.findByText('stopped visible prefix')).toBeInTheDocument();
  expect(await screen.findByText('failed visible prefix')).toBeInTheDocument();
  expect(screen.getByText('Stopped · incomplete')).toBeInTheDocument();
  expect(screen.getByText('Failed · incomplete')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText('Completed answer')).toHaveLength(1));
  // The reply stays inside its turn, after that turn's activity.
  const turn = screen.getByText('Completed answer').closest('.turn') as HTMLElement;
  expect(within(turn).getByText('Completed · 1s')).toBeInTheDocument();
  expect(
    within(turn)
      .getByText('Completed · 1s')
      .compareDocumentPosition(within(turn).getByText('Completed answer')),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(api.POST).not.toHaveBeenCalled();
});
it('lets the next question be typed while busy, disables Send, and preserves it through plan tab and panel changes', async () => {
  const original = vi.mocked(api.GET).getMockImplementation()!;
  detail = {
    ...conversation,
    planId: 'plan-1',
    planName: 'Live plan',
    activeRun: {
      id: 'r1',
      userMessageId: 'm1',
      conversationId: 'c1',
      status: 'running',
      failureCode: null,
    },
  } as never;
  vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
    // The full plan read can be loading while the user switches views.
    if (path === '/api/v1/plans/{planId}') return new Promise(() => {});
    return Reflect.apply(original, api, [path, ...args]);
  }) as typeof api.GET);
  mount('/chat/c1');
  await screen.findByText('Working');
  const input = screen.getByLabelText('Message');
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: 'My next question' } });
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Plan' }));
  expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
  // Keyboard users move between the views with the arrow keys.
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Plan' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Message')).toBe(input);
  expect(input).toHaveValue('My next question');
  fireEvent.click(screen.getByRole('button', { name: 'Hide plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review Live plan beside the chat' }));
  expect(input).toHaveValue('My next question');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(api.POST).not.toHaveBeenCalled();
});

it('holds the reading position during streamed growth and offers Jump to latest', async () => {
  let resize: ResizeObserverCallback | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  detail = {
    ...conversation,
    activeRun: {
      id: 'r1',
      userMessageId: 'm1',
      conversationId: 'c1',
      status: 'running',
      failureCode: null,
    },
  } as never;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount('/chat/c1', client);
  await screen.findByText('Working');
  const node = document.querySelector('.message-scroll') as HTMLDivElement;
  let height = 1000;
  Object.defineProperty(node, 'scrollHeight', { get: () => height });
  Object.defineProperty(node, 'clientHeight', { value: 300 });
  // The reader starts at the latest text, then scrolls up to read.
  node.scrollTop = 700;
  fireEvent.scroll(node);
  node.scrollTop = 300;
  const scroll = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    node.scrollTop = typeof options === 'number' ? (y ?? 0) : Number(options?.top);
  });
  node.scrollTo = scroll;
  fireEvent.scroll(node);
  height = 1200;
  act(() => {
    client.setQueryData(['chat', 'output', 'r1'], {
      runId: 'r1',
      status: 'running',
      finalMessageId: null,
      items: [
        {
          itemId: 'text',
          position: 0,
          content: 'More streamed text',
          revision: 2,
          isFinal: false,
          truncated: false,
        },
      ],
      timings: {},
    });
    resize?.([], {} as ResizeObserver);
  });
  expect(node.scrollTop).toBe(300);
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Jump to latest' }));
  expect(scroll).toHaveBeenLastCalledWith({ top: 1200, behavior: 'smooth' });
  height = 1300;
  act(() => resize?.([], {} as ResizeObserver));
  expect(scroll).toHaveBeenLastCalledWith({ top: 1300, behavior: 'auto' });
  client.clear();
});

it('keeps a turn’s reply in place when streamed text becomes the durable message', async () => {
  const running = {
    id: 'r1',
    userMessageId: 'm1',
    conversationId: 'c1',
    status: 'running',
    failureCode: null,
  };
  detail = { ...conversation, activeRun: running } as never;
  let finished = false;
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
    if (path.endsWith('/output'))
      return response({
        runId: 'r1',
        status: finished ? 'completed' : 'running',
        finalMessageId: finished ? 'reply' : null,
        items: [
          {
            itemId: 'answer',
            position: 0,
            content: 'Streamed answer',
            revision: 1,
            isFinal: finished,
            truncated: false,
          },
        ],
        timings: {},
      });
    if (path.endsWith('/messages') && finished)
      return response({
        messages: [
          { id: 'm1', sequence: 1, role: 'user', content: 'Saved message', context: null },
          {
            id: 'reply',
            sequence: 2,
            role: 'assistant',
            content: 'Streamed answer',
            producingRunId: 'r1',
            context: null,
          },
        ],
        nextBeforeSequence: null,
      });
    return Reflect.apply(original, api, [path, ...args]);
  }) as typeof api.GET);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount('/chat/c1', client);
  const streamed = await screen.findByText('Streamed answer');
  const turn = streamed.closest('.turn');
  expect(screen.getByText('Writing…')).toBeInTheDocument();
  finished = true;
  detail = {
    ...conversation,
    activeRun: null,
    latestRun: { ...running, status: 'completed' },
  } as never;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['chat', 'messages'] });
    await client.invalidateQueries({ queryKey: ['chat', 'detail'] });
  });
  await waitFor(() => expect(screen.queryByText('Writing…')).not.toBeInTheDocument());
  expect(screen.getAllByText('Streamed answer')).toHaveLength(1);
  expect(screen.getByText('Streamed answer').closest('.turn')).toBe(turn);
  client.clear();
});

it('fills this chat’s composer from coach shortcuts in the plan panel', async () => {
  const draft = {
    id: 'draft-1',
    state: 'draft',
    versionNumber: null,
    editNumber: 1,
    description: 'My plan',
    startDate: '2026-09-01',
    endDate: '2026-10-01',
    basedOnVersionId: null,
    supersedesVersionId: null,
    lockedAt: null,
  };
  detail = {
    ...conversation,
    planId: 'plan-1',
    planName: 'Autumn running',
    context: { versionId: 'draft-1', state: 'draft', versionNumber: null, editNumber: 1 },
  } as never;
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
    if (path === '/api/v1/plans/{planId}')
      return response({
        id: 'plan-1',
        displayName: 'Autumn running',
        stateVersion: 1,
        active: false,
        archived: false,
        draft,
        locked: null,
      });
    if (path === '/api/v1/workouts') return response({ workouts: [] });
    if (path.endsWith('/draft/changes'))
      return response({
        versionId: 'draft-1',
        editNumber: 1,
        baselineId: null,
        workouts: [
          {
            lineageId: 'l1',
            workoutId: 'w1',
            title: 'Easy run',
            date: '2026-09-02',
            previousDate: null,
            change: 'added',
            prescriptionChanged: false,
          },
        ],
        assumptionsChanged: false,
        paceGuidesChanged: false,
        datesChanged: false,
        counts: { added: 1, changed: 0, moved: 0, removed: 0 },
      });
    if (path.endsWith('/draft/brief'))
      return response({
        versionId: 'draft-1',
        editNumber: 1,
        startDate: draft.startDate,
        endDate: draft.endDate,
        readOnly: false,
        confirmed: false,
        hash: 'c'.repeat(64),
        scheduleReviewRequired: false,
        coverage: [{ startDate: '2026-09-01', endDate: '2026-09-07', current: true }],
        calibrations: [],
        findings: [],
        brief: {
          goal: 'Comfortable 10K',
          unit: 'kilometres',
          timezone: 'Europe/London',
          weeklyDistance: { status: 'known', value: 20000 },
          currentRuns: { status: 'known', value: 3 },
          longestRun: { status: 'known', value: 8000 },
          desiredRuns: 3,
          weekdays: Array(7).fill('available'),
          context: '',
        },
      });
    return Reflect.apply(original, api, [path, ...args]);
  }) as typeof api.GET);
  mount('/chat/c1');
  fireEvent.click(await screen.findByRole('tab', { name: 'Plan, 1 pending changes' }));
  const panel = screen.getByRole('complementary', { name: 'Plan' });
  expect(await within(panel).findByText('New plan draft')).toBeInTheDocument();
  // Opening the plan's chat from here would leave this conversation.
  expect(within(panel).queryByRole('button', { name: 'Chat about this plan' })).toBeNull();
  fireEvent.click(await within(panel).findByRole('button', { name: 'Plan it with your coach' }));
  expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Message')).toHaveValue('Plan the remaining weeks');
  expect(api.POST).not.toHaveBeenCalled();
});

it('keeps a reply visible when its question is on an older, unloaded page', async () => {
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
    if (path.endsWith('/messages'))
      return response({
        messages: [
          {
            id: 'reply',
            sequence: 51,
            role: 'assistant',
            content: 'Answer to an older question',
            producingRunId: 'old-run',
            context: null,
          },
        ],
        nextBeforeSequence: 51,
      });
    if (path.endsWith('/runs'))
      return response({
        runs: [
          {
            id: 'old-run',
            status: 'completed',
            userMessageId: 'question-on-older-page',
            conversationId: 'c1',
            planId: null,
            context: null,
            failureCode: null,
            createdAt: '2026-10-05T10:00:00Z',
            startedAt: null,
            finishedAt: null,
            ...turnFields,
            output: [],
          },
        ],
        nextBeforeSequence: null,
      });
    return Reflect.apply(original, api, [path, ...args]);
  }) as typeof api.GET);
  mount('/chat/c1');
  expect(await screen.findByText('Answer to an older question')).toBeInTheDocument();
});

it('shows a retryable notice when coaching turns cannot load, keeping the messages', async () => {
  let fail = true;
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
    if (path.endsWith('/runs') && fail)
      return {
        error: { error: { code: 'UNAVAILABLE', message: 'Service unavailable.' } },
        response: new Response(null, { status: 503 }),
      };
    return Reflect.apply(original, api, [path, ...args]);
  }) as typeof api.GET);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount('/chat/c1', client);
  expect(await screen.findByText('Saved message')).toBeInTheDocument();
  expect(await screen.findByText(/Could not load coaching activity/)).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.queryByText(/Could not load coaching activity/)).not.toBeInTheDocument(),
  );
  client.clear();
});

it('shows recovered terminal text rather than an older streamed snapshot', async () => {
  const running = {
    id: 'r1',
    userMessageId: 'm1',
    conversationId: 'c1',
    status: 'running',
    failureCode: null,
  };
  detail = { ...conversation, activeRun: running } as never;
  let stopped = false;
  const item = (content: string, revision: number) => ({
    itemId: 'answer',
    position: 0,
    content,
    revision,
    isFinal: false,
    truncated: false,
  });
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
    if (path.endsWith('/output'))
      return stopped
        ? {
            error: { error: { code: 'UNAVAILABLE', message: 'Unavailable.' } },
            response: new Response(null, { status: 503 }),
          }
        : response({
            runId: 'r1',
            status: 'running',
            finalMessageId: null,
            items: [item('Partial', 1)],
            timings: {},
          });
    const recovered = {
      ...running,
      status: 'cancelled',
      planId: null,
      context: null,
      createdAt: '2026-10-05T10:00:00Z',
      startedAt: null,
      finishedAt: null,
      ...turnFields,
      output: [item('Partial reply, then stopped', 2)],
    };
    if (path.endsWith('/runs') && stopped)
      return response({ runs: [recovered], nextBeforeSequence: null });
    if (path.endsWith('/turn') && stopped) return response(recovered);
    return Reflect.apply(original, api, [path, ...args]);
  }) as typeof api.GET);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount('/chat/c1', client);
  expect(await screen.findByText('Partial')).toBeInTheDocument();
  stopped = true;
  detail = {
    ...conversation,
    activeRun: null,
    latestRun: { ...running, status: 'cancelled' },
  } as never;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['chat'] });
  });
  expect(await screen.findByText('Partial reply, then stopped')).toBeInTheDocument();
  expect(screen.queryByText('Partial')).not.toBeInTheDocument();
  expect(screen.getByText('Stopped · incomplete')).toBeInTheDocument();
  client.clear();
});

it('drops an older streamed copy of the answer once the durable reply loads', async () => {
  const running = {
    id: 'r1',
    userMessageId: 'm1',
    conversationId: 'c1',
    status: 'running',
    failureCode: null,
  };
  detail = { ...conversation, activeRun: running } as never;
  let finished = false;
  const original = vi.mocked(api.GET).getMockImplementation()!;
  vi.mocked(api.GET).mockImplementation((async (path: string, ...args: unknown[]) => {
    if (path.endsWith('/output'))
      return finished
        ? {
            error: { error: { code: 'UNAVAILABLE', message: 'Unavailable.' } },
            response: new Response(null, { status: 503 }),
          }
        : response({
            runId: 'r1',
            status: 'running',
            finalMessageId: null,
            items: [
              {
                itemId: 'answer',
                position: 0,
                content: 'Hello',
                revision: 1,
                isFinal: false,
                truncated: false,
              },
            ],
            timings: {},
          });
    if (path.endsWith('/messages') && finished)
      return response({
        messages: [
          { id: 'm1', sequence: 1, role: 'user', content: 'Saved message', context: null },
          {
            id: 'reply',
            sequence: 2,
            role: 'assistant',
            content: 'Hello there',
            producingRunId: 'r1',
            context: null,
          },
        ],
        nextBeforeSequence: null,
      });
    return Reflect.apply(original, api, [path, ...args]);
  }) as typeof api.GET);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount('/chat/c1', client);
  expect(await screen.findByText('Hello')).toBeInTheDocument();
  finished = true;
  detail = {
    ...conversation,
    activeRun: null,
    latestRun: { ...running, status: 'completed' },
  } as never;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['chat'] });
  });
  expect(await screen.findByText('Hello there')).toBeInTheDocument();
  expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  client.clear();
});
