import { beforeEach, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../../auth/types.js';
const mocks = vi.hoisted(() => ({ read: vi.fn(), command: vi.fn() }));
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
vi.mock('./training-log.service.js', async (original) => ({
  ...(await original<object>()),
  readTrainingLog: mocks.read,
  logCommand: mocks.command,
}));
const { app } = await import('../../app.js');
const id = '00000000-0000-4000-8000-000000000010';
beforeEach(() => vi.resetAllMocks());
it('validates statuses, actuals and bounded feedback before writing', async () => {
  for (const body of [
    { status: 'missed' },
    { status: 'done', rpe: 11 },
    { status: 'skipped', actualDurationSeconds: 10 },
    { status: 'done', note: 'x'.repeat(2001) },
    { status: 'done', ownerId: id },
  ]) {
    const r = await app.request(`/api/v1/plans/${id}/workouts/${id}/log`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(400);
  }
  expect(mocks.command).not.toHaveBeenCalled();
});
it('derives the log owner from the authenticated account', async () => {
  mocks.command.mockResolvedValue({ id });
  const r = await app.request(`/api/v1/plans/${id}/workouts/${id}/log`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'save-1' },
    body: JSON.stringify({ status: 'done' }),
  });
  expect(r.status).toBe(200);
  expect(mocks.command.mock.calls[0]?.slice(0, 4)).toEqual([
    '00000000-0000-4000-8000-000000000001',
    'log.put',
    'save-1',
    { planId: id, lineageId: id, input: { status: 'done' } },
  ]);
});
