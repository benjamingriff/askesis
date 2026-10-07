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
type Resources = { runId?: string; conversationId?: string; planId?: string };
/**
 * Map one notification to the reads it can change. Text and tool activity only touch their
 * turn; plan content refreshes only when a plan or version row was written, and a changed plan
 * never refreshes another plan.
 */
export function invalidateNotification(client: QueryClient, event: string, raw: unknown) {
  const { runId, conversationId, planId } = raw as Resources;
  const invalidate = (...queryKey: unknown[]) => void client.invalidateQueries({ queryKey });
  const plansConversations = (id: string) =>
    void client.invalidateQueries({
      queryKey: ['chat', 'detail'],
      predicate: (query) => (query.state.data as { planId?: string } | undefined)?.planId === id,
    });
  switch (event) {
    case 'reset':
      void client.invalidateQueries();
      return;
    case 'output.changed':
      if (runId) invalidate('chat', 'output', runId);
      return;
    case 'activity.changed':
      if (runId) invalidate('chat', 'turn', runId);
      return;
    case 'run.changed':
      if (runId) invalidate('chat', 'turn', runId);
      if (conversationId) {
        invalidate('chat', 'detail', conversationId);
        invalidate('chat', 'runs', conversationId);
      }
      // A plan-wide run is visible from every chat for its plan, and generation coverage is
      // part of the brief state.
      if (planId) {
        plansConversations(planId);
        invalidate('plans', planId, 'brief');
      }
      return;
    case 'message.changed':
      if (conversationId) {
        invalidate('chat', 'detail', conversationId);
        invalidate('chat', 'messages', conversationId);
      }
      invalidate('chat', 'list');
      return;
    case 'conversation.changed':
      if (conversationId) invalidate('chat', 'detail', conversationId);
      invalidate('chat', 'list');
      return;
    case 'performance.changed':
      // Fitness belongs to the athlete: every plan's resolved paces and lock checks follow it.
      invalidate('performance');
      invalidate('plan-workouts');
      invalidate('plans');
      return;
    case 'plan.changed':
      if (!planId) return;
      invalidate('plans', planId);
      invalidate('plans', 'collection');
      plansConversations(planId);
      // Conversation rows show the plan's name and follow its archive state.
      invalidate('chat', 'list');
      return;
  }
}
/** While the stream is down, active chat and plan reads refresh on this interval instead. */
export const FALLBACK_REFRESH_MS = 3000;
export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    let cursor: string | undefined,
      failures = 0,
      // Ends the current connection or backoff wait so the next attempt starts now.
      retry = new AbortController();
    const reconnect = async () => {
      while (!stop.signal.aborted) {
        retry = new AbortController();
        try {
          if (cursor === undefined) {
            const bootstrap = await authenticatedFetch('/api/v1/live/bootstrap', {
              signal: AbortSignal.any([stop.signal, AbortSignal.timeout(20000)]),
            });
            if (!bootstrap.ok) throw new Error('Live bootstrap failed');
            const value = (await bootstrap.json()) as { cursor: string };
            cursor = value.cursor;
            // Reads that started before the cursor was captured could miss a change committed
            // in between, so they are refreshed once; later changes all replay from the cursor.
            await client.invalidateQueries();
          }
          const connection = AbortSignal.any([
            stop.signal,
            retry.signal,
            AbortSignal.timeout(60000),
          ]);
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
          if (retry.signal.aborted) continue;
          setState('reconnecting');
          failures++;
          const wait = AbortSignal.any([stop.signal, retry.signal]);
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(
              done,
              Math.min(10000, 500 * 2 ** Math.min(failures, 5) * (0.8 + Math.random() * 0.4)),
            );
            function done() {
              window.clearTimeout(timer);
              wait.removeEventListener('abort', done);
              resolve();
            }
            wait.addEventListener('abort', done, { once: true });
          });
        }
      }
    };
    // A backgrounded tab or a network change can leave a silently dead stream. Reconnecting
    // replays everything after the cursor, so no blanket refetch is needed.
    const resume = () => {
      if (document.visibilityState !== 'hidden') retry.abort();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    void reconnect();
    return () => {
      stop.abort();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, client]);
  useEffect(() => {
    if (!enabled || state === 'live') return;
    const timer = window.setInterval(() => {
      for (const key of ['chat', 'plans', 'plan-workouts'])
        void client.invalidateQueries({ queryKey: [key], refetchType: 'active' });
    }, FALLBACK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, state, client]);
  return (
    <LiveContext.Provider value={enabled ? state : 'reconnecting'}>{children}</LiveContext.Provider>
  );
}
