import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from './query-provider';
import { configureAuthTokenProvider } from './api';
import { useLiveState } from './live';
afterEach(() => {
  cleanup();
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
