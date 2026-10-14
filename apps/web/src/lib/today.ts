import type { TrainingWeek, WorkoutSummary } from '@askesis/api-client';
import type { PlanBlock } from './blocks';
import { addDays, daysBetween, startOfWeek } from './format';
import { SPORT_META, type Sport } from './sports';
import { inferKind } from './workouts';

/*
 * What Today says about the plan around a date. Askesis does not record completed sessions yet,
 * so "so far" means the sessions scheduled before today.
 */

export type SportProgress = {
  sport: Sport;
  sessions: number;
  seconds: number;
  metres: number;
  doneSessions: number;
  doneSeconds: number;
  doneMetres: number;
};

export type PlanToDate = {
  sessions: number;
  doneSessions: number;
  seconds: number;
  doneSeconds: number;
  /** Per sport, most training time first. */
  sports: SportProgress[];
};

function sportOf(workout: Pick<WorkoutSummary, 'discipline'>): Sport {
  return (workout.discipline in SPORT_META ? workout.discipline : 'other') as Sport;
}

export function planToDate(workouts: WorkoutSummary[], today: string): PlanToDate {
  const sports = new Map<Sport, SportProgress>();
  let doneSessions = 0;
  let seconds = 0;
  let doneSeconds = 0;
  for (const workout of workouts) {
    const sport = sportOf(workout);
    const entry = sports.get(sport) ?? {
      sport,
      sessions: 0,
      seconds: 0,
      metres: 0,
      doneSessions: 0,
      doneSeconds: 0,
      doneMetres: 0,
    };
    const time = workout.estimatedDurationSeconds ?? 0;
    const distance = workout.estimatedDistanceMetres ?? 0;
    entry.sessions += 1;
    entry.seconds += time;
    entry.metres += distance;
    seconds += time;
    if (workout.scheduledDate < today) {
      entry.doneSessions += 1;
      entry.doneSeconds += time;
      entry.doneMetres += distance;
      doneSessions += 1;
      doneSeconds += time;
    }
    sports.set(sport, entry);
  }
  return {
    sessions: workouts.length,
    doneSessions,
    seconds,
    doneSeconds,
    sports: [...sports.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

/**
 * What a session's length is compared against: earlier sessions of its sport, or earlier bricks.
 * Strength and gym circuits do not grow that way, so they have none.
 */
function lengthTrack(workout: WorkoutSummary): 'run' | 'cycle' | 'swim' | 'brick' | null {
  const sport = sportOf(workout);
  if (sport === 'run' || sport === 'cycle' || sport === 'swim') return sport;
  return sport === 'mixed' && inferKind(workout) === 'brick' ? 'brick' : null;
}
/** Session lengths worth marking the first time a plan reaches them. */
const MINUTE_MARKS = [45, 60, 90, 120, 150, 180, 240, 300, 360];
/** Swims are measured by distance when the coach gave one. */
const SWIM_METRE_MARKS = [1000, 1500, 2000, 2500, 3000, 4000, 5000];

export type FirstMark = { unit: 'minutes' | 'metres'; value: number };

/**
 * The round length this session is the first of its kind to reach, such as a first 2-hour ride
 * or a first 2,000 m swim, or null. Steady week-on-week growth is not a milestone; crossing a
 * mark no earlier session reached is. Races are excluded.
 */
export function firstMark(workout: WorkoutSummary, workouts: WorkoutSummary[]): FirstMark | null {
  const track = lengthTrack(workout);
  if (!track || workout.racePriority) return null;
  const byDistance = track === 'swim' && workout.estimatedDistanceMetres !== null;
  const measure = (w: WorkoutSummary) =>
    byDistance ? (w.estimatedDistanceMetres ?? 0) : (w.estimatedDurationSeconds ?? 0) / 60;
  const marks = byDistance ? SWIM_METRE_MARKS : MINUTE_MARKS;
  let previous = 0;
  let earlier = false;
  for (const other of workouts)
    if (
      other.scheduledDate < workout.scheduledDate &&
      lengthTrack(other) === track &&
      !other.racePriority
    ) {
      previous = Math.max(previous, measure(other));
      earlier = true;
    }
  // The first session of a sport has nothing to beat.
  if (!earlier) return null;
  const value = measure(workout);
  const crossed = marks.filter((mark) => value >= mark && previous < mark).at(-1);
  return crossed ? { unit: byDistance ? 'metres' : 'minutes', value: crossed } : null;
}

export type Milestone =
  | { kind: 'race'; date: string; workout: WorkoutSummary }
  | { kind: 'first'; date: string; workout: WorkoutSummary; mark: FirstMark }
  | { kind: 'block'; date: string; block: PlanBlock }
  | { kind: 'cutback'; date: string }
  | { kind: 'biggest-week'; date: string; seconds: number }
  | { kind: 'halfway'; date: string }
  | { kind: 'finish'; date: string };

/**
 * Notable moments after today: races, new blocks, cutbacks, the biggest week and sessions that
 * reach a round length for the first time. Within `horizon` days (the whole plan when infinite),
 * except the next goal race and the plan's finish, which always show so the list has an end.
 */
export function upcomingMilestones({
  workouts,
  blocks,
  weeks,
  startDate,
  endDate,
  today,
  horizon = 28,
}: {
  workouts: WorkoutSummary[];
  blocks: PlanBlock[];
  weeks: TrainingWeek[];
  startDate: string | null;
  endDate: string | null;
  today: string;
  horizon?: number;
}): Milestone[] {
  const limit = Number.isFinite(horizon) ? addDays(today, horizon) : '9999-12-31';
  const soon = (date: string) => date > today && date <= limit;
  const items: Milestone[] = [];
  const sorted = [...workouts].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

  const goal = sorted.find((w) => w.racePriority === 'A' && w.scheduledDate > today);
  for (const workout of sorted)
    if (workout.racePriority && (workout === goal || soon(workout.scheduledDate)))
      items.push({ kind: 'race', date: workout.scheduledDate, workout });

  for (const workout of sorted) {
    if (!soon(workout.scheduledDate)) continue;
    const mark = firstMark(workout, sorted);
    if (mark) items.push({ kind: 'first', date: workout.scheduledDate, workout, mark });
  }

  for (const block of blocks)
    if (soon(block.startDate)) items.push({ kind: 'block', date: block.startDate, block });
  for (const week of weeks)
    if (week.cutback && soon(week.startDate)) items.push({ kind: 'cutback', date: week.startDate });

  const weekly = new Map<string, number>();
  for (const workout of sorted) {
    const start = startOfWeek(workout.scheduledDate);
    weekly.set(start, (weekly.get(start) ?? 0) + (workout.estimatedDurationSeconds ?? 0));
  }
  const [biggest] = [...weekly.entries()].sort((a, b) => b[1] - a[1]);
  if (biggest && soon(biggest[0]))
    items.push({ kind: 'biggest-week', date: biggest[0], seconds: biggest[1] });

  if (startDate && endDate) {
    const halfway = addDays(startDate, Math.floor(daysBetween(startDate, endDate) / 2));
    if (soon(halfway)) items.push({ kind: 'halfway', date: halfway });
    if (endDate > today && !goal) items.push({ kind: 'finish', date: endDate });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** The countdown Today leads with: the next goal race, else the plan's last day. */
export function countdownTarget(
  workouts: WorkoutSummary[],
  endDate: string | null,
  today: string,
): { date: string; days: number; label: string; race: WorkoutSummary | null } | null {
  const race = [...workouts]
    .filter((w) => w.racePriority === 'A' && w.scheduledDate >= today)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
  if (race)
    return {
      date: race.scheduledDate,
      days: daysBetween(today, race.scheduledDate),
      label: race.title,
      race,
    };
  if (endDate && endDate >= today)
    return { date: endDate, days: daysBetween(today, endDate), label: 'Plan complete', race: null };
  return null;
}

const SESSION_NOUNS: Partial<Record<Sport, string>> = {
  run: 'run',
  cycle: 'ride',
  swim: 'swim',
  mixed: 'brick',
};

/** "First 2-hour ride", "First 90-minute run", "First 2,000 m swim". */
export function firstMarkLabel(
  workout: Pick<WorkoutSummary, 'discipline'>,
  mark: FirstMark,
  formatMetres: (metres: number) => string,
) {
  const noun = SESSION_NOUNS[sportOf(workout)] ?? 'session';
  if (mark.unit === 'metres') return `First ${formatMetres(mark.value)} ${noun}`;
  const hours = mark.value / 60;
  const length =
    mark.value < 60 || !Number.isInteger(hours)
      ? mark.value === 150
        ? '2½-hour'
        : `${mark.value}-minute`
      : `${hours}-hour`;
  return `First ${length} ${noun}`;
}
