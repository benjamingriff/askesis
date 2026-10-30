import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClerkAPIResponseError } from '@clerk/backend/errors';
import type { AppEnvironment } from './types.js';

const authenticateRequest = vi.fn();
const ensureAthlete = vi.fn();
const syncAthleteTimezone = vi.fn();

vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ authenticateRequest }),
}));

vi.mock('./athlete-provisioning.js', () => ({ ensureAthlete, syncAthleteTimezone }));

const { requireAuthentication } = await import('./middleware.js');
const { requestContext } = await import('../http/middleware.js');

function testApp() {
  const app = new OpenAPIHono<AppEnvironment>();
  app.use('*', requestContext);
  app.use('*', requireAuthentication);
  app.get('/api/v1/account', (context) => context.json({ ok: true }));
  app.get('/protected', (context) =>
    context.json({
      athleteId: context.get('athlete').id,
      timezone: context.get('athlete').timezone,
    }),
  );
  return app;
}

describe('requireAuthentication', () => {
  beforeEach(() => {
    authenticateRequest.mockReset();
    ensureAthlete.mockReset();
    syncAthleteTimezone.mockReset();
    syncAthleteTimezone.mockImplementation(async (athlete: object, reported?: string) =>
      reported ? { ...athlete, timezone: reported } : athlete,
    );
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
      timezone: 'UTC',
      deletionPending: false,
    });

    const response = await testApp().request('/protected');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ athleteId: 'athlete-id', timezone: 'UTC' });
    expect(ensureAthlete).toHaveBeenCalledWith(expect.anything(), 'user_test');
  });

  it('follows the timezone reported by the device', async () => {
    authenticateRequest.mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_test' }),
    });
    ensureAthlete.mockResolvedValue({
      id: 'athlete-id',
      displayName: 'Test Runner',
      clerkUserId: 'user_test',
      timezone: 'UTC',
      deletionPending: false,
    });

    const response = await testApp().request('/protected', {
      headers: { 'X-Askesis-Timezone': 'Europe/London' },
    });

    await expect(response.json()).resolves.toEqual({
      athleteId: 'athlete-id',
      timezone: 'Europe/London',
    });
    expect(syncAthleteTimezone).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'athlete-id' }),
      'Europe/London',
    );
  });

  it('allows only account routes while deletion is pending', async () => {
    authenticateRequest.mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_test' }),
    });
    ensureAthlete.mockResolvedValue({
      id: 'athlete-id',
      displayName: 'Test Runner',
      clerkUserId: 'user_test',
      timezone: 'UTC',
      deletionPending: true,
    });

    const blocked = await testApp().request('/protected');
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: 'ACCOUNT_DELETION_PENDING' },
    });
    expect((await testApp().request('/api/v1/account')).status).toBe(200);
  });

  it('treats a session for a deleted Clerk user as signed out', async () => {
    authenticateRequest.mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_gone' }),
    });
    ensureAthlete.mockRejectedValue(
      new ClerkAPIResponseError('Not Found', { data: [], status: 404 }),
    );

    const response = await testApp().request('/protected');
    expect(response.status).toBe(401);
  });
});
