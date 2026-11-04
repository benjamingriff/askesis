import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
