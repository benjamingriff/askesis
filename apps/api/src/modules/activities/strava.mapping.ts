import type { StravaActivity, StravaDetailedActivity } from './strava.client.js';
import type { ActivityDetail, ActivitySummary } from './activity.schemas.js';

export const ACTIVITY_SPORTS = ['run', 'cycle', 'swim', 'strength', 'row', 'other'] as const;
export type ActivitySport = (typeof ACTIVITY_SPORTS)[number];

/** Strava sport types grouped by the sport a plan prescribes, so the picker can rank them. */
const SPORT_TYPES: Record<Exclude<ActivitySport, 'other'>, string[]> = {
  run: ['Run', 'TrailRun', 'VirtualRun'],
  cycle: ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'Velomobile', 'Handcycle'],
  swim: ['Swim'],
  strength: ['WeightTraining', 'Crossfit', 'HighIntensityIntervalTraining', 'Workout'],
  row: ['Rowing', 'VirtualRow'],
};

export function sportFor(sportType: string): ActivitySport {
  const match = Object.entries(SPORT_TYPES).find(([, types]) => types.includes(sportType));
  return (match?.[0] as ActivitySport | undefined) ?? 'other';
}

export const stravaActivityUrl = (id: string) =>
  `https://www.strava.com/activities/${encodeURIComponent(id)}`;

const positive = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) || value < 0 ? null : value;
const whole = (value: number | null | undefined) => {
  const kept = positive(value);
  return kept === null ? null : Math.round(kept);
};

/**
 * Strava's `start_date_local` is local wall-clock time written with a "Z" suffix, so its date
 * and time parts are when the athlete trained there, whatever the server's timezone.
 */
export function toActivitySummary(activity: StravaActivity): ActivitySummary {
  const sportType = activity.sport_type ?? activity.type ?? 'Workout';
  return {
    provider: 'strava',
    id: activity.id,
    url: stravaActivityUrl(activity.id),
    name: (activity.name ?? '').slice(0, 500),
    sport: sportFor(sportType),
    sportType: sportType.slice(0, 100),
    date: activity.start_date_local.slice(0, 10),
    startTime: activity.start_date_local.slice(11, 16),
    elapsedSeconds: whole(activity.elapsed_time) ?? 0,
    movingSeconds: whole(activity.moving_time),
    distanceMetres: positive(activity.distance),
    elevationGainMetres: positive(activity.total_elevation_gain),
  };
}

export function toActivityDetail(activity: StravaDetailedActivity): ActivityDetail {
  return {
    ...toActivitySummary(activity),
    description: activity.description ? activity.description.slice(0, 2000) : null,
    deviceName: activity.device_name ? activity.device_name.slice(0, 200) : null,
    averageSpeed: positive(activity.average_speed),
    maxSpeed: positive(activity.max_speed),
    averageHeartrate: whole(activity.average_heartrate),
    maxHeartrate: whole(activity.max_heartrate),
    averageCadence: positive(activity.average_cadence),
    averageWatts: whole(activity.average_watts),
    calories: whole(activity.calories),
    trainer: activity.trainer ?? false,
    manual: activity.manual ?? false,
    laps: (activity.laps ?? []).slice(0, 200).map((lap, index) => ({
      index: index + 1,
      name: lap.name ? lap.name.slice(0, 100) : null,
      elapsedSeconds: whole(lap.elapsed_time) ?? 0,
      movingSeconds: whole(lap.moving_time),
      distanceMetres: positive(lap.distance),
      averageSpeed: positive(lap.average_speed),
      averageHeartrate: whole(lap.average_heartrate),
      averageCadence: positive(lap.average_cadence),
      averageWatts: whole(lap.average_watts),
    })),
  };
}
