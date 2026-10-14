import type { StravaActivity, StravaLap } from './strava.client.js';

export const ACTIVITY_SPORTS = ['run', 'cycle', 'swim', 'strength', 'row', 'other'] as const;
export type ActivitySport = (typeof ACTIVITY_SPORTS)[number];

/**
 * Strava sport types grouped by the sport a plan prescribes. E-bike rides, walks and
 * everything else stay "other": recorded, but never matched to training automatically.
 */
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

export type ActivityValues = {
  source_activity_id: string;
  sport: ActivitySport;
  source_sport_type: string;
  name: string;
  started_at: string;
  local_date: string;
  elapsed_seconds: number;
  moving_seconds: number | null;
  distance_metres: number | null;
  elevation_gain_metres: number | null;
  average_speed_mps: number | null;
  average_watts: number | null;
  trainer: boolean;
  manual: boolean;
  race: boolean;
};

const positive = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) || value < 0 ? null : value;
const whole = (value: number | null | undefined) => {
  const kept = positive(value);
  return kept === null ? null : Math.round(kept);
};

/**
 * Strava's `start_date_local` is local wall-clock time written with a "Z" suffix, so its date
 * part is the day the athlete trained there, whatever the server's timezone.
 */
export function toActivityValues(activity: StravaActivity): ActivityValues {
  const sportType = activity.sport_type ?? activity.type ?? 'Workout';
  return {
    source_activity_id: activity.id,
    sport: sportFor(sportType),
    source_sport_type: sportType.slice(0, 100),
    name: (activity.name ?? '').slice(0, 500),
    started_at: new Date(activity.start_date).toISOString(),
    local_date: activity.start_date_local.slice(0, 10),
    elapsed_seconds: whole(activity.elapsed_time) ?? 0,
    moving_seconds: whole(activity.moving_time),
    distance_metres: positive(activity.distance),
    elevation_gain_metres: positive(activity.total_elevation_gain),
    average_speed_mps: positive(activity.average_speed),
    average_watts: positive(activity.average_watts),
    trainer: activity.trainer ?? false,
    manual: activity.manual ?? false,
    // workout_type 1 is a run race and 11 a ride race.
    race: activity.workout_type === 1 || activity.workout_type === 11,
  };
}

export function toLapValues(laps: StravaLap[]) {
  return laps.map((lap, index) => ({
    lap_index: index + 1,
    elapsed_seconds: whole(lap.elapsed_time) ?? 0,
    moving_seconds: whole(lap.moving_time),
    distance_metres: positive(lap.distance),
    average_speed_mps: positive(lap.average_speed),
    average_watts: positive(lap.average_watts),
  }));
}
