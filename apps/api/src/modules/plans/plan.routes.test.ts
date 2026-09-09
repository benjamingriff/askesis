import { beforeEach, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../../auth/types.js';
import type * as PlanService from './plan.service.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  draft: vi.fn(),
  list: vi.fn(),
  restore: vi.fn(),
}));
vi.mock('../../auth/middleware.js', () => ({
  requireAuthentication: (async (c, next) => {
    c.set('athlete', {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Route test',
      clerkUserId: 'user_test',
    });
    await next();
  }) satisfies MiddlewareHandler<AppEnvironment>,
}));
vi.mock('./plan.service.js', async (original) => ({
  ...(await original<typeof PlanService>()),
  createPlan: mocks.create,
  getDraft: mocks.draft,
  listPlans: mocks.list,
  restoreRevision: mocks.restore,
}));
const { app } = await import('../../app.js');
const { PlanError } = await import('./plan.service.js');
const id = '00000000-0000-4000-8000-000000000010';
beforeEach(() => vi.resetAllMocks());

it('requires idempotency and validates input before creating a plan', async () => {
  const response = await app.request('/api/v1/plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Test' }),
  });
  expect(response.status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('passes collection selection and the authenticated owner to the service', async () => {
  mocks.list.mockResolvedValue([]);
  const response = await app.request('/api/v1/plans?collection=archive');
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', 'archive');
});
it('maps hidden draft authorization errors to the standard envelope', async () => {
  mocks.draft.mockRejectedValue(new PlanError('PLAN_NOT_FOUND', 'Plan not found.', 404));
  const response = await app.request(`/api/v1/plans/${id}/draft`, {
    headers: { 'x-request-id': 'draft-test' },
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: { code: 'PLAN_NOT_FOUND', message: 'Plan not found.', requestId: 'draft-test' },
  });
});
it('rejects incomplete restore confirmation without invoking the service', async () => {
  const response = await app.request(`/api/v1/plans/${id}/revisions/${id}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'restore-test' },
    body: JSON.stringify({ expectedStateVersion: 1 }),
  });
  expect(response.status).toBe(400);
  expect(mocks.restore).not.toHaveBeenCalled();
});
