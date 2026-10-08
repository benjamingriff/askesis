import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from './query-provider';
import { configureAuthTokenProvider } from './api';
import { FALLBACK_REFRESH_MS, LiveProvider, useLiveState } from './live';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const Probe = () => <p>{useLiveState()}</p>;
it('reconnects reads with fresh credentials and resets the cursor on account changes', async () => {
  const calls: { url: string; token: string | null; signal: AbortSignal }[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let account = 'A';
  const token = vi.fn(async () => `${account}-${calls.length}`);
  configureAuthTokenProvider(token);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal;
      calls.push({ url, token: new Headers(options.headers).get('authorization'), signal });
      if (url.endsWith('/bootstrap'))
        return new Response(JSON.stringify({ cursor: account === 'A' ? '5' : '50' }));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller);
          signal.addEventListener(
            'abort',
            () => controller.error(new DOMException('Stopped', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  const page = render(
    <AccountQueryProvider key="A" accountId="A">
      <Probe />
    </AccountQueryProvider>,
  );
  await screen.findByText('live');
  streams[0]!.enqueue(
    new TextEncoder().encode('event: output.changed\nid: 6\ndata: {"runId":"r1"}\n\n'),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  streams[0]!.error(new Error('Transport lost'));
  await screen.findByText('reconnecting');
  await waitFor(() => expect(streams.length).toBe(2), { timeout: 3000 });
  expect(calls.at(-1)!.url).toContain('cursor=6');
  expect(calls[1]!.token).not.toBe(calls.at(-1)!.token);
  const old = calls.at(-1)!.signal;
  account = 'B';
  page.rerender(
    <AccountQueryProvider key="B" accountId="B">
      <Probe />
    </AccountQueryProvider>,
  );
  await waitFor(() => expect(streams.length).toBe(3));
  expect(old.aborted).toBe(true);
  expect(calls.at(-1)!.url).toContain('cursor=50');
  expect(calls.at(-1)!.token).toContain('Bearer B-');
  expect(calls.every((call) => !call.url.includes('Bearer'))).toBe(true);
  const current = calls.at(-1)!.signal;
  page.rerender(
    <AccountQueryProvider key="signed-out" accountId="signed-out">
      <Probe />
    </AccountQueryProvider>,
  );
  expect(current.aborted).toBe(true);
  const count = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toHaveLength(count);
});
it('resumes from its cursor when the tab returns instead of refetching every read', async () => {
  const urls: string[] = [];
  configureAuthTokenProvider(async () => 'token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/bootstrap')) return new Response(JSON.stringify({ cursor: '9' }));
      const signal = options.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener(
            'abort',
            () => controller.error(new DOMException('Stopped', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  render(
    <AccountQueryProvider key="A" accountId="A">
      <Probe />
    </AccountQueryProvider>,
  );
  await screen.findByText('live');
  await waitFor(() => expect(urls.filter((url) => url.includes('/events'))).toHaveLength(1));
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => expect(urls.filter((url) => url.includes('/events'))).toHaveLength(2));
  expect(urls.at(-1)).toContain('cursor=9');
  expect(urls.filter((url) => url.endsWith('/bootstrap'))).toHaveLength(1);
  expect(screen.getByText('live')).toBeInTheDocument();
});

// Drain the controlled stream/token promises without real-time sleeps.
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function pendingConnection(accountScoped = false) {
  const calls: { url: string; token: string | null; signal: AbortSignal }[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let replacement: ((response: Response) => void) | undefined;
  const token = vi.fn(async () => `token-${calls.length}`);
  configureAuthTokenProvider(token);
  const response = (signal: AbortSignal) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller);
          signal.addEventListener(
            'abort',
            () => controller.error(new DOMException('Stopped', 'AbortError')),
            { once: true },
          );
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal;
      calls.push({ url, token: new Headers(options.headers).get('authorization'), signal });
      if (url.endsWith('/bootstrap')) return new Response(JSON.stringify({ cursor: '9' }));
      if (streams.length === 0) return response(signal);
      return new Promise<Response>((resolve, reject) => {
        replacement = resolve;
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {
          once: true,
        });
      });
    }),
  );
  const performance = vi.fn(async () => 'current pace');
  const workouts = vi.fn(async () => 'current workouts');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const accountClients = new Set<QueryClient>();
  function ActiveReads() {
    accountClients.add(useQueryClient());
    useQuery({ queryKey: ['performance'], queryFn: performance });
    useQuery({ queryKey: ['plan-workouts', 'plan-1'], queryFn: workouts });
    return <Probe />;
  }
  const accountPage = (accountId: string) => (
    <AccountQueryProvider key={accountId} accountId={accountId}>
      <ActiveReads />
    </AccountQueryProvider>
  );
  const page = render(
    accountScoped ? (
      accountPage('A')
    ) : (
      <QueryClientProvider client={client}>
        <LiveProvider enabled>
          <ActiveReads />
        </LiveProvider>
      </QueryClientProvider>
    ),
  );
  return {
    calls,
    streams,
    token,
    performance,
    workouts,
    page,
    client,
    accountClients,
    setAccount: (accountId: string) => page.rerender(accountPage(accountId)),
    recover: () => replacement!(response(calls.at(-1)!.signal)),
  };
}

it.each(['EOF', 'online', 'visible'] as const)(
  'refreshes mounted reads during pending %s renewal, then stops fallback on recovery',
  async (trigger) => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const live = pendingConnection();
    await act(settle);
    expect(screen.getByText('live')).toBeInTheDocument();
    await act(async () => {
      live.streams[0]!.enqueue(
        new TextEncoder().encode('event: output.changed\nid: 10\ndata: {"runId":"r1"}\n\n'),
      );
      await settle();
      if (trigger === 'EOF') live.streams[0]!.close();
      else if (trigger === 'online') window.dispatchEvent(new Event('online'));
      else document.dispatchEvent(new Event('visibilitychange'));
      await settle();
    });
    expect(screen.getByText('reconnecting')).toBeInTheDocument();
    expect(live.calls).toHaveLength(3);
    expect(live.calls[2]!.url).toContain('cursor=10');
    expect(live.calls[2]!.token).not.toBe(live.calls[1]!.token);
    const performanceBefore = live.performance.mock.calls.length;
    const workoutsBefore = live.workouts.mock.calls.length;
    for (let i = 1; i <= 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FALLBACK_REFRESH_MS);
      });
      expect(live.performance).toHaveBeenCalledTimes(performanceBefore + i);
      expect(live.workouts).toHaveBeenCalledTimes(workoutsBefore + i);
    }
    await act(async () => {
      live.recover();
      await settle();
    });
    expect(screen.getByText('live')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * FALLBACK_REFRESH_MS);
    });
    expect(live.performance).toHaveBeenCalledTimes(performanceBefore + 3);
    expect(live.workouts).toHaveBeenCalledTimes(workoutsBefore + 3);
    await act(async () => {
      live.streams[1]!.enqueue(
        new TextEncoder().encode('event: performance.changed\nid: 11\ndata: {}\n\n'),
      );
      await settle();
    });
    expect(live.performance).toHaveBeenCalledTimes(performanceBefore + 4);
    expect(live.workouts).toHaveBeenCalledTimes(workoutsBefore + 4);
    // Every transport request is a read; renewal never submits a message or run.
    expect(live.calls.every((call) => /\/live\/(bootstrap|events)/.test(call.url))).toBe(true);
    live.page.unmount();
    live.client.clear();
  },
);

