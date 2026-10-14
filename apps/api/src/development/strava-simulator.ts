/**
 * A local stand-in for Strava's OAuth and activity API, for development and browser checks
 * without a Strava app. It invents a believable training history for one active plan: most
 * sessions done as prescribed with interval laps, one moved a day, one cut short, one missed,
 * one rep ridden too easy, and a couple of extra activities. Never runs in production.
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
import { addDays } from '../modules/activities/activity.dates.js';
import { expandSegments, type Segment } from '../modules/activities/effort.analysis.js';
import { localDate } from '../modules/athletes/timezone.js';
import { getWorkoutDetail } from '../modules/workouts/workout.repository.js';
import type { WorkoutStep } from '../modules/workouts/workout.schemas.js';

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
  lap_index: number;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_speed: number;
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
  average_watts?: number;
  trainer: boolean;
  manual: boolean;
  laps: SimLap[];
};

const SPORT_TYPE: Record<string, string> = {
  run: 'Run',
  cycle: 'Ride',
  swim: 'Swim',
  strength: 'WeightTraining',
};
/** Easy-day defaults when a segment has no target band: speed (m/s) and watts. */
const EASY = {
  run: { speed: 2.9, watts: 0 },
  cycle: { speed: 7.5, watts: 150 },
  swim: { speed: 0.8, watts: 0 },
};

const stableId = (seed: string) =>
  Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 10), 16);

async function choosePlan() {
  const { rows } = await sql<{
    id: string;
    owner_id: string;
    version_id: string;
    title: string;
    sports: number;
  }>`
    SELECT p.id, p.owner_id, p.current_locked_version_id AS version_id, p.display_name AS title,
      (SELECT count(DISTINCT primary_discipline) FROM workouts w
        WHERE w.plan_version_id = p.current_locked_version_id)::int AS sports
    FROM plans p
    WHERE p.current_locked_version_id IS NOT NULL AND p.archived_at IS NULL
      AND (${values.plan ?? null}::uuid IS NULL OR p.id = ${values.plan ?? null}::uuid)
    ORDER BY (p.activated_at IS NOT NULL) DESC, sports DESC, p.activated_at DESC NULLS LAST
    LIMIT 1`.execute(getDatabase());
  if (!rows[0]) throw new Error('No locked plan to simulate. Seed one with pnpm example:seed.');
  return rows[0];
}

/** Laps a watch would record for the segments, at each band's middle unless told otherwise. */
function lapsFor(segments: Segment[], sport: 'run' | 'cycle' | 'swim', slowRep: number | null) {
  let workIndex = 0;
  return segments.map((segment, index): SimLap => {
    const isWork = segment.role === 'work';
    if (isWork) workIndex += 1;
    const rest = segment.role === 'recovery' && sport === 'swim';
    let speed =
      segment.role === 'recovery' || segment.role === 'transition'
        ? EASY[sport].speed * 0.8
        : EASY[sport].speed;
    let watts = segment.role === 'recovery' ? EASY.cycle.watts * 0.8 : EASY.cycle.watts;
    if (segment.band) {
      const middle = (segment.band.low + segment.band.high) / 2;
      const value = isWork && workIndex === slowRep ? segment.band.low * 0.9 : middle;
      if (segment.band.metric === 'speed') speed = value;
      else watts = value;
    }
    if (sport === 'cycle' && !segment.band) speed = segment.role === 'work' ? 8.5 : 7.2;
    const seconds = Math.round(
      segment.measure === 'distance' && segment.amount
        ? segment.amount / speed
        : (segment.amount ?? 60),
    );
    const metres = rest ? 0 : Math.round(seconds * speed * 10) / 10;
    return {
      lap_index: index + 1,
      elapsed_time: seconds,
      moving_time: rest ? 0 : seconds,
      distance: metres,
      average_speed: rest ? 0 : speed,
      ...(sport === 'cycle' ? { average_watts: Math.round(watts) } : {}),
    };
  });
}

/** Kilometre auto-laps for a steady run (or one whose only efforts are short strides). */
function autoLaps(seconds: number, speed: number): SimLap[] {
  const laps: SimLap[] = [];
  let remaining = seconds * speed;
  while (remaining > 0) {
    const distance = Math.min(1000, remaining);
    const time = Math.round(distance / speed);
    laps.push({
      lap_index: laps.length + 1,
      elapsed_time: time,
      moving_time: time,
      distance: Math.round(distance * 10) / 10,
      average_speed: speed,
    });
    remaining -= distance;
  }
  return laps;
}

