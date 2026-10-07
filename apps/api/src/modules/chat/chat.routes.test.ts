import { beforeEach, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../../auth/types.js';
import type * as Service from './chat.service.js';
const mocks = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn(), detail: vi.fn() }));
vi.mock('../../auth/middleware.js', () => ({
  requireAuthentication: (async (c, next) => {
    c.set('athlete', {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Test',
      clerkUserId: 'user_test',
      timezone: 'UTC',
    });
    await next();
  }) satisfies MiddlewareHandler<AppEnvironment>,
}));
vi.mock('./chat.service.js', async (original) => ({
  ...(await original<typeof Service>()),
  sendMessage: mocks.send,
  createConversation: mocks.create,
  getConversation: mocks.detail,
}));
const { app } = await import('../../app.js');
const { ChatError } = await import('./chat.core.js');
const id = '00000000-0000-4000-8000-000000000010';
beforeEach(() => vi.resetAllMocks());

it('validates message bounds and idempotency before invoking the service', async () => {
  for (const content of ['', 'x'.repeat(32001)]) {
    const response = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test' },
      body: JSON.stringify({ content }),
    });
    expect(response.status).toBe(400);
  }
  const response = await app.request(`/api/v1/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello' }),
  });
  expect(response.status).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('derives the owner from authentication and returns accepted state', async () => {
  mocks.send.mockResolvedValue({ message: { id: 'message' }, run: { id: 'run' } });
  const response = await app.request(`/api/v1/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'send-1' },
    body: JSON.stringify({ content: 'hello', ownerId: 'foreign' }),
  });
  expect(response.status).toBe(202);
  expect(mocks.send).toHaveBeenCalledWith(
    '00000000-0000-4000-8000-000000000001',
    id,
    { content: 'hello', target: null },
    'send-1',
  );
});
it('returns unavailable and hidden errors through the standard envelope', async () => {
  mocks.create.mockRejectedValue(new ChatError('AGENT_UNAVAILABLE', 'Coaching unavailable.', 503));
  const response = await app.request('/api/v1/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'new' },
    body: JSON.stringify({ initialMessage: { content: 'hello' } }),
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: 'AGENT_UNAVAILABLE' } });
  mocks.detail.mockRejectedValue(new ChatError('NOT_FOUND', 'Not found.', 404));
  expect((await app.request(`/api/v1/conversations/${id}`)).status).toBe(404);
});
it('does not expose browser endpoints for executor transitions', async () => {
  for (const action of ['claim', 'complete', 'fail'])
    expect(
      (await app.request(`/api/v1/agent-runs/${id}/${action}`, { method: 'POST' })).status,
    ).toBe(404);
});