it('enables fallback before replacement credentials arrive and aborts on unmount', async () => {
  vi.useFakeTimers();
  const live = pendingConnection();
  await act(settle);
  let releaseToken!: (value: string) => void;
  live.token.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        releaseToken = resolve;
      }),
  );
  await act(async () => {
    live.streams[0]!.close();
    await settle();
  });
  expect(screen.getByText('reconnecting')).toBeInTheDocument();
  expect(live.calls).toHaveLength(2);
  const readsBefore = live.workouts.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FALLBACK_REFRESH_MS);
  });
  expect(live.workouts).toHaveBeenCalledTimes(readsBefore + 1);
  await act(async () => {
    releaseToken('fresh-token');
    await settle();
  });
  const pending = live.calls.at(-1)!.signal;
  live.page.unmount();
  live.client.clear();
  expect(pending.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
  });
  expect(live.calls).toHaveLength(3);
  expect(live.workouts).toHaveBeenCalledTimes(readsBefore + 1);
});

it.each(['online', 'visible'] as const)(
  'resumes a failed connection before backoff expires on %s and cleans up on unmount',
  async (trigger) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const live = pendingConnection();
    await act(settle);
    await act(async () => {
      live.streams[0]!.error(new Error('Transport lost'));
      await settle();
    });
    expect(screen.getByText('reconnecting')).toBeInTheDocument();
    expect(live.calls).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      if (trigger === 'online') window.dispatchEvent(new Event('online'));
      else document.dispatchEvent(new Event('visibilitychange'));
      await settle();
    });
    expect(live.calls).toHaveLength(3);
    expect(live.calls.at(-1)!.url).toContain('cursor=9');
    expect(live.calls.at(-1)!.token).not.toBe(live.calls[1]!.token);
    const readsBefore = live.performance.mock.calls.length;
    live.page.unmount();
    live.client.clear();
    expect(live.calls.at(-1)!.signal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(live.calls).toHaveLength(3);
    expect(live.performance).toHaveBeenCalledTimes(readsBefore);
  },
);

it('cleans up fallback and retry waits when unmounted during backoff', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const live = pendingConnection();
  await act(settle);
  await act(async () => {
    live.streams[0]!.error(new Error('Transport lost'));
    await settle();
  });
  const readsBefore = live.workouts.mock.calls.length;
  live.page.unmount();
  live.client.clear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(live.calls).toHaveLength(2);
  expect(live.workouts).toHaveBeenCalledTimes(readsBefore);
});

it('aborts pending renewal and discards cached reads on account change and sign-out', async () => {
  vi.useFakeTimers();
  const live = pendingConnection(true);
  await act(settle);
  const firstClient = [...live.accountClients][0]!;
  expect(firstClient.getQueryData(['performance'])).toBe('current pace');
  await act(async () => {
    live.streams[0]!.close();
    await settle();
  });
  const oldConnection = live.calls.at(-1)!.signal;
  await act(async () => {
    live.setAccount('B');
    await settle();
  });
  expect(oldConnection.aborted).toBe(true);
  expect(firstClient.getQueryCache().getAll()).toHaveLength(0);
  expect(live.calls.filter((call) => call.url.endsWith('/bootstrap'))).toHaveLength(2);
  const secondClient = [...live.accountClients][1]!;
  const pending = live.calls.at(-1)!.signal;
  await act(async () => {
    live.setAccount('signed-out');
    await settle();
  });
  expect(pending.aborted).toBe(true);
  expect(secondClient.getQueryCache().getAll()).toHaveLength(0);
  const callsBefore = live.calls.length;
  const readsBefore = live.workouts.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
    window.dispatchEvent(new Event('online'));
    await settle();
  });
  expect(live.calls).toHaveLength(callsBefore);
  expect(live.workouts).toHaveBeenCalledTimes(readsBefore);
  live.page.unmount();
  live.client.clear();
});
