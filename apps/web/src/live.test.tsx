import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { readNotifications, invalidateNotification } from './live';
it('parses split UTF-8, CRLF, multiline data, heartbeat and reset frames', async () => {
  const text =
    ': keepalive\r\n\r\nevent: output.changed\r\nid: 7\r\ndata: {"runId":"r1",\r\ndata: "label":"é"}\r\n\r\nevent: heartbeat\ndata: {}\n\nevent: reset\nid: 12\ndata: {"cursor":"12"}\n\n';
  const bytes = new TextEncoder().encode(text);
  const events: unknown[] = [];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  );
  await readNotifications(response, (event) => events.push(event));
  expect(events).toEqual([
    { event: 'output.changed', id: '7', data: '{"runId":"r1",\n"label":"é"}' },
    { event: 'heartbeat', data: '{}' },
    { event: 'reset', id: '12', data: '{"cursor":"12"}' },
  ]);
});
it('refreshes only output on text events and only associated plan data and collections on saved edits', () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  invalidateNotification(client, 'output.changed', { runId: 'r1', planId: 'p1' });
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['chat', 'output', 'r1'] });
  invalidate.mockClear();
  invalidateNotification(client, 'plan.changed', { planId: 'p1' });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['plans', 'p1'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['plans', 'collection'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['plans'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['plan-workouts'] });
  invalidate.mockClear();
  invalidateNotification(client, 'reset', {});
  expect(invalidate).toHaveBeenCalledExactlyOnceWith();
  client.clear();
});
it('rejects oversized frames and cancels a failing response reader', async () => {
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(70000)));
      },
      cancel,
    }),
  );
  await expect(readNotifications(response, () => {})).rejects.toThrow('limit');
  expect(cancel).toHaveBeenCalledOnce();
});
