import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../../auth/types.js';
import { resetApiConfigForTests } from '../../config.js';
import type * as AccountService from './account.service.js';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), request: vi.fn() }));
vi.mock('../../auth/middleware.js', () => ({
  requireAuthentication: (async (c, next) => {
    c.set('athlete', {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Route test',
      clerkUserId: 'user_test',
      timezone: 'UTC',
      deletionPending: false,
    });
    await next();
  }) satisfies MiddlewareHandler<AppEnvironment>,
}));
vi.mock('./account.service.js', async (original) => ({
  ...(await original<typeof AccountService>()),
  scheduleImmediatePurge: mocks.schedule,
  requestAccountDeletion: mocks.request,
}));
const { app } = await import('../../app.js');

const key = randomBytes(24);
const secret = `whsec_${key.toString('base64')}`;
function signed(payload: unknown, signingKey = key) {
  const body = JSON.stringify(payload);
  const id = 'msg_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', signingKey)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    body,
  };
}
const deleted = { type: 'user.deleted', object: 'event', data: { id: 'user_gone', deleted: true } };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = secret;
  resetApiConfigForTests();
});
afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  resetApiConfigForTests();
});

it('schedules an immediate purge for a verified user.deleted event', async () => {
  mocks.schedule.mockResolvedValue(true);
  const response = await app.request('/api/webhooks/clerk', signed(deleted));
  expect(response.status).toBe(200);
  expect(mocks.schedule).toHaveBeenCalledWith('user_gone');
});

it('rejects events with a wrong signature', async () => {
  const response = await app.request('/api/webhooks/clerk', signed(deleted, randomBytes(24)));
  expect(response.status).toBe(400);
  expect(mocks.schedule).not.toHaveBeenCalled();
});

it('ignores other events and is absent without a signing secret', async () => {
  const other = await app.request(
    '/api/webhooks/clerk',
    signed({ ...deleted, type: 'user.updated' }),
  );
  expect(other.status).toBe(200);
  expect(mocks.schedule).not.toHaveBeenCalled();
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  resetApiConfigForTests();
  expect((await app.request('/api/webhooks/clerk', signed(deleted))).status).toBe(404);
});

it('requests deletion for the signed-in athlete', async () => {
  mocks.request.mockResolvedValue({
    deletion: { requestedAt: '2026-10-19T00:00:00.000Z', purgeAfter: '2026-10-26T00:00:00.000Z' },
  });
  const response = await app.request('/api/v1/account/deletion', { method: 'POST' });
  expect(response.status).toBe(200);
  expect(mocks.request).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
});
