import { sql, type Selectable } from 'kysely';
import { getDatabase } from '../../database/client.js';
import type { Activities } from '../../database/generated.js';
import { localDate } from '../athletes/timezone.js';
import { getWorkoutDetail } from '../workouts/workout.repository.js';
import { addDays } from './activity.dates.js';
import {
  accepts,
  daysBetween,
  MANUAL_WINDOW_DAYS,
  pairScore,
  reconcile,
  slotsFor,
  type PlannedWorkout,
  type RecordedActivity,
} from './activity.matching.js';
import {
  AdherenceSchema,
  WorkoutActualSchema,
  type Activity,
  type Adherence,
  type WorkoutActual,
} from './activity.schemas.js';
import { analyzeEfforts } from './effort.analysis.js';
import { IntegrationError } from './integration.service.js';
import type { ActivitySport } from './strava.mapping.js';

const day = (value: unknown) => String(value).slice(0, 10);
const optional = (value: string | null) => (value === null ? null : Number(value));

function toActivity(row: Selectable<Activities>): Activity {
  return {
    id: row.id,
    source: 'strava',
    sourceUrl: `https://www.strava.com/activities/${encodeURIComponent(row.source_activity_id)}`,
    name: row.name,
    sport: row.sport as ActivitySport,
    sourceSportType: row.source_sport_type,
    date: day(row.local_date),
    startedAt: new Date(row.started_at).toISOString(),
    elapsedSeconds: row.elapsed_seconds,
    movingSeconds: row.moving_seconds,
    distanceMetres: optional(row.distance_metres),
    elevationGainMetres: optional(row.elevation_gain_metres),
    averageSpeed: optional(row.average_speed_mps),
    averageWatts: optional(row.average_watts),
    trainer: row.trainer,
    manual: row.manual,
    race: row.race,
  };
}

const toRecorded = (row: Selectable<Activities>): RecordedActivity => ({
  id: row.id,
  connectionId: row.connection_id,
  sourceActivityId: row.source_activity_id,
  sport: row.sport as ActivitySport,
  date: day(row.local_date),
  elapsedSeconds: row.elapsed_seconds,
  movingSeconds: row.moving_seconds,
  distanceMetres: optional(row.distance_metres),
});

/** Everything reconciliation needs for one version the athlete owns. */
async function loadVersion(athleteId: string, planVersionId: string, now: Date) {
  const db = getDatabase();
  const version = await db
    .selectFrom('plan_versions as v')
    .innerJoin('plans as p', 'p.id', 'v.plan_id')
    .innerJoin('athletes as a', 'a.id', 'p.owner_id')
    .select(['v.id', 'v.plan_id', 'v.start_date', 'v.end_date', 'a.timezone'])
    .where('v.id', '=', planVersionId)
    .where('p.owner_id', '=', athleteId)
    .executeTakeFirst();
  if (!version)
    throw new IntegrationError('PLAN_VERSION_NOT_FOUND', 'Plan version not found.', 404);
  const [workoutRows, disciplines, weeks, overrides, connection] = await Promise.all([
    db
      .selectFrom('workouts as w')
      .innerJoin('training_weeks as t', 't.id', 'w.week_id')
      .select([
        'w.id',
        'w.lineage_id',
        'w.scheduled_date',
        'w.primary_discipline',
        'w.estimated_duration_seconds',
        'w.estimated_distance_metres',
        't.week_number',
      ])
      .where('w.plan_version_id', '=', planVersionId)
      .orderBy('w.scheduled_date')
      .orderBy('w.position')
      .execute(),
    db
      .selectFrom('workout_steps')
      .select(['workout_id', 'discipline'])
      .distinct()
      .where('plan_version_id', '=', planVersionId)
      .where('kind', '=', 'effort')
      .where('discipline', 'is not', null)
      .execute(),
    db
      .selectFrom('training_weeks')
      .select(['week_number', 'start_date', 'end_date'])
      .where('plan_version_id', '=', planVersionId)
      .orderBy('start_date')
      .execute(),
    db
      .selectFrom('activity_match_overrides')
      .select(['workout_lineage_id', 'connection_id', 'source_activity_id', 'decision'])
      .where('plan_id', '=', version.plan_id)
      .where('athlete_id', '=', athleteId)
      .orderBy('decided_at', 'desc')
      .execute(),
    db
      .selectFrom('integration_connections')
      .select(['last_synced_at'])
      .where('athlete_id', '=', athleteId)
      .executeTakeFirst(),
  ]);
  const workouts: PlannedWorkout[] = workoutRows.map((row) => ({
    id: row.id,
    lineageId: row.lineage_id,
    date: day(row.scheduled_date),
    weekNumber: row.week_number,
    sport: row.primary_discipline,
    slots: slotsFor(
      row.primary_discipline,
      disciplines.filter((d) => d.workout_id === row.id).map((d) => d.discipline!),
    ),
    durationSeconds: row.estimated_duration_seconds,
    distanceMetres: optional(row.estimated_distance_metres),
  }));
  const startDate = version.start_date ? day(version.start_date) : (workouts[0]?.date ?? null);
  const endDate = version.end_date ? day(version.end_date) : (workouts.at(-1)?.date ?? null);
  const activityRows =
    startDate && endDate
      ? await db
          .selectFrom('activities')
          .selectAll()
          .where('athlete_id', '=', athleteId)
          .where('local_date', '>=', sql<Date>`${addDays(startDate, -MANUAL_WINDOW_DAYS)}::date`)
          .where('local_date', '<=', sql<Date>`${addDays(endDate, MANUAL_WINDOW_DAYS)}::date`)
          .orderBy('started_at')
          .execute()
      : [];
  const today = localDate(version.timezone, now);
  const result = reconcile({
    workouts,
    activities: activityRows.map(toRecorded),
    overrides: overrides.map((o) => ({
      workoutLineageId: o.workout_lineage_id,
      connectionId: o.connection_id,
      sourceActivityId: o.source_activity_id,
      decision: o.decision as 'link' | 'reject',
    })),
    weeks: weeks.map((w) => ({
      weekNumber: w.week_number,
      startDate: day(w.start_date),
      endDate: day(w.end_date),
    })),
    startDate,
    endDate,
    today,
  });
  return { version, workouts, weeks, activityRows, result, today, connection };
}

