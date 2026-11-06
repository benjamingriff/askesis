import { OpenAPIHono } from '@hono/zod-openapi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { resetApiConfigForTests } = await import('../config.js');

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
  afterEach(() => {
    vi.unstubAllEnvs();
    resetApiConfigForTests();
  });
  it('still requires authentication for hidden chat writes before validating requests', async () => {
    const { app } = await import('../app.js');
    vi.stubEnv('IN_APP_COACH', 'hidden');
    resetApiConfigForTests();
    authenticateRequest.mockResolvedValue({ isAuthenticated: false });
    for (const path of [
      '/api/v1/conversations',
      '/api/v1/plans/invalid/conversations/open',
      '/api/v1/conversations/invalid/messages',
    ]) {
      const response = await app.request(path, { method: 'POST' });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    }
    expect(ensureAthlete).not.toHaveBeenCalled();
  });
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

  it('checks authorized parties for browser tokens and verifies native tokens without them', async () => {
    process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:5173';
    resetApiConfigForTests();
    authenticateRequest.mockResolvedValue({ isAuthenticated: false });
    const token = (claims: object) =>
      `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
    try {
      await testApp().request('/protected', {
        headers: {
          Authorization: `Bearer ${token({ sub: 'user_test', azp: 'https://evil.test' })}`,
        },
      });
      await testApp().request('/protected', {
        headers: { Authorization: `Bearer ${token({ sub: 'user_test' })}` },
      });
      expect(authenticateRequest.mock.calls[0]?.[1]).toEqual({
        acceptsToken: 'session_token',
        authorizedParties: ['http://localhost:5173'],
      });
      expect(authenticateRequest.mock.calls[1]?.[1]).toEqual({ acceptsToken: 'session_token' });
    } finally {
      delete process.env.CLERK_AUTHORIZED_PARTIES;
      resetApiConfigForTests();
    }
  });

  it('verifies only the native token it exempts, never a session cookie beside it', async () => {
    process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:5173';
    resetApiConfigForTests();
    authenticateRequest.mockResolvedValue({ isAuthenticated: false });
    try {
      // Clerk ignores a lowercase scheme and would verify the cookie instead.
      const response = await testApp().request('/protected', {
        headers: {
          authorization: 'bearer header.e30.signature',
          cookie: '__session=browser-session-token',
        },
      });
      expect(response.status).toBe(401);
      const [request, options] = authenticateRequest.mock.calls[0] as [Request, object];
      expect(options).toEqual({ acceptsToken: 'session_token' });
      expect(request.headers.get('cookie')).toBeNull();
      expect(request.headers.get('authorization')).toBe('Bearer header.e30.signature');
    } finally {
      delete process.env.CLERK_AUTHORIZED_PARTIES;
      resetApiConfigForTests();
    }
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
      headers: { 'X-Waddle-Timezone': 'Europe/London' },
    });

    await expect(response.json()).resolves.toEqual({
      athleteId: 'athlete-id',
      timezone: 'Europe/London',
    });
    expect(syncAthleteTimezone).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'athlete-id' }),
      'Europe/London',
    );

    // Pages loaded before the rebrand still send the old header name.
    await testApp().request('/protected', { headers: { 'X-Askesis-Timezone': 'Asia/Tokyo' } });
    expect(syncAthleteTimezone).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'athlete-id' }),
      'Asia/Tokyo',
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
