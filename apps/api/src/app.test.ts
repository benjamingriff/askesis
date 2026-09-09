import { describe, expect, it } from 'vitest';
import { app } from './app.js';

describe('Askesis API', () => {
  it.each([
    '/api/v1/plans',
    '/api/v1/plans/00000000-0000-4000-8000-000000000010/draft',
    '/api/v1/plans/00000000-0000-4000-8000-000000000010/revisions',
  ])('requires authentication for %s', async (path) => {
    expect((await app.request(path)).status).toBe(401);
  });
  it('returns liveness without accessing PostgreSQL', async () => {
    const response = await app.request('/api/health', {
      headers: { 'x-request-id': 'test-request-id' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-request-id');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('uses the standard not-found envelope', async () => {
    const response = await app.request('/does-not-exist', {
      headers: { 'x-request-id': 'missing-request' },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: 'missing-request',
      },
    });
  });

  it('rejects protected routes without a session token', async () => {
    const response = await app.request('/api/v1/workouts', {
      headers: { 'x-request-id': 'unauthenticated-request' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        requestId: 'unauthenticated-request',
      },
    });
  });
});