export async function readAdherence(
  athleteId: string,
  planVersionId: string,
  now = new Date(),
): Promise<Adherence> {
  const { activityRows, result, today, connection } = await loadVersion(
    athleteId,
    planVersionId,
    now,
  );
  const shown = new Set([
    ...result.workouts.flatMap((w) => w.activityIds),
    ...result.extra.map((e) => e.activityId),
  ]);
  return AdherenceSchema.parse({
    planVersionId,
    today,
    connected: !!connection,
    lastSyncedAt: connection?.last_synced_at
      ? new Date(connection.last_synced_at).toISOString()
      : null,
    workouts: result.workouts,
    activities: activityRows.filter((row) => shown.has(row.id)).map(toActivity),
    extra: result.extra,
    weeks: result.weeks,
    toDate: result.toDate,
  });
}

async function workoutRow(athleteId: string, workoutId: string) {
  const row = await getDatabase()
    .selectFrom('workouts as w')
    .innerJoin('plan_versions as v', 'v.id', 'w.plan_version_id')
    .innerJoin('plans as p', 'p.id', 'v.plan_id')
    .select(['w.id', 'w.lineage_id', 'w.plan_version_id', 'w.scheduled_date', 'v.plan_id'])
    .where('w.id', '=', workoutId)
    .where('p.owner_id', '=', athleteId)
    .executeTakeFirst();
  if (!row) throw new IntegrationError('WORKOUT_NOT_FOUND', 'Workout not found.', 404);
  return row;
}

const DISCIPLINE: Partial<Record<ActivitySport, string>> = {
  run: 'run',
  cycle: 'cycle',
  swim: 'swim',
};

