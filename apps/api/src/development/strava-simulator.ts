/**
 * A local stand-in for Strava's OAuth and activity API, for development and browser checks
 * without a Strava app. It invents a believable recent history from one locked plan: most past
 * sessions recorded on their day (one a day late, one missed), with laps and heart rate, plus a
 * walk and an extra run. Never runs in production.
 *
 *   pnpm strava:simulate [--plan <plan id>] [--port 4010]
 *
 * Point the API at it with STRAVA_OAUTH_BASE_URL=http://localhost:4010 and
 * STRAVA_API_BASE_URL=http://localhost:4010/api/v3 (any client id/secret works).
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parseArgs } from 'node:util';
import { sql } from 'kysely';
import { closeDatabase, getDatabase } from '../database/client.js';
import { localDate } from '../modules/athletes/timezone.js';

if (
  process.env.NODE_ENV === 'production' ||
  Object.keys(process.env).some((key) => key.startsWith('RAILWAY_'))
)
  throw new Error('The Strava simulator is for local development only.');

const { values } = parseArgs({
  options: { plan: { type: 'string' }, port: { type: 'string', default: '4010' } },
});
const port = Number(values.port);

type SimLap = {
  name: string;
  lap_index: number;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_speed: number;
  average_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
};
type SimActivity = {
  id: number;
  name: string;
  sport_type: string;
  workout_type: number | null;
  start_date: string;
  start_date_local: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  calories: number;
  description: string | null;
  device_name: string;
  trainer: boolean;
  manual: boolean;
  laps: SimLap[];
};

/** Sport type, lap length (metres), easy speed (m/s), cadence and watts for each discipline. */
const SPORTS = {
  run: { type: 'Run', lap: 1000, speed: 3.0, cadence: 84, watts: undefined },
  cycle: { type: 'Ride', lap: 5000, speed: 7.8, cadence: 88, watts: 165 },
  swim: { type: 'Swim', lap: 100, speed: 0.85, cadence: undefined, watts: undefined },
} as const;

const stableId = (seed: string) =>
  Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 10), 16);
/** A deterministic wobble in [-1, 1] so laps and heart rate look recorded, not computed. */
const wobble = (seed: string) =>
  (Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 6), 16) / 0xffffff) *
    2 -
  1;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function choosePlan() {
  const { rows } = await sql<{ id: string; owner_id: string; version_id: string; title: string }>`
    SELECT p.id, p.owner_id, p.current_locked_version_id AS version_id, p.display_name AS title
    FROM plans p
    WHERE p.current_locked_version_id IS NOT NULL AND p.archived_at IS NULL
      AND (${values.plan ?? null}::uuid IS NULL OR p.id = ${values.plan ?? null}::uuid)
    ORDER BY (p.activated_at IS NOT NULL) DESC, p.activated_at DESC NULLS LAST
    LIMIT 1`.execute(getDatabase());
  if (!rows[0]) throw new Error('No locked plan to simulate. Seed one with pnpm example:seed.');
  return rows[0];
}

function endurance(
  seed: string,
  name: string,
  sport: keyof typeof SPORTS,
  date: string,
  hour: number,
  seconds: number,
  effort: number,
): SimActivity {
  const meta = SPORTS[sport];
  const speed = meta.speed * (1 + effort * 0.12);
  const total = Math.round(seconds * speed);
  const laps: SimLap[] = [];
  for (let covered = 0; covered < total && laps.length < 60;) {
    const distance = Math.min(meta.lap, total - covered);
    const lapSpeed = speed * (1 + wobble(`${seed}:lap${laps.length}`) * 0.04);
    const time = Math.max(1, Math.round(distance / lapSpeed));
    laps.push({
      name: `Lap ${laps.length + 1}`,
      lap_index: laps.length + 1,
      elapsed_time: time + (sport === 'swim' ? 10 : 0),
      moving_time: time,
      distance,
      average_speed: Math.round(lapSpeed * 1000) / 1000,
      average_heartrate: Math.round(
        138 + effort * 22 + laps.length * 0.6 + wobble(`${seed}hr${laps.length}`) * 3,
      ),
      ...(meta.cadence ? { average_cadence: meta.cadence + Math.round(effort * 4) } : {}),
      ...(meta.watts ? { average_watts: Math.round(meta.watts * (1 + effort * 0.25)) } : {}),
    });
    covered += distance;
  }
  const moving = laps.reduce((sum, lap) => sum + lap.moving_time, 0);
  const elapsed = laps.reduce((sum, lap) => sum + lap.elapsed_time, 0) + 45;
  const heart = laps.map((lap) => lap.average_heartrate ?? 0);
  return {
    ...base(seed, name, meta.type, date, hour),
    elapsed_time: elapsed,
    moving_time: moving,
    distance: total,
    total_elevation_gain: sport === 'swim' ? 0 : Math.round((total / 1000) * 9),
    average_speed: Math.round((total / moving) * 1000) / 1000,
    max_speed: Math.round(speed * 1.3 * 1000) / 1000,
    average_heartrate: Math.round(heart.reduce((a, b) => a + b, 0) / heart.length),
    max_heartrate: Math.max(...heart) + 9,
    ...(meta.cadence ? { average_cadence: meta.cadence + Math.round(effort * 4) } : {}),
    ...(meta.watts ? { average_watts: Math.round(meta.watts * (1 + effort * 0.25)) } : {}),
    calories: Math.round((moving / 60) * (sport === 'cycle' ? 10 : 12)),
    trainer: sport === 'cycle' && wobble(seed) > 0,
    laps,
  };
}

