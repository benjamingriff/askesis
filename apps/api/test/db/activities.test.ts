import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { resetApiConfigForTests } from '../../src/config.js';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import {
  decideActivityLink,
  readAdherence,
  readWorkoutActual,
} from '../../src/modules/activities/adherence.service.js';
import {
  completeStravaConnection,
  disconnectStrava,
  purgeExpiredActivities,
  readIntegrations,
  startStravaConnection,
  syncStrava,
  useStravaFetch,
} from '../../src/modules/activities/integration.service.js';

const owner = '00000000-0000-0000-0000-000000000001';
const version = '00000000-0000-0000-0000-000000000050';
const workout = (n: number) => `10000000-0000-0000-0000-000000000${n}`;
const now = new Date('2026-05-20T18:00:00Z');
const callback = 'http://localhost:5173/connections/strava/callback';
const db = getDatabase();

type Fake = {
  id: number;
  sport_type: string;
  date: string;
  seconds: number;
  metres: number;
  laps?: { elapsed_time: number; distance: number; average_speed: number }[];
};
const strava = {
  activities: [] as Fake[],
  calls: [] as string[],
  failWith: null as number | null,
  tokens: 0,
  athleteId: 777,
};
function summary(a: Fake) {
  return {
    id: a.id,
    name: `${a.sport_type} on ${a.date}`,
    sport_type: a.sport_type,
    start_date: `${a.date}T06:00:00Z`,
    start_date_local: `${a.date}T07:00:00Z`,
    elapsed_time: a.seconds + 30,
    moving_time: a.seconds,
    distance: a.metres,
    average_speed: a.metres / a.seconds,
  };
}
const fake: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  strava.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
  if (url.pathname === '/api/v3/oauth/token') {
    strava.tokens += 1;
    return Response.json({
      access_token: `access-${strava.tokens}`,
      refresh_token: `refresh-${strava.tokens}`,
      expires_at: Math.floor(now.getTime() / 1000) + 6 * 3600,
      athlete: { id: strava.athleteId, firstname: 'Test', lastname: 'Runner' },
    });
  }
  if (url.pathname === '/oauth/revoke') return new Response(null, { status: 200 });
  if (strava.failWith) return new Response('{"message":"nope"}', { status: strava.failWith });
  if (url.pathname === '/api/v3/athlete/activities') {
    const after = Number(url.searchParams.get('after'));
    const page = Number(url.searchParams.get('page'));
    const perPage = Number(url.searchParams.get('per_page'));
    const listed = strava.activities.filter(
      (a) => Date.parse(`${a.date}T06:00:00Z`) / 1000 > after,
    );
    return Response.json(listed.slice((page - 1) * perPage, page * perPage).map(summary));
  }
  const laps = /\/activities\/(\d+)\/laps$/.exec(url.pathname);
  if (laps) {
    const activity = strava.activities.find((a) => String(a.id) === laps[1]);
    return Response.json(activity?.laps ?? []);
  }
  return new Response(null, { status: 404 });
};

async function connect(athleteId: string, scope = 'read,activity:read_all') {
  const { url } = startStravaConnection(athleteId, callback, now.getTime());
  const state = new URL(url).searchParams.get('state')!;
  return completeStravaConnection(athleteId, { code: 'code', state, scope }, now);
}
const statuses = async () =>
  Object.fromEntries(
    (await readAdherence(owner, version, now)).workouts.map((w) => [
      w.workoutId.slice(-3),
      w.status,
    ]),
  );
const activityId = async (sourceId: number) =>
  (
    await db
      .selectFrom('activities')
      .select('id')
      .where('source_activity_id', '=', String(sourceId))
      .executeTakeFirstOrThrow()
  ).id;