export async function readWorkoutActual(
  athleteId: string,
  workoutId: string,
  now = new Date(),
): Promise<WorkoutActual> {
  const workout = await workoutRow(athleteId, workoutId);
  const { workouts, weeks, activityRows, result, connection } = await loadVersion(
    athleteId,
    workout.plan_version_id,
    now,
  );
  const outcome = result.workouts.find((w) => w.workoutId === workoutId)!;
  const linked = activityRows.filter((row) => outcome.activityIds.includes(row.id));
  const laps = linked.length
    ? await getDatabase()
        .selectFrom('activity_laps')
        .selectAll()
        .where(
          'activity_id',
          'in',
          linked.map((row) => row.id),
        )
        .orderBy('lap_index')
        .execute()
    : [];
  // Paces are compared per kilometre whatever the plan displays.
  const detail = linked.some((row) => DISCIPLINE[row.sport as ActivitySport])
    ? await getWorkoutDetail(athleteId, workoutId, { canonicalUnits: true })
    : null;
  const date = day(workout.scheduled_date);
  const planned = workouts.find((w) => w.id === workoutId)!;
  const linkedTo = new Map(
    result.workouts.flatMap((w) => w.activityIds.map((id) => [id, w.workoutId] as const)),
  );
  const planWeeks = weeks.map((w) => ({
    weekNumber: w.week_number,
    startDate: day(w.start_date),
    endDate: day(w.end_date),
  }));
  const candidates = activityRows
    .filter(
      (row) =>
        !outcome.activityIds.includes(row.id) &&
        Math.abs(daysBetween(date, day(row.local_date))) <= MANUAL_WINDOW_DAYS,
    )
    .map((row) => ({
      row,
      // The session's own sport first, then activities nothing else claimed, then the nearest.
      fits: planned.slots.some((slot) => accepts(slot, row.sport as ActivitySport)) ? 0 : 1,
      claimed: linkedTo.has(row.id) ? 1 : 0,
      distance: Math.abs(daysBetween(date, day(row.local_date))),
      score: pairScore(planned, toRecorded(row), planWeeks) ?? 0,
    }))
    .sort(
      (a, b) =>
        a.fits - b.fits || a.claimed - b.claimed || a.distance - b.distance || b.score - a.score,
    )
    .map(({ row }) => ({ ...toActivity(row), linkedWorkoutId: linkedTo.get(row.id) ?? null }));
  return WorkoutActualSchema.parse({
    workoutId,
    connected: !!connection,
    outcome,
    activities: linked.map((row) => {
      const own = laps.filter((lap) => lap.activity_id === row.id);
      const discipline = DISCIPLINE[row.sport as ActivitySport];
      return {
        ...toActivity(row),
        lapsSynced: row.laps_fetched_at !== null,
        lapCount: own.length,
        efforts:
          detail && discipline && row.laps_fetched_at !== null
            ? analyzeEfforts(
                detail.prescription,
                discipline,
                own.map((lap) => ({
                  elapsedSeconds: lap.elapsed_seconds,
                  movingSeconds: lap.moving_seconds,
                  distanceMetres: optional(lap.distance_metres),
                  averageSpeed: optional(lap.average_speed_mps),
                  averageWatts: optional(lap.average_watts),
                })),
              )
            : null,
      };
    }),
    candidates,
  });
}

/**
 * Record the athlete's decision about one activity and one workout. Linking moves the
 * activity to this workout (from any other in the plan); rejecting stops it being suggested
 * here again. Both survive plan edits through the workout's lineage.
 */
export async function decideActivityLink(
  athleteId: string,
  workoutId: string,
  input: { activityId: string; decision: 'link' | 'reject' },
  now = new Date(),
): Promise<WorkoutActual> {
  const workout = await workoutRow(athleteId, workoutId);
  const db = getDatabase();
  const activity = await db
    .selectFrom('activities')
    .select(['connection_id', 'source_activity_id', 'local_date'])
    .where('id', '=', input.activityId)
    .where('athlete_id', '=', athleteId)
    .executeTakeFirst();
  if (!activity) throw new IntegrationError('ACTIVITY_NOT_FOUND', 'Activity not found.', 404);
  if (
    input.decision === 'link' &&
    Math.abs(daysBetween(day(workout.scheduled_date), day(activity.local_date))) >
      MANUAL_WINDOW_DAYS
  )
    throw new IntegrationError(
      'OUTSIDE_LINK_WINDOW',
      `Activities can be linked to workouts up to ${MANUAL_WINDOW_DAYS} days apart.`,
      422,
    );
  const sameActivity = {
    connection_id: activity.connection_id,
    source_activity_id: activity.source_activity_id,
  };
  await db.transaction().execute(async (tx) => {
    let clear = tx
      .deleteFrom('activity_match_overrides')
      .where('plan_id', '=', workout.plan_id)
      .where('connection_id', '=', sameActivity.connection_id)
      .where('source_activity_id', '=', sameActivity.source_activity_id);
    // A link replaces this activity's links elsewhere in the plan; any decision replaces the
    // previous one for this pair.
    clear =
      input.decision === 'link'
        ? clear.where((eb) =>
            eb.or([eb('decision', '=', 'link'), eb('workout_lineage_id', '=', workout.lineage_id)]),
          )
        : clear.where('workout_lineage_id', '=', workout.lineage_id);
    await clear.execute();
    await tx
      .insertInto('activity_match_overrides')
      .values({
        ...sameActivity,
        athlete_id: athleteId,
        plan_id: workout.plan_id,
        workout_lineage_id: workout.lineage_id,
        decision: input.decision,
        decided_at: now,
      })
      .execute();
  });
  return readWorkoutActual(athleteId, workoutId, now);
}
