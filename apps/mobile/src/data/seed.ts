import { addDays, diffDays, startOfWeek, todayISO } from './dates';
import {
  easyRun,
  intervalRun,
  longRun,
  raceWorkout,
  recoveryRun,
  restDay,
  strengthSession,
  stridesRun,
  tempoRun,
} from './builders';
import type { Phase, PlanMeta, Workout } from './types';

export const TOTAL_WEEKS = 12;
export const CURRENT_WEEK_NUMBER = 5;

/**
 * The plan is anchored to the real calendar so the prototype always opens mid-plan, in week 5
 * of 12, no matter when it is launched.
 */
export function planStartDate(now = todayISO()): string {
  return addDays(startOfWeek(now), -7 * (CURRENT_WEEK_NUMBER - 1));
}

export const PHASES: Phase[] = [
  {
    name: 'Base',
    fromWeek: 1,
    toWeek: 4,
    blurb: 'Aerobic foundation and routine',
    color: '#60A5FA',
  },
  {
    name: 'Build',
    fromWeek: 5,
    toWeek: 8,
    blurb: 'Raise the threshold, extend the long run',
    color: '#FBBF24',
  },
  {
    name: 'Peak',
    fromWeek: 9,
    toWeek: 11,
    blurb: 'Race-specific work at goal pace',
    color: '#F87171',
  },
  { name: 'Taper', fromWeek: 12, toWeek: 12, blurb: 'Shed fatigue, stay sharp', color: '#34D399' },
];

export function phaseForWeek(week: number): Phase {
  return PHASES.find((p) => week >= p.fromWeek && week <= p.toWeek) ?? PHASES[PHASES.length - 1];
}

export function buildPlanMeta(now = todayISO()): PlanMeta {
  const startDate = planStartDate(now);
  return {
    name: 'Autumn Half Marathon',
    goal: 'Sub 1:45 half marathon',
    raceName: 'Riverside Half Marathon',
    raceDate: addDays(startDate, TOTAL_WEEKS * 7 - 1),
    startDate,
    totalWeeks: TOTAL_WEEKS,
    phases: PHASES,
  };
}

type WeekConfig = {
  recovery: number;
  intervals: [number, number, number?];
  tempo: number;
  tempoSplit?: boolean;
  easy: number;
  long: number;
  finish?: { km: number; zone: 'steady' | 'tempo' };
  lowerBody?: 'lower' | 'full';
};

const WEEKS: Record<number, WeekConfig> = {
  1: { recovery: 5, intervals: [5, 600], tempo: 12, easy: 6, long: 12 },
  2: { recovery: 5, intervals: [6, 600], tempo: 15, easy: 6, long: 13 },
  3: { recovery: 6, intervals: [6, 800], tempo: 18, easy: 7, long: 14 },
  4: { recovery: 5, intervals: [4, 800], tempo: 12, easy: 6, long: 10 },
  5: { recovery: 6, intervals: [5, 1000], tempo: 20, easy: 7, long: 15 },
  6: { recovery: 6, intervals: [6, 1000], tempo: 22, easy: 7, long: 17 },
  7: {
    recovery: 6,
    intervals: [5, 1200],
    tempo: 24,
    tempoSplit: true,
    easy: 8,
    long: 18,
    finish: { km: 3, zone: 'steady' },
  },
  8: { recovery: 5, intervals: [4, 1000], tempo: 15, easy: 6, long: 12 },
  9: {
    recovery: 6,
    intervals: [6, 1000, 75],
    tempo: 26,
    tempoSplit: true,
    easy: 8,
    long: 19,
    finish: { km: 4, zone: 'tempo' },
  },
  10: {
    recovery: 6,
    intervals: [4, 1600, 120],
    tempo: 28,
    tempoSplit: true,
    easy: 8,
    long: 20,
    finish: { km: 5, zone: 'tempo' },
  },
};

