import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';
const owner = '00000000-0000-0000-0000-000000000001';
// Only Clerk verification is stubbed; route authorization and PostgreSQL replay are real.
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    authenticateRequest: async (request: Request) => ({
      isAuthenticated: request.headers.get('authorization') === 'Bearer fixture-session',
      toAuth: () => ({ userId: 'fixture-user' }),
    }),
  }),
}));
vi.mock('../../src/auth/athlete-provisioning.js', () => ({
  ensureAthlete: async () => ({
    id: '00000000-0000-0000-0000-000000000001',
    displayName: 'Fixture owner',
    timezone: 'Europe/London',
  }),
  syncAthleteTimezone: async (athlete: unknown) => athlete,
}));
import { app } from '../../src/app.js';
import { closeDatabase } from '../../src/database/client.js';
import { createPlan } from '../../src/modules/plans/plan.service.js';
import { bootstrap } from '../../src/modules/live/live.service.js';
afterAll(closeDatabase);
it('serves authenticated owner replay as unbuffered SSE and validates resume cursors', async () => {
  const before = await bootstrap(owner);
  const plan = await createPlan(owner, 'HTTP replay fixture', randomUUID());
  const response = await app.request(`/api/v1/live/events?cursor=${before.cursor}`, {
    headers: { authorization: 'Bearer fixture-session' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-accel-buffering')).toBe('no');
  const reader = response.body!.getReader();
  let text = '';
  try {
    while (!text.includes(plan.id)) {
      const part = await reader.read();
      expect(part.done).toBe(false);
      text += new TextDecoder().decode(part.value);
    }
    expect(text).toContain('event: plan.changed');
    expect(text).toMatch(/id: \d+/);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const invalid = await app.request('/api/v1/live/events?cursor=0', {
    headers: { authorization: 'Bearer fixture-session', 'last-event-id': 'invalid' },
  });
  expect(invalid.status).toBe(400);
  const unauthenticated = await app.request('/api/v1/live/events?cursor=0');
  expect(unauthenticated.status).toBe(401);
  const cursor = await app.request('/api/v1/live/bootstrap', {
    headers: { authorization: 'Bearer fixture-session' },
  });
  expect(await cursor.json()).toHaveProperty('cursor');
});
