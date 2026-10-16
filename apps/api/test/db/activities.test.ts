import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { resetApiConfigForTests } from '../../src/config.js';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import {
  linkActivity,
  readActivityLinks,
  unlinkActivity,
} from '../../src/modules/activities/activity-link.service.js';
import {
  completeStravaConnection,
  disconnectStrava,
  listStravaActivities,
  readIntegrations,
  readStravaActivity,
  startStravaConnection,
  useStravaFetch,
} from '../../src/modules/activities/integration.service.js';

const owner = '00000000-0000-0000-0000-000000000001';
const plan = '00000000-0000-0000-0000-000000000010';
const now = new Date('2026-05-20T18:00:00Z');
const callback = 'http://localhost:5173/connections/strava/callback';
const db = getDatabase();

const activity = (id: number, local: string) => ({
  id,
  name: `Activity ${id}`,
  sport_type: 'Run',
  start_date: `${local}:00Z`,
  start_date_local: `${local}:00Z`,
  elapsed_time: 1830,
  moving_time: 1800,
  distance: 6000,
  average_heartrate: 150,
});
const strava = {
  activities: [
    activity(1, '2026-05-18T07:00'),
    activity(2, '2026-05-12T19:30'),
    // Outside the week either side of the 18th, though inside Strava's widened UTC window.
    activity(3, '2026-05-10T23:30'),
  ],
  calls: [] as string[],
  failWith: null as number | null,
  refreshFails: false,
  tokens: 0,
  expiresIn: 6 * 3600,
};
const fake: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  strava.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
  if (url.pathname === '/api/v3/oauth/token') {
    // Strava answers a revoked refresh token with 400, not 401.
    if (strava.refreshFails && String(init?.body).includes('grant_type=refresh_token'))
      return Response.json(
        { message: 'Bad Request', errors: [{ resource: 'RefreshToken', code: 'invalid' }] },
        { status: 400 },
      );
    strava.tokens += 1;
    return Response.json({
      access_token: `access-${strava.tokens}`,
      refresh_token: `refresh-${strava.tokens}`,
      expires_at: Math.floor(now.getTime() / 1000) + strava.expiresIn,
      athlete: { id: 777, firstname: 'Test', lastname: 'Runner' },
    });
  }
  if (url.pathname === '/oauth/revoke') return new Response(null, { status: 200 });
  if (strava.failWith) return new Response('{"message":"nope"}', { status: strava.failWith });
  if (url.pathname === '/api/v3/athlete/activities') return Response.json(strava.activities);
  const detail = /\/activities\/(\d+)$/.exec(url.pathname);
  const found = strava.activities.find((a) => String(a.id) === detail?.[1]);
  if (found) return Response.json({ ...found, laps: [{ elapsed_time: 300, distance: 1000 }] });
  return new Response('{}', { status: 404 });
};

async function connect(athleteId: string, scope = 'read,activity:read_all') {
  const { url } = startStravaConnection(athleteId, callback, now.getTime());
  const state = new URL(url).searchParams.get('state')!;
  return completeStravaConnection(athleteId, { code: 'code', state, scope }, now);
}
let lineage: string, other: string;

beforeAll(async () => {
  process.env.STRAVA_CLIENT_ID = '4242';
  process.env.STRAVA_CLIENT_SECRET = 'test-client-secret';
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  resetApiConfigForTests();
  useStravaFetch(fake);
  const workouts = await db
    .selectFrom('workouts')
    .innerJoin('plan_versions', 'plan_versions.id', 'workouts.plan_version_id')
    .select('workouts.lineage_id')
    .where('plan_versions.plan_id', '=', plan)
    .orderBy('workouts.scheduled_date')
    .limit(2)
    .execute();
  lineage = workouts[0]!.lineage_id;
  other = workouts[1]!.lineage_id;
});
afterAll(async () => {
  await disconnectStrava(owner);
  await closeDatabase();
});

