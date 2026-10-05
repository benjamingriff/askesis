import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from './api';

type LiveState = 'connecting' | 'live' | 'reconnecting';
const LiveContext = createContext<LiveState>('reconnecting');
export const useLiveState = () => useContext(LiveContext);
type Notification = { event: string; id?: string; data: string };
/** Parse fetch SSE across arbitrary byte boundaries, including CRLF and multiline data. */
export async function readNotifications(
  response: Response,
  onEvent: (event: Notification) => void,
) {
  if (!response.body) throw new Error('Live response has no body');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = '',
    event = 'message',
    id: string | undefined,
    data: string[] = [],
    frameSize = 0;
  const line = (value: string) => {
    if (!value) {
      if (data.length) onEvent({ event, ...(id ? { id } : {}), data: data.join('\n') });
      event = 'message';
      id = undefined;
      data = [];
      frameSize = 0;
      return;
    }
    frameSize += value.length;
    if (frameSize > 65536) throw new Error('Live event exceeded its limit');
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':'),
      field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = content;
    if (field === 'id' && !content.includes('\0')) id = content;
    if (field === 'data') data.push(content);
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, newline).replace(/\r$/, ''));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > 65536) throw new Error('Live event exceeded its limit');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function invalidateNotification(client: QueryClient, event: string, raw: unknown) {
  const value = raw as { runId?: string; conversationId?: string; planId?: string };
  if (event === 'reset') {
    void client.invalidateQueries();
    return;
  }
  if (event === 'output.changed' && value.runId) {
    void client.invalidateQueries({ queryKey: ['chat', 'output', value.runId] });
    return;
  }
  if (value.conversationId) {
    void client.invalidateQueries({ queryKey: ['chat', 'detail', value.conversationId] });
    if (event === 'message.changed' || event === 'run.changed') {
      void client.invalidateQueries({ queryKey: ['chat', 'messages', value.conversationId] });
      void client.invalidateQueries({ queryKey: ['chat', 'runs', value.conversationId] });
    }
  }
  if (event === 'conversation.changed' || event === 'message.changed')
    void client.invalidateQueries({ queryKey: ['chat', 'list'] });
  if (value.runId) {
    void client.invalidateQueries({ queryKey: ['chat', 'events', value.runId] });
    void client.invalidateQueries({ queryKey: ['chat', 'output', value.runId] });
    void client.invalidateQueries({ queryKey: ['chat', 'changes', value.runId] });
  }
  if (value.planId) {
    void client.invalidateQueries({ queryKey: ['plans', value.planId] });
    void client.invalidateQueries({ queryKey: ['plans', 'collection'] });
    void client.invalidateQueries({ queryKey: ['draft-changes', value.planId] });
    void client.invalidateQueries({
      queryKey: ['chat', 'detail'],
      predicate: (query) =>
        (query.state.data as { planId?: string } | undefined)?.planId === value.planId,
    });
  }
}
export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    let cursor: string | undefined,
      failures = 0;
    const reconnect = async () => {
      while (!stop.signal.aborted) {
        try {
          if (cursor === undefined) {
            const bootstrap = await authenticatedFetch('/api/v1/live/bootstrap', {
              signal: AbortSignal.any([stop.signal, AbortSignal.timeout(20000)]),
            });
            if (!bootstrap.ok) throw new Error('Live bootstrap failed');
            const value = (await bootstrap.json()) as { cursor: string };
            cursor = value.cursor;
            // Queries may have loaded before bootstrap captured its cursor.
            await client.invalidateQueries();
          }
          const connection = AbortSignal.any([stop.signal, AbortSignal.timeout(60000)]);
          const response = await authenticatedFetch(
            `/api/v1/live/events?cursor=${encodeURIComponent(cursor)}`,
            { signal: connection },
          );
          if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream'))
            throw new Error('Live connection failed');
          setState('live');
          failures = 0;
          await readNotifications(response, (notification) => {
            if (notification.event === 'heartbeat') return;
            const data: unknown = JSON.parse(notification.data);
            if (notification.id && /^\d{1,18}$/.test(notification.id)) {
              if (
                notification.event !== 'reset' &&
                BigInt(notification.id) <= BigInt(cursor ?? '0')
              )
                return;
              cursor = notification.id;
            }
            invalidateNotification(client, notification.event, data);
          });
        } catch {
          if (stop.signal.aborted) break;
          setState('reconnecting');
          failures++;
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(
              done,
              Math.min(10000, 500 * 2 ** Math.min(failures, 5) * (0.8 + Math.random() * 0.4)),
            );
            function done() {
              window.clearTimeout(timer);
              stop.signal.removeEventListener('abort', done);
              resolve();
            }
            stop.signal.addEventListener('abort', done, { once: true });
          });
        }
      }
    };
    const reconcile = () => {
      if (document.visibilityState !== 'hidden')
        void client.invalidateQueries({ refetchType: 'active' });
    };
    window.addEventListener('online', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    void reconnect();
    return () => {
      stop.abort();
      window.removeEventListener('online', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [enabled, client]);
  useEffect(() => {
    if (!enabled || state === 'live') return;
    const timer = window.setInterval(() => {
      for (const key of ['chat', 'plans', 'plan-workouts', 'draft-changes'])
        void client.invalidateQueries({ queryKey: [key], refetchType: 'active' });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, state, client]);
  return (
    <LiveContext.Provider value={enabled ? state : 'reconnecting'}>{children}</LiveContext.Provider>
  );
}