function activityFrom(
  seed: string,
  name: string,
  sportType: string,
  date: string,
  laps: SimLap[],
  options: { elapsed?: number; trainer?: boolean } = {},
): SimActivity {
  const elapsed = options.elapsed ?? laps.reduce((sum, lap) => sum + lap.elapsed_time, 0);
  const moving = laps.length ? laps.reduce((sum, lap) => sum + lap.moving_time, 0) : elapsed;
  const distance = laps.reduce((sum, lap) => sum + lap.distance, 0);
  const powered = laps.filter((lap) => lap.average_watts !== undefined);
  const wattTime = powered.reduce((sum, lap) => sum + lap.elapsed_time, 0);
  const start = `${date}T07:00:00Z`;
  return {
    id: stableId(seed),
    name,
    sport_type: sportType,
    workout_type: null,
    start_date: start,
    start_date_local: start,
    elapsed_time: elapsed,
    moving_time: moving,
    distance: Math.round(distance * 10) / 10,
    total_elevation_gain: sportType === 'Run' || sportType === 'Ride' ? 42 : 0,
    average_speed: moving ? distance / moving : 0,
    ...(wattTime
      ? {
          average_watts: Math.round(
            powered.reduce((sum, lap) => sum + lap.average_watts! * lap.elapsed_time, 0) / wattTime,
          ),
        }
      : {}),
    trainer: options.trainer ?? false,
    manual: false,
    laps,
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
    .select(['id', 'title', 'scheduled_date', 'primary_discipline', 'estimated_duration_seconds'])
    .where('plan_version_id', '=', plan.version_id)
    .where('scheduled_date', '<', sql<Date>`${today}::date`)
    .orderBy('scheduled_date')
    .orderBy('position')
    .execute();
  const activities: SimActivity[] = [];
  let structured = 0;
  for (const [index, workout] of workouts.entries()) {
    const date = String(workout.scheduled_date).slice(0, 10);
    // A repeating pattern: missed, moved a day later, cut short; otherwise done as planned.
    const fate =
      index % 9 === 4 ? 'missed' : index % 9 === 2 ? 'moved' : index % 9 === 6 ? 'short' : 'done';
    if (fate === 'missed') continue;
    const day = fate === 'moved' && addDays(date, 1) < today ? addDays(date, 1) : date;
    const detail = (await getWorkoutDetail(plan.owner_id, workout.id, { canonicalUnits: true }))!;
    const sports = new Set(
      collect(detail.prescription).filter((s) => ['run', 'cycle', 'swim'].includes(s)),
    );
    const endurance =
      workout.primary_discipline === 'mixed'
        ? [...sports]
        : ['run', 'cycle', 'swim'].includes(workout.primary_discipline)
          ? [workout.primary_discipline]
          : [];
    if (!endurance.length) {
      // Strength and gym circuits: one timed session.
      const planned = workout.estimated_duration_seconds ?? 2700;
      activities.push(
        activityFrom(
          workout.id,
          workout.title,
          workout.primary_discipline === 'mixed'
            ? 'HighIntensityIntervalTraining'
            : 'WeightTraining',
          day,
          [],
          { elapsed: Math.round(planned * (fate === 'short' ? 0.6 : 1.02)) },
        ),
      );
      continue;
    }
    const hasReps = (s: WorkoutStep): boolean => s.kind === 'repeat' || s.steps.some(hasReps);
    if (hasReps(detail.prescription)) structured += 1;
    for (const sport of endurance as ('run' | 'cycle' | 'swim')[]) {
      let segments = expandSegments(detail.prescription, sport).filter(
        (s) =>
          !(
            s.role === 'transition' ||
            (sport !== 'swim' && s.role === 'recovery' && s.label.startsWith('Walk'))
          ),
      );
      // Cut short: the session stops a little over half way through.
      if (fate === 'short' && segments.length > 3)
        segments = segments.slice(0, Math.ceil(segments.length * 0.55));
      const shortReps = segments
        .filter((s) => s.role === 'work')
        .every((s) => s.measure === 'duration' && (s.amount ?? 0) < 60);
      // The second structured session has its last rep a little too easy.
      const work = segments.filter((s) => s.role === 'work').length;
      const steady = sport === 'run' && (shortReps || !work);
      const laps = steady
        ? autoLaps(
            segments.reduce((sum, s) => sum + (s.measure === 'duration' ? (s.amount ?? 0) : 0), 0) *
              (fate === 'short' ? 0.65 : 1),
            EASY.run.speed,
          )
        : lapsFor(segments, sport, structured === 2 && work ? work : null);
      activities.push(
        activityFrom(
          `${workout.id}:${sport}`,
          endurance.length > 1 ? `${workout.title} (${sport})` : workout.title,
          SPORT_TYPE[sport]!,
          day,
          laps,
          { trainer: sport === 'cycle' && index % 2 === 0 },
        ),
      );
    }
  }
  // Life outside the plan: a walk, and an extra easy run in the plan's first week.
  const first = workouts[0] ? String(workouts[0].scheduled_date).slice(0, 10) : addDays(today, -7);
  activities.push(
    activityFrom('extra-walk', 'Afternoon walk', 'Walk', addDays(first, 2), autoLaps(2400, 1.4)),
  );
  activities.push(
    activityFrom('extra-run', 'Shakeout run', 'Run', addDays(first, 5), autoLaps(1500, 2.8)),
  );
  activities.push(
    activityFrom('before-plan', 'Parkrun', 'Run', addDays(first, -3), autoLaps(1500, 3.6)),
  );
  return { title: plan.title, activities };
}

function collect(step: WorkoutStep): string[] {
  return [...(step.discipline ? [step.discipline] : []), ...step.steps.flatMap(collect)];
}

let usage = 0;
const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  usage += 1;
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'X-ReadRateLimit-Limit': '100,1000',
    'X-ReadRateLimit-Usage': `${usage % 100},${usage}`,
    ...headers,
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
          .map(({ laps: _laps, ...summary }) => summary),
      );
      return;
    }
    const laps = /^\/api\/v3\/activities\/(\d+)\/laps$/.exec(url.pathname);
    if (request.method === 'GET' && laps) {
      const activity = activities.find((a) => String(a.id) === laps[1]);
      if (!activity) send(response, 404, { message: 'Record Not Found' });
      else send(response, 200, activity.laps);
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