beforeAll(() => {
  process.env.STRAVA_CLIENT_ID = '4242';
  process.env.STRAVA_CLIENT_SECRET = 'test-client-secret';
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  resetApiConfigForTests();
  useStravaFetch(fake);
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
  const other = (
    await db
      .insertInto('athletes')
      .values({ display_name: 'Someone else' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await expect(
    completeStravaConnection(other, { code: 'c', state, scope: 'activity:read_all' }, now),
  ).rejects.toMatchObject({ code: 'CONNECTION_EXPIRED' });
  // Unticking activity access is refused, and the half-made grant is revoked.
  await expect(connect(owner, 'read')).rejects.toMatchObject({ code: 'ACTIVITY_SCOPE_REQUIRED' });
  expect(strava.calls.at(-1)).toBe('POST /oauth/revoke');

  const state2 = await connect(owner);
  expect(state2.strava).toMatchObject({
    available: true,
    connection: { status: 'active', displayName: 'Test Runner', activityCount: 0 },
  });
  const stored = await db
    .selectFrom('integration_connections')
    .selectAll()
    .where('athlete_id', '=', owner)
    .executeTakeFirstOrThrow();
  expect(stored.access_token_ciphertext).not.toContain('access-');
  expect(stored.refresh_token_ciphertext).not.toContain('refresh-');
  // One Strava account belongs to one Askesis athlete.
  await expect(connect(other)).rejects.toMatchObject({ code: 'STRAVA_ACCOUNT_IN_USE' });
});

it('syncs activities, matches them to the plan and keeps the athlete’s decisions', async () => {
  strava.activities = [
    {
      id: 1,
      sport_type: 'Run',
      date: '2026-05-11',
      seconds: 2420,
      metres: 6600,
      laps: [
        { elapsed_time: 1200, distance: 3300, average_speed: 2.75 },
        { elapsed_time: 1220, distance: 3300, average_speed: 2.7 },
      ],
    },
    { id: 2, sport_type: 'Run', date: '2026-05-12', seconds: 900, metres: 2750 },
    { id: 3, sport_type: 'Run', date: '2026-05-13', seconds: 3300, metres: 9400 },
    { id: 4, sport_type: 'Walk', date: '2026-05-15', seconds: 3600, metres: 5000 },
    { id: 5, sport_type: 'Run', date: '2026-05-17', seconds: 3900, metres: 12000 },
  ];
  const result = await syncStrava(owner, now);
  expect(result).toMatchObject({ imported: 5, updated: 0, removed: 0 });
  // Laps only for runs near a workout with repeats (the strides and hill sessions).
  expect(result.lapsFetched).toBeGreaterThan(0);
  expect(await statuses()).toMatchObject({
    '101': 'completed',
    '102': 'partial',
    '103': 'completed',
    '104': 'missed',
    // Saturday's long run, done on Sunday.
    '105': 'completed',
    '201': 'missed',
    '203': 'planned',
  });
  const adherence = await readAdherence(owner, version, now);
  expect(adherence.workouts.find((w) => w.workoutId === workout(105))).toMatchObject({
    dayOffset: 1,
    matchedBy: 'auto',
  });
  const walk = await activityId(4);
  expect(adherence.extra).toEqual([
    { activityId: walk, countsTowardPlan: false, seconds: 3630, metres: 5000 },
  ]);
  expect(adherence.weeks[0]).toMatchObject({ completed: 3, partial: 1, missed: 1, extra: 1 });

  const actual = await readWorkoutActual(owner, workout(101), now);
  expect(actual.activities[0]).toMatchObject({ lapsPending: false, lapCount: 2 });
  expect(actual.activities[0]!.sourceUrl).toBe('https://www.strava.com/activities/1');

  // "That Sunday run was Friday's session."
  const sunday = await activityId(5);
  await decideActivityLink(owner, workout(105), { activityId: sunday, decision: 'reject' }, now);
  const linked = await decideActivityLink(
    owner,
    workout(104),
    { activityId: sunday, decision: 'link' },
    now,
  );
  expect(linked.outcome).toMatchObject({ status: 'completed', matchedBy: 'manual', dayOffset: 2 });
  expect(await statuses()).toMatchObject({ '104': 'completed', '105': 'missed' });
  // Twelve days apart is a different session.
  await expect(
    decideActivityLink(
      owner,
      workout(205),
      { activityId: await activityId(1), decision: 'link' },
      now,
    ),
  ).rejects.toMatchObject({ code: 'OUTSIDE_LINK_WINDOW' });

  // Deleted on Strava: gone here at the next sync. Decisions about other activities remain.
  strava.activities = strava.activities.filter((a) => a.id !== 2);
  expect(await syncStrava(owner, now)).toMatchObject({ imported: 0, updated: 4, removed: 1 });
  expect(await statuses()).toMatchObject({ '102': 'missed', '104': 'completed', '105': 'missed' });
});

it('fetches laps for an interval session the athlete linked from further away', async () => {
  // Five days before the strides session: too far for automatic matching or lap fetching.
  strava.activities.push({
    id: 6,
    sport_type: 'Run',
    date: '2026-05-06',
    seconds: 2400,
    metres: 6500,
    laps: [
      { elapsed_time: 900, distance: 2500, average_speed: 2.78 },
      { elapsed_time: 900, distance: 2500, average_speed: 2.78 },
      { elapsed_time: 600, distance: 1500, average_speed: 2.5 },
    ],
  });
  await syncStrava(owner, now);
  const early = await activityId(6);
  let actual = await decideActivityLink(
    owner,
    workout(101),
    { activityId: early, decision: 'link' },
    now,
  );
  expect(actual.activities[0]).toMatchObject({ id: early, lapsPending: true, lapCount: 0 });
  await syncStrava(owner, now);
  actual = await readWorkoutActual(owner, workout(101), now);
  expect(actual.activities[0]).toMatchObject({ id: early, lapsPending: false, lapCount: 3 });
  // Undo: the workout goes back to its own day's run.
  await decideActivityLink(owner, workout(101), { activityId: early, decision: 'reject' }, now);
  strava.activities = strava.activities.filter((a) => a.id !== 6);
  expect(await syncStrava(owner, now)).toMatchObject({ removed: 1 });
  expect(await statuses()).toMatchObject({ '101': 'completed' });
});

it('refreshes tokens, records failures and holds one sync at a time', async () => {
  await db
    .updateTable('integration_connections')
    .set({ access_token_expires_at: new Date(now.getTime() - 1000) })
    .where('athlete_id', '=', owner)
    .execute();
  strava.calls = [];
  await syncStrava(owner, now);
  expect(strava.calls[0]).toBe('POST /api/v3/oauth/token');

  await db
    .updateTable('integration_connections')
    .set({ sync_started_at: now })
    .where('athlete_id', '=', owner)
    .execute();
  await expect(syncStrava(owner, now)).rejects.toMatchObject({ code: 'SYNC_IN_PROGRESS' });
  await db
    .updateTable('integration_connections')
    .set({ sync_started_at: null })
    .where('athlete_id', '=', owner)
    .execute();

  strava.failWith = 401;
  await expect(syncStrava(owner, now)).rejects.toMatchObject({
    code: 'STRAVA_REAUTHORIZATION_REQUIRED',
  });
  strava.failWith = null;
  expect((await readIntegrations(owner, now)).strava.connection).toMatchObject({
    status: 'reauthorization_required',
    lastSyncError: 'STRAVA_REAUTHORIZATION_REQUIRED',
    syncing: false,
  });
  // Reconnecting the same account restores it without losing decisions.
  await connect(owner);
  expect((await readIntegrations(owner, now)).strava.connection?.status).toBe('active');
});

it('expires the cache after seven days and deletes everything on disconnect', async () => {
  await syncStrava(owner, now);
  const count = async () =>
    Number(
      (
        await db
          .selectFrom('activities')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('athlete_id', '=', owner)
          .executeTakeFirstOrThrow()
      ).n,
    );
  expect(await count()).toBe(4);
  await purgeExpiredActivities(new Date(now.getTime() + 6 * 86_400_000));
  expect(await count()).toBe(4);
  await purgeExpiredActivities(new Date(now.getTime() + 8 * 86_400_000));
  expect(await count()).toBe(0);
  // The athlete's link outlives the cache and applies again once the activity returns.
  await syncStrava(owner, now);
  expect(await statuses()).toMatchObject({ '104': 'completed', '105': 'missed' });

  strava.calls = [];
  const state = await disconnectStrava(owner);
  expect(state.strava.connection).toBeNull();
  expect(strava.calls).toEqual(['POST /oauth/revoke']);
  expect(await count()).toBe(0);
  const overrides = await db
    .selectFrom('activity_match_overrides')
    .select('id')
    .where('athlete_id', '=', owner)
    .execute();
  expect(overrides).toEqual([]);
});