function buildWeek(weekNumber: number, startDate: string, cfg: WeekConfig): Workout[] {
  const d = (i: number) => ({ date: addDays(startDate, (weekNumber - 1) * 7 + i) });
  const [reps, meters, rec] = cfg.intervals;
  return [
    recoveryRun(d(0), cfg.recovery),
    intervalRun(d(1), reps, meters, rec),
    strengthSession(d(2), cfg.lowerBody ?? 'lower'),
    tempoRun(d(3), cfg.tempo, cfg.tempoSplit),
    restDay(d(4)),
    easyRun(d(5), cfg.easy),
    longRun(d(6), cfg.long, cfg.finish),
  ];
}

/**
 * Seed workouts: weeks 1–8 are the locked v2 plan; weeks 9–10 and a few edits to weeks 6–7 are an
 * unlocked v3 draft produced by the coach. Weeks 11–12 are deliberately not planned yet.
 */
export function buildSeedWorkouts(now = todayISO()): Workout[] {
  const start = planStartDate(now);
  const out: Workout[] = [];
  for (let w = 1; w <= 10; w++) out.push(...buildWeek(w, start, WEEKS[w]));

  const byId = new Map(out.map((w) => [w.id, w]));
  const replace = (workout: Workout) => byId.set(workout.id, workout);
  const at = (week: number, dayIndex: number) => addDays(start, (week - 1) * 7 + dayIndex);

  // v3 draft: new peak-block weeks
  for (const w of out) {
    const week = Math.floor(diffDays(w.date, start) / 7) + 1;
    if (week >= 9 && w.kind !== 'rest') w.change = 'new';
  }

  // v3 draft: edits around the Saturday 10K in week 7
  replace(
    longRun(
      {
        date: at(6, 6),
        change: 'changed',
        changeNote: 'Trimmed from 17 km to 16 km so week 7 starts fresher.',
      },
      16,
    ),
  );
  replace(
    stridesRun(
      {
        date: at(7, 3),
        change: 'changed',
        changeNote: 'Tempo swapped for easy running + strides two days before your 10K.',
      },
      6,
    ),
  );
  replace(
    raceWorkout(
      {
        date: at(7, 5),
        change: 'changed',
        changeNote: 'Replaced the easy run with your 10K tune-up race.',
      },
      '10K tune-up race',
      10,
      'threshold',
      'A full-effort race to measure your fitness and recalibrate your pace guides.',
    ),
  );

  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type Week = {
  number: number;
  startDate: string;
  endDate: string;
};

export function weekList(meta: PlanMeta): Week[] {
  return Array.from({ length: meta.totalWeeks }, (_, i) => {
    const startDate = addDays(meta.startDate, i * 7);
    return { number: i + 1, startDate, endDate: addDays(startDate, 6) };
  });
}

export function weekNumberFor(meta: PlanMeta, iso: string): number {
  return Math.floor(diffDays(iso, meta.startDate) / 7) + 1;
}

export { WEEKS as WEEK_CONFIGS };

/** Weeks 11–12 as the coach would write them once the 10K result is in (used by the chat sim). */
export function buildFinalWeeks(startDate: string, raceName: string): Workout[] {
  const at = (week: number, dayIndex: number) => ({
    date: addDays(startDate, (week - 1) * 7 + dayIndex),
    change: 'new' as const,
  });
  const noFlag = (date: string) => ({ date });
  return [
    ...buildWeek(11, startDate, {
      recovery: 6,
      intervals: [5, 1000, 75],
      tempo: 20,
      tempoSplit: true,
      easy: 7,
      long: 16,
      finish: { km: 3, zone: 'tempo' },
    }).map((w) => (w.kind === 'rest' ? w : { ...w, change: 'new' as const })),
    easyRun(at(12, 0), 5),
    intervalRun(at(12, 1), 4, 800, 90),
    restDay(noFlag(addDays(startDate, 11 * 7 + 2))),
    stridesRun(at(12, 3), 5),
    restDay(noFlag(addDays(startDate, 11 * 7 + 4))),
    easyRun(at(12, 5), 3, 'Shakeout run'),
    raceWorkout(
      at(12, 6),
      raceName,
      21.0975,
      'tempo',
      'Goal pace for 1:45:00. Patient first 5 km, then settle in.',
    ),
  ];
}