function base(seed: string, name: string, type: string, date: string, hour: number) {
  const local = `${date}T${String(hour).padStart(2, '0')}:${String(Math.round((wobble(seed) + 1) * 20)).padStart(2, '0')}:00Z`;
  return {
    id: stableId(seed),
    name,
    sport_type: type,
    workout_type: null,
    start_date: new Date(Date.parse(local) - 3600_000).toISOString().replace('.000', ''),
    start_date_local: local,
    description:
      wobble(`${seed}:note`) > 0.3 ? 'Felt good today. Legs a bit heavy early on.' : null,
    device_name: type === 'Ride' ? 'Garmin Edge 840' : 'Garmin Forerunner 965',
    manual: false,
  };
}

async function simulate(): Promise<{ title: string; activities: SimActivity[] }> {
  const plan = await choosePlan();
  const db = getDatabase();
  const athlete = await db
    .selectFrom('athletes')
    .select('timezone')
    .where('id', '=', plan.owner_id)
    .executeTakeFirstOrThrow();
  const today = localDate(athlete.timezone);
  const workouts = await db
    .selectFrom('workouts')
    .select([
      'id',
      'title',
      'scheduled_date',
      'primary_discipline',
      'estimated_duration_seconds',
      'priority',
    ])
    .where('plan_version_id', '=', plan.version_id)
    .where('scheduled_date', '<=', sql<Date>`${today}::date`)
    .orderBy('scheduled_date')
    .orderBy('position')
    .execute();
  const activities: SimActivity[] = [];
  for (const [index, workout] of workouts.entries()) {
    const date = String(
      workout.scheduled_date instanceof Date
        ? workout.scheduled_date.toISOString()
        : workout.scheduled_date,
    ).slice(0, 10);
    // A repeating pattern: one in seven missed, one in five recorded a day late.
    if (index % 7 === 3) continue;
    const day = index % 5 === 2 && addDays(date, 1) <= today ? addDays(date, 1) : date;
    const planned = workout.estimated_duration_seconds ?? 2700;
    const seconds = Math.round(planned * (1 + wobble(`${workout.id}:time`) * 0.08));
    const effort = workout.priority === 'high' ? 0.6 : 0;
    const discipline = workout.primary_discipline;
    if (discipline === 'run' || discipline === 'cycle' || discipline === 'swim')
      activities.push(
        endurance(
          workout.id,
          stravaName(discipline, workout.title, day),
          discipline,
          day,
          7,
          seconds,
          effort,
        ),
      );
    else if (discipline === 'mixed') {
      activities.push(
        endurance(
          `${workout.id}:ride`,
          'Brick ride',
          'cycle',
          day,
          7,
          Math.round(seconds * 0.7),
          effort,
        ),
      );
      activities.push(
        endurance(
          `${workout.id}:run`,
          'Brick run',
          'run',
          day,
          9,
          Math.round(seconds * 0.3),
          effort,
        ),
      );
    } else
      activities.push({
        ...base(workout.id, 'Evening weight training', 'WeightTraining', day, 18),
        elapsed_time: seconds,
        moving_time: seconds,
        distance: 0,
        total_elevation_gain: 0,
        average_speed: 0,
        max_speed: 0,
        average_heartrate: 112,
        max_heartrate: 151,
        calories: Math.round((seconds / 60) * 6),
        trainer: false,
        laps: [],
      });
  }
  activities.push({
    ...endurance('extra-walk', 'Afternoon walk', 'run', addDays(today, -2), 15, 2400, -0.55),
    sport_type: 'Walk',
  });
  activities.push(
    endurance('extra-run', 'Lunch shakeout', 'run', addDays(today, -4), 12, 1500, -0.1),
  );
  return { title: plan.title, activities };
}

