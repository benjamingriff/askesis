import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from './types.js';

const authenticateRequest = vi.fn();
const ensureAthlete = vi.fn();

vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ authenticateRequest }),
}));

vi.mock('./athlete-provisioning.js', () => ({ ensureAthlete }));

const { requireAuthentication } = await import('./middleware.js');
const { requestContext } = await import('../http/middleware.js');

function testApp() {
  const app = new OpenAPIHono<AppEnvironment>();
  app.use('*', requestContext);
  app.use('*', requireAuthentication);
  app.get('/protected', (context) => context.json({ athleteId: context.get('athlete').id }));
  return app;
}

describe('requireAuthentication', () => {
  beforeEach(() => {
    authenticateRequest.mockReset();
    ensureAthlete.mockReset();
  });

  it('returns a standard error for an unauthenticated request', async () => {
    authenticateRequest.mockResolvedValue({ isAuthenticated: false });

    const response = await testApp().request('/protected', {
      headers: { 'x-request-id': 'auth-test' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        requestId: 'auth-test',
      },
    });
  });

  it('provisions and exposes an authenticated athlete', async () => {
    authenticateRequest.mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_test' }),
    });
    ensureAthlete.mockResolvedValue({
      id: 'athlete-id',
      displayName: 'Test Runner',
      clerkUserId: 'user_test',
    });

    const response = await testApp().request('/protected');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ athleteId: 'athlete-id' });
    expect(ensureAthlete).toHaveBeenCalledWith(expect.anything(), 'user_test');
  });
});