it('connects only through the athlete’s own signed state, return address and activity scope', async () => {
  expect(() =>
    startStravaConnection(owner, 'https://example.com/connections/strava/callback'),
  ).toThrow('return address');
  const { url } = startStravaConnection(owner, callback, now.getTime());
  const state = new URL(url).searchParams.get('state')!;
  const stranger = (
    await db
      .insertInto('athletes')
      .values({ display_name: 'Someone else' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await expect(
    completeStravaConnection(stranger, { code: 'c', state, scope: 'activity:read_all' }, now),
  ).rejects.toMatchObject({ code: 'CONNECTION_EXPIRED' });
  // Unticking activity access is refused, and the half-made grant is revoked.
  await expect(connect(owner, 'read')).rejects.toMatchObject({ code: 'ACTIVITY_SCOPE_REQUIRED' });
  expect(strava.calls.at(-1)).toBe('POST /oauth/revoke');

  expect((await connect(owner)).strava).toMatchObject({
    available: true,
    connection: { status: 'active', displayName: 'Test Runner' },
  });
  // The same Strava account can't be claimed by a second Askesis athlete.
  await expect(connect(stranger)).rejects.toMatchObject({ code: 'STRAVA_ACCOUNT_IN_USE' });
  const stored = await db
    .selectFrom('integration_connections')
    .select(['access_token_ciphertext', 'refresh_token_ciphertext'])
    .where('athlete_id', '=', owner)
    .executeTakeFirstOrThrow();
  expect(stored.access_token_ciphertext).not.toContain('access-');
  expect(stored.refresh_token_ciphertext).not.toContain('refresh-');
});

it('reads activities live, by local day, without storing them', async () => {
  const list = await listStravaActivities(owner, '2026-05-18', now);
  expect(list).toMatchObject({ from: '2026-05-11', to: '2026-05-25' });
  expect(list.activities.map((a) => a.id)).toEqual(['1', '2']);
  const detail = await readStravaActivity(owner, '1', now);
  expect(detail).toMatchObject({
    averageHeartrate: 150,
    laps: [{ index: 1, distanceMetres: 1000 }],
  });
  await expect(readStravaActivity(owner, '99', now)).rejects.toMatchObject({
    code: 'ACTIVITY_NOT_FOUND',
  });
});

it('links one activity per workout, moves a re-linked activity and unlinks', async () => {
  await expect(linkActivity(owner, plan, lineage, '99', now)).rejects.toMatchObject({
    code: 'ACTIVITY_NOT_FOUND',
  });
  await expect(
    linkActivity(owner, plan, '00000000-0000-0000-0000-00000000dead', '1', now),
  ).rejects.toMatchObject({ code: 'WORKOUT_NOT_FOUND' });
  await linkActivity(owner, plan, lineage, '1', now);
  let { links } = await linkActivity(owner, plan, lineage, '2', now);
  expect(links).toEqual([
    expect.objectContaining({
      lineageId: lineage,
      activityId: '2',
      url: 'https://www.strava.com/activities/2',
    }),
  ]);
  // Linking the same activity to another workout moves it there.
  ({ links } = await linkActivity(owner, plan, other, '2', now));
  expect(links.map((l) => l.lineageId)).toEqual([other]);
  // Only the identifier is stored.
  const row = await db
    .selectFrom('workout_activity_links')
    .selectAll()
    .where('plan_id', '=', plan)
    .executeTakeFirstOrThrow();
  expect(Object.keys(row).sort()).toEqual([
    'athlete_id',
    'connection_id',
    'id',
    'linked_at',
    'plan_id',
    'provider_activity_id',
    'workout_lineage_id',
  ]);
  expect((await unlinkActivity(owner, plan, other)).links).toEqual([]);
});

it('keeps links owner-only', async () => {
  const stranger = (
    await db
      .insertInto('athletes')
      .values({ display_name: 'Nosy' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await expect(readActivityLinks(stranger, plan)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
  await expect(linkActivity(stranger, plan, lineage, '1', now)).rejects.toMatchObject({
    code: 'PLAN_NOT_FOUND',
  });
  await expect(listStravaActivities(stranger, '2026-05-18', now)).rejects.toMatchObject({
    code: 'STRAVA_NOT_CONNECTED',
  });
});

it('refreshes an expiring token once and marks a rejected grant for reconnection', async () => {
  await db
    .updateTable('integration_connections')
    .set({ access_token_expires_at: now })
    .where('athlete_id', '=', owner)
    .execute();
  const before = strava.tokens;
  await Promise.all([
    listStravaActivities(owner, '2026-05-18', now),
    readStravaActivity(owner, '1', now),
  ]);
  expect(strava.tokens).toBe(before + 1);

  strava.failWith = 401;
  await expect(readStravaActivity(owner, '1', now)).rejects.toMatchObject({
    code: 'STRAVA_REAUTHORIZATION_REQUIRED',
  });
  strava.failWith = null;
  expect((await readIntegrations(owner)).strava.connection?.status).toBe(
    'reauthorization_required',
  );
  await expect(listStravaActivities(owner, '2026-05-18', now)).rejects.toMatchObject({
    code: 'STRAVA_REAUTHORIZATION_REQUIRED',
  });
  // Reconnecting restores the connection.
  expect((await connect(owner)).strava.connection?.status).toBe('active');

  // A refresh token Strava no longer accepts also asks for reconnection, not a retry later.
  await db
    .updateTable('integration_connections')
    .set({ access_token_expires_at: now })
    .where('athlete_id', '=', owner)
    .execute();
  strava.refreshFails = true;
  await expect(readStravaActivity(owner, '1', now)).rejects.toMatchObject({
    code: 'STRAVA_REAUTHORIZATION_REQUIRED',
  });
  strava.refreshFails = false;
  expect((await readIntegrations(owner)).strava.connection?.status).toBe(
    'reauthorization_required',
  );
  expect((await connect(owner)).strava.connection?.status).toBe('active');
});

it('disconnecting revokes access and deletes the connection and its links', async () => {
  await linkActivity(owner, plan, lineage, '1', now);
  const state = await disconnectStrava(owner);
  expect(strava.calls.at(-1)).toBe('POST /oauth/revoke');
  expect(state.strava.connection).toBeNull();
  expect((await readActivityLinks(owner, plan)).links).toEqual([]);
});
