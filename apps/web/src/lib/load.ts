import type { WorkoutSummary } from '@askesis/api-client';
import { addDays, daysBetween, startOfWeek } from './format';
import { workoutLook, type WorkoutKind } from './workouts';

/*
 * Training load from the schedule. Askesis records no completed activities yet, so every number
 * here describes the plan as written: what the sessions behind you asked for and what the ones
 * ahead will ask. Each session scores like a training stress score, hours × intensity² × 100,
 * where intensity is a typical whole-session fraction of threshold for its kind. Fitness and
 * fatigue are the usual 42- and 7-day exponentially weighted averages of daily load, and form is
 * the gap between them on the morning of a day.
 */

type LoadInput = Pick<
  WorkoutSummary,
  'title' | 'purpose' | 'discipline' | 'racePriority' | 'estimatedDurationSeconds'
>;
type ScheduledLoad = LoadInput & Pick<WorkoutSummary, 'scheduledDate'>;

/** Typical whole-session intensity, as a fraction of threshold, for each kind of session. */
const SESSION_INTENSITY: Record<WorkoutKind, number> = {
  recovery: 0.55,
  easy: 0.65,
  long: 0.68,
  steady: 0.75,
  tempo: 0.83,
  intervals: 0.85,
  speed: 0.82,
  strength: 0.7,
  mobility: 0.45,
  brick: 0.78,
  race: 0.95,
  test: 0.9,
  rest: 0,
};

/** Strength reads its effort from its wording: heavy work loads more than activation. */
const STRENGTH_INTENSITY = { easy: 0.6, steady: 0.7, hard: 0.8 } as const;

/** Minutes assumed for a session the coach gave no duration. */
const DEFAULT_MINUTES = 45;
export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

/** One session's estimated load. */
export function sessionLoad(workout: LoadInput): number {
  const look = workoutLook(workout);
  if (look.kind === 'rest') return 0;
  const intensity =
    look.kind === 'strength'
      ? (STRENGTH_INTENSITY[look.effort as keyof typeof STRENGTH_INTENSITY] ?? 0.7)
      : SESSION_INTENSITY[look.kind];
  const seconds = workout.estimatedDurationSeconds ?? DEFAULT_MINUTES * 60;
  return (seconds / 3600) * intensity ** 2 * 100;
}

/** One day of the plan. Fitness, fatigue and form are as you wake, before the day's training. */
export type LoadDay = {
  date: string;
  /** Load scheduled on this day. */
  load: number;
  fitness: number;
  fatigue: number;
  /** Fitness less fatigue. */
  form: number;
};

/**
 * Daily load, fitness, fatigue and form across the plan. The athlete arrives with some fitness, so
 * both averages start at the mean daily load of the first fortnight rather than at zero, which
 * would read every plan as a crash from nothing.
 */
export function loadSeries(
  workouts: ScheduledLoad[],
  startDate: string | null,
  endDate: string | null,
): LoadDay[] {
  const dates = workouts.map((workout) => workout.scheduledDate).sort();
  const first = [startDate, dates[0]].filter((date): date is string => !!date).sort()[0];
  const last = [endDate, dates.at(-1)]
    .filter((date): date is string => !!date)
    .sort()
    .at(-1);
  if (!first || !last || last < first) return [];
  const daily = new Map<string, number>();
  for (const workout of workouts)
    daily.set(
      workout.scheduledDate,
      (daily.get(workout.scheduledDate) ?? 0) + sessionLoad(workout),
    );
  const length = daysBetween(first, last) + 1;
  const seedDays = Math.min(14, length);
  let seed = 0;
  for (let i = 0; i < seedDays; i += 1) seed += daily.get(addDays(first, i)) ?? 0;
  seed /= seedDays;
  let fitness = seed;
  let fatigue = seed;
  const series: LoadDay[] = [];
  for (let i = 0; i < length; i += 1) {
    const date = addDays(first, i);
    const load = daily.get(date) ?? 0;
    series.push({ date, load, fitness, fatigue, form: fitness - fatigue });
    fitness += (load - fitness) / FITNESS_DAYS;
    fatigue += (load - fatigue) / FATIGUE_DAYS;
  }
  return series;
}

export type FormStateKey = 'fresh' | 'ready' | 'neutral' | 'building' | 'stretched';

export const FORM_STATES: Record<
  FormStateKey,
  { label: string; summary: string; min: number; max: number }
> = {
  fresh: {
    label: 'Very fresh',
    summary: 'Well rested. Ideal for a race; held for weeks, fitness starts to fade.',
    min: 0.2,
    max: Infinity,
  },
  ready: {
    label: 'Fresh',
    summary: 'Recovered and ready to perform.',
    min: 0.05,
    max: 0.2,
  },
  neutral: {
    label: 'Balanced',
    summary: 'Fatigue and fitness are close, so the training is being absorbed comfortably.',
    min: -0.1,
    max: 0.05,
  },
  building: {
    label: 'Building',
    summary: 'Fatigue sits above fitness. This is the productive range where fitness grows.',
    min: -0.3,
    max: -0.1,
  },
  stretched: {
    label: 'Stretched',
    summary: 'Fatigue is high for your fitness. Protect sleep and keep easy sessions easy.',
    min: -Infinity,
    max: -0.3,
  },
};

/** Form relative to fitness, so the bands mean the same for a light plan and a heavy one. */
export function formRatio(day: Pick<LoadDay, 'form' | 'fitness'>): number {
  return day.fitness > 0 ? day.form / day.fitness : 0;
}

export function formState(day: Pick<LoadDay, 'form' | 'fitness'>): FormStateKey {
  const ratio = formRatio(day);
  return (Object.keys(FORM_STATES) as FormStateKey[]).find(
    (key) => ratio >= FORM_STATES[key].min && ratio < FORM_STATES[key].max,
  )!;
}

export type LoadSnapshot = {
  today: LoadDay;
  /** Fitness gained over the past seven days: the ramp rate. */
  ramp: number;
  /** Race morning, when the plan has a goal race ahead. */
  raceDay: LoadDay | null;
};

/** Where today sits in the series, or null when today is outside the plan. */
export function loadSnapshot(
  series: LoadDay[],
  today: string,
  raceDate?: string | null,
): LoadSnapshot | null {
  const index = series.findIndex((day) => day.date === today);
  if (index < 0) return null;
  const day = series[index]!;
  const weekAgo = series[Math.max(0, index - 7)]!;
  return {
    today: day,
    ramp: day.fitness - weekAgo.fitness,
    raceDay: raceDate ? (series.find((entry) => entry.date === raceDate) ?? null) : null,
  };
}

export type WeekLoad = { startDate: string; load: number; seconds: number; sessions: number };

/** Load per Monday-start week across the series. */
export function weeklyLoads(
  series: LoadDay[],
  workouts: Pick<WorkoutSummary, 'scheduledDate' | 'estimatedDurationSeconds'>[],
): WeekLoad[] {
  const weeks = new Map<string, WeekLoad>();
  for (const day of series) {
    const start = startOfWeek(day.date);
    const week = weeks.get(start) ?? { startDate: start, load: 0, seconds: 0, sessions: 0 };
    week.load += day.load;
    weeks.set(start, week);
  }
  for (const workout of workouts) {
    const week = weeks.get(startOfWeek(workout.scheduledDate));
    if (!week) continue;
    week.sessions += 1;
    week.seconds += workout.estimatedDurationSeconds ?? 0;
  }
  return [...weeks.values()];
}