/** Strava names untitled activities after the time of day; most athletes never rename them. */
function stravaName(discipline: 'run' | 'cycle' | 'swim', title: string, date: string) {
  const noun = discipline === 'run' ? 'Run' : discipline === 'cycle' ? 'Ride' : 'Swim';
  return wobble(`${title}:${date}`) > 0.2 ? title : `Morning ${noun}`;
}

let usage = 0;
const send = (response: ServerResponse, status: number, body: unknown) => {
  usage += 1;
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'X-ReadRateLimit-Limit': '100,1000',
    'X-ReadRateLimit-Usage': `${usage % 100},${usage}`,
  });
  response.end(JSON.stringify(body));
};

async function readForm(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let tokens = 0;
let history: Promise<{ title: string; activities: SimActivity[] }> | undefined;

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://localhost:${port}`);
    if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
      const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
      const state = url.searchParams.get('state') ?? '';
      const allow = new URL(redirect);
      allow.search = new URLSearchParams({
        state,
        code: `sim-code-${Date.now()}`,
        scope: 'read,activity:read_all',
      }).toString();
      const deny = new URL(redirect);
      deny.search = new URLSearchParams({ state, error: 'access_denied' }).toString();
      const { title } = await (history ??= simulate());
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><meta name="viewport" content="width=device-width">
<title>Simulated Strava</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<p style="color:#FC5200;font-weight:700">Simulated Strava (local development)</p>
<h1>Authorize Askesis?</h1>
<p>Askesis would like to view data about your activities, including private ones.</p>
<p><small>History simulated from “${escape(title)}”.</small></p>
<p><a href="${escape(allow.toString())}">Authorize</a> · <a href="${escape(deny.toString())}">Cancel</a></p></body>`);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v3/oauth/token') {
      await readForm(request);
      tokens += 1;
      send(response, 200, {
        token_type: 'Bearer',
        access_token: `sim-access-${tokens}`,
        refresh_token: `sim-refresh-${tokens}`,
        expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
        expires_in: 6 * 3600,
        athlete: { id: 424242, firstname: 'Simulated', lastname: 'Athlete' },
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/revoke') {
      await readForm(request);
      response.writeHead(200).end();
      return;
    }
    if (!request.headers.authorization?.startsWith('Bearer sim-access-')) {
      send(response, 401, { message: 'Authorization Error' });
      return;
    }
    const { activities } = await (history ??= simulate());
    if (request.method === 'GET' && url.pathname === '/api/v3/athlete/activities') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
      const page = Number(url.searchParams.get('page') ?? 1);
      const perPage = Number(url.searchParams.get('per_page') ?? 30);
      const inWindow = activities.filter((a) => {
        const start = Date.parse(a.start_date) / 1000;
        return start > after && start < before;
      });
      send(
        response,
        200,
        inWindow
          .slice((page - 1) * perPage, page * perPage)
          .map(
            ({
              laps: _laps,
              description: _description,
              device_name: _device,
              calories: _calories,
              ...summary
            }) => summary,
          ),
      );
      return;
    }
    const detail = /^\/api\/v3\/activities\/(\d+)$/.exec(url.pathname);
    if (request.method === 'GET' && detail) {
      const activity = activities.find((a) => String(a.id) === detail[1]);
      if (!activity) send(response, 404, { message: 'Record Not Found' });
      else send(response, 200, activity);
      return;
    }
    send(response, 404, { message: 'Not Found' });
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Simulator request failed.');
    if (!response.headersSent) send(response, 500, { message: 'Simulator error' });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    JSON.stringify({
      simulator: `http://localhost:${port}`,
      env: {
        STRAVA_OAUTH_BASE_URL: `http://localhost:${port}`,
        STRAVA_API_BASE_URL: `http://localhost:${port}/api/v3`,
      },
    }),
  );
});
const stop = () => {
  server.close();
  void closeDatabase();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
