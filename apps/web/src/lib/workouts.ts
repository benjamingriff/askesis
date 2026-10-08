import type { RacePriority, WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { Moon, PersonStanding, Trophy, type LucideIcon } from 'lucide-react';
import { effortColor, EFFORTS, zoneEffort, type Effort } from '../theme/palette';
import { METRES_PER_MILE, addDays, daysBetween, startOfWeek } from './format';
import { SPORT_META, type Sport } from './sports';

/** What a session is for, independent of sport. Its effort sets its colour. */
export type WorkoutKind =
  | 'recovery'
  | 'easy'
  | 'long'
  | 'steady'
  | 'tempo'
  | 'intervals'
  | 'speed'
  | 'strength'
  | 'mobility'
  | 'brick'
  | 'race'
  | 'test'
  | 'rest';

export const KIND_META: Record<WorkoutKind, { label: string; effort: Effort | null }> = {
  recovery: { label: 'Recovery', effort: 'recovery' },
  easy: { label: 'Easy', effort: 'easy' },
  long: { label: 'Long', effort: 'easy' },
  steady: { label: 'Steady', effort: 'steady' },
  tempo: { label: 'Threshold', effort: 'threshold' },
  intervals: { label: 'Intervals', effort: 'hard' },
  speed: { label: 'Speed', effort: 'max' },
  strength: { label: 'Strength', effort: 'steady' },
  mobility: { label: 'Mobility', effort: 'recovery' },
  brick: { label: 'Brick', effort: 'steady' },
  race: { label: 'Race', effort: 'max' },
  test: { label: 'Test', effort: 'max' },
  rest: { label: 'Rest', effort: null },
};

/** Natural names for the common sport and session pairs; others read "Ride · Speed". */
const NAMES: Partial<Record<Sport, Partial<Record<WorkoutKind, string>>>> = {
  run: {
    recovery: 'Recovery run',
    easy: 'Easy run',
    long: 'Long run',
    steady: 'Steady run',
    tempo: 'Tempo',
    intervals: 'Intervals',
    speed: 'Speed',
    test: 'Time trial',
  },
  cycle: {
    recovery: 'Recovery ride',
    easy: 'Endurance ride',
    long: 'Long ride',
    steady: 'Tempo ride',
    tempo: 'Threshold ride',
    intervals: 'Bike intervals',
    speed: 'Sprints',
    test: 'FTP test',
  },
  swim: {
    recovery: 'Recovery swim',
    easy: 'Aerobic swim',
    long: 'Long swim',
    steady: 'Steady swim',
    tempo: 'Threshold swim',
    intervals: 'Swim intervals',
    speed: 'Sprint swim',
    test: 'CSS test',
  },
};

/**
 * The API classifies workouts by sport, and races by an explicit race priority, so infer the
 * session from the coach's wording. A title never makes a workout a race. This only drives labels
 * and colour; it never changes the prescription.
 */
export function inferKind(
  workout: Pick<WorkoutSummary, 'title' | 'purpose' | 'discipline' | 'racePriority'>,
): WorkoutKind {
  const title = workout.title.toLowerCase();
  const sport = workout.discipline;
  if (workout.racePriority) return 'race';
  if (/time trial|\btest\b|benchmark/.test(title)) return 'test';
  if (/^rest\b|rest day/.test(title)) return 'rest';
  if (/mobility|yoga|stretch|flexibility/.test(title)) return 'mobility';
  if (sport === 'strength') return 'strength';
  if (!['run', 'cycle', 'swim', 'mixed'].includes(sport) && /strength|gym|core/.test(title))
    return 'strength';
  if (/brick|hyrox|simulation/.test(title)) return 'brick';
  if (/recovery|shake ?out/.test(title)) return 'recovery';
  if (/long run|long ride|long swim|long easy|\blong\b/.test(title)) return 'long';
  if (/sprint|repetition|anaerobic|neuromuscular|\bspeed\b|all[- ]out/.test(title)) return 'speed';
  if (/threshold|cruise|sweet ?spot|\bcss\b|lactate/.test(title)) return 'tempo';
  // A running tempo is threshold work; on the bike or in the pool tempo sits just below it.
  if (/tempo/.test(title)) return sport === 'run' ? 'tempo' : 'steady';
  if (/interval|vo2|track|hill|fartlek|repeats?\b|\d+\s?[x×]\s?\d/.test(title)) return 'intervals';
  if (/steady|marathon pace|progression|moderate|race pace/.test(title)) return 'steady';
  return 'easy';
}

export type WorkoutLook = {
  kind: WorkoutKind;
  sport: Sport;
  /** Session name for this sport, such as "Long ride" or "Swim intervals". */
  label: string;
  /** Sport icon, except for milestones and rest. */
  icon: LucideIcon;
  effort: Effort | null;
  /** The effort colour as a CSS value; rest days fall back to a quiet neutral. */
  color: string;
};

/** Sessions that read the same in any sport keep their own name. */
const SPORTLESS: WorkoutKind[] = ['strength', 'mobility', 'brick', 'race', 'rest'];

function lookLabel(kind: WorkoutKind, sport: Sport): string {
  const named = NAMES[sport]?.[kind];
  if (named) return named;
  if (SPORTLESS.includes(kind)) return KIND_META[kind].label;
  return `${SPORT_META[sport].label} · ${KIND_META[kind].label}`;
}

function strengthEffort(title: string): Effort {
  if (/heavy|power|max|plyo|explosive/.test(title)) return 'hard';
  if (/light|activation|prehab|technique/.test(title)) return 'easy';
  return 'steady';
}

/** How a workout presents: the icon names the sport and the colour says how hard it is. */
export function workoutLook(
  workout: Pick<WorkoutSummary, 'title' | 'purpose' | 'discipline' | 'racePriority'>,
): WorkoutLook {
  const kind = inferKind(workout);
  const sport = (workout.discipline in SPORT_META ? workout.discipline : 'other') as Sport;
  const effort =
    kind === 'strength' ? strengthEffort(workout.title.toLowerCase()) : KIND_META[kind].effort;
  const label = lookLabel(kind, sport);
  const icon =
    kind === 'race'
      ? Trophy
      : kind === 'rest'
        ? Moon
        : kind === 'mobility'
          ? PersonStanding
          : SPORT_META[sport].icon;
  return {
    kind,
    sport,
    label,
    icon,
    effort,
    color: effort ? effortColor(effort) : 'var(--text-muted)',
  };
}

// ---- Races -------------------------------------------------------------------------------------

export const RACE_META: Record<RacePriority, { label: string; description: string }> = {
  A: { label: 'A race', description: 'Goal race, reached through a taper.' },
  B: { label: 'B race', description: 'Important tune-up, with a few easier days before it.' },
  C: { label: 'C race', description: 'Raced hard as training, without a taper.' },
};

/** The most important race among some workouts, if any. */
export function topRace(
  workouts: readonly Pick<WorkoutSummary, 'racePriority'>[],
): RacePriority | null {
  return (['A', 'B', 'C'] as const).find((p) => workouts.some((w) => w.racePriority === p)) ?? null;
}

// ---- Intensity profile -------------------------------------------------------------------------

const ZONE_LEVEL: Record<string, number> = {
  recovery: 1,
  easy: 1.4,
  endurance: 1.6,
  marathon: 2.4,
  tempo: 2.4,
  sweet_spot: 2.9,
  threshold: 3.2,
  interval: 4.2,
  vo2max: 4.2,
  speed: 4.6,
  repetition: 5,
  anaerobic: 5,
};

export type Segment = {
  seconds: number;
  level: number;
  effort: Effort;
  color: string;
  label: string;
};

/** Typical speeds (seconds per km) when a step has a distance but no pace to time it by. */
const DEFAULT_SECONDS_PER_KM: Record<string, number> = {
  run: 360,
  swim: 1200,
  cycle: 120,
  row: 240,
  ski_erg: 270,
};

function paceSecondsPerKm(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null) return null;
  if (unit === 'seconds_per_kilometre') return value;
  if (unit === 'seconds_per_mile') return value / (METRES_PER_MILE / 1000);
  if (unit === 'seconds_per_100_metres') return value * 10;
  return null;
}

function stepSeconds(step: WorkoutStep, secondsPerKm: number | null): number {
  const completion = step.completion;
  if (!completion || completion.value === null) return 60;
  const perKm = secondsPerKm ?? DEFAULT_SECONDS_PER_KM[step.discipline ?? 'run'] ?? 360;
  switch (completion.unit) {
    case 'seconds':
      return completion.value;
    case 'minutes':
      return completion.value * 60;
    case 'hours':
      return completion.value * 3600;
    case 'metres':
      return (completion.value / 1000) * perKm;
    case 'kilometres':
      return completion.value * perKm;
    case 'miles':
      return completion.value * (METRES_PER_MILE / 1000) * perKm;
    case 'repetitions':
      // Roughly three seconds a rep: a set of lifts reads as a short block of work.
      return completion.value * 3;
    default:
      return 60;
  }
}

/** Effort level for a step without a zone: RPE when given, else reps in reserve, else its role. */
function unzonedLevel(step: WorkoutStep, restful: boolean): number {
  const rpe = step.targets.find((target) => target.type === 'rpe')?.targetValue;
  if (rpe != null) return Math.max(1, Math.min(5, rpe / 2));
  const rir = step.targets.find((target) => target.type === 'rir')?.targetValue;
  if (rir != null) return Math.max(2.4, 4.6 - rir * 0.6);
  if (restful) return 1;
  return step.discipline === 'strength' ? 3.2 : 1.4;
}

/** The effort step an unzoned level falls in, cut at the same points as the zone levels. */
function levelEffort(level: number): Effort {
  if (level < 1.2) return 'recovery';
  if (level < 2) return 'easy';
  if (level < 2.7) return 'steady';
  if (level < 3.7) return 'threshold';
  if (level < 4.5) return 'hard';
  return 'max';
}

/** One step's effort and chart height: its zone if it has one, else RPE, reps in reserve or role. */
export function stepEffort(step: WorkoutStep): { effort: Effort; level: number } {
  const key = step.targets.find((target) => target.type === 'zone')?.zoneKey ?? null;
  const restful = step.role === 'recovery' || step.role === 'warmup' || step.role === 'cooldown';
  if (key) {
    const effort = zoneEffort(key);
    const level =
      restful && (effort === 'easy' || effort === 'recovery') ? 1 : (ZONE_LEVEL[key] ?? 1.4);
    return { effort, level };
  }
  const level = unzonedLevel(step, restful);
  if (restful) return { effort: step.role === 'recovery' ? 'recovery' : 'easy', level };
  return { effort: levelEffort(level), level };
}

/** Flattens a prescription tree into timed segments for the effort profile chart. */
export function intensitySegments(step: WorkoutStep): Segment[] {
  if (step.kind === 'sequence') return step.steps.flatMap(intensitySegments);
  if (step.kind === 'repeat') {
    const inner = step.steps.flatMap(intensitySegments);
    return Array.from({ length: step.repeatCount ?? 1 }, () => inner).flat();
  }
  const zone = step.targets.find((target) => target.type === 'zone');
  const pace = step.targets.find((target) => target.type === 'pace');
  const secondsPerKm =
    paceSecondsPerKm(pace?.targetValue, pace?.unit) ??
    paceSecondsPerKm(zone?.resolvedZone?.targetValue, zone?.resolvedZone?.unit);
  const { effort, level } = stepEffort(step);
  return [
    {
      seconds: Math.max(stepSeconds(step, secondsPerKm), 20),
      level,
      effort,
      color: effortColor(effort),
      label: step.label ?? step.role ?? 'Effort',
    },
  ];
}

/** A set of workouts' volume split by effort, easiest first, for stacked load bars. */
export function effortMix(
  workouts: WorkoutSummary[],
  measure: 'distance' | 'time',
): { effort: Effort; amount: number }[] {
  const totals = new Map<Effort, number>();
  for (const workout of workouts) {
    const { effort } = workoutLook(workout);
    const amount =
      (measure === 'time' ? workout.estimatedDurationSeconds : workout.estimatedDistanceMetres) ??
      0;
    if (effort && amount > 0) totals.set(effort, (totals.get(effort) ?? 0) + amount);
  }
  return EFFORTS.filter((effort) => totals.has(effort)).map((effort) => ({
    effort,
    amount: totals.get(effort)!,
  }));
}

// ---- Weeks -------------------------------------------------------------------------------------

export type WeekSummary = {
  number: number;
  startDate: string;
  endDate: string;
  workouts: WorkoutSummary[];
  metres: number;
  seconds: number;
  sessions: number;
  /** Inside the plan dates but beyond the prescribed coverage. */
  planned: boolean;
};

export type CoverageRange = { startDate: string; endDate: string; current?: boolean };

export function isCovered(date: string, coverage: CoverageRange[] | null | undefined): boolean {
  if (!coverage) return true;
  return coverage.some((range) => date >= range.startDate && date <= range.endDate);
}

/**
 * Calendar weeks (Monday start) spanning the plan dates, extended to include any saved workouts
 * outside them so those stay visible. `coverage` is null when unknown (legacy plans); then every
 * week with a workout counts as planned.
 */
export function summarizeWeeks(
  workouts: WorkoutSummary[],
  startDate: string | null,
  endDate: string | null,
  coverage: CoverageRange[] | null,
): WeekSummary[] {
  const dates = workouts.map((w) => w.scheduledDate).sort();
  const bounds = [startDate, endDate, dates[0], dates.at(-1)].filter(
    (date): date is string => !!date,
  );
  const first = bounds.reduce<string | undefined>(
    (min, d) => (!min || d < min ? d : min),
    undefined,
  );
  const last = bounds.reduce<string | undefined>(
    (max, d) => (!max || d > max ? d : max),
    undefined,
  );
  if (!first || !last) return [];
  const start = startOfWeek(first);
  const count = Math.max(1, Math.floor(daysBetween(start, last) / 7) + 1);
  return Array.from({ length: count }, (_, index) => {
    const weekStart = addDays(start, index * 7);
    const weekEnd = addDays(weekStart, 6);
    const inWeek = workouts.filter(
      (w) => w.scheduledDate >= weekStart && w.scheduledDate <= weekEnd,
    );
    const planned = coverage
      ? coverage.some((range) => range.startDate <= weekEnd && range.endDate >= weekStart)
      : inWeek.length > 0 || weekEnd < (dates[0] ?? weekStart);
    return {
      number: index + 1,
      startDate: weekStart,
      endDate: weekEnd,
      workouts: inWeek,
      metres: inWeek.reduce((sum, w) => sum + (w.estimatedDistanceMetres ?? 0), 0),
      seconds: inWeek.reduce((sum, w) => sum + (w.estimatedDurationSeconds ?? 0), 0),
      sessions: inWeek.length,
      planned: planned || inWeek.length > 0,
    };
  });
}

/**
 * Weekly volume is distance for running-only schedules and time once other sports appear, since
 * swim, ride and run distances do not add up meaningfully.
 */
export function volumeMeasure(workouts: Pick<WorkoutSummary, 'discipline'>[]): 'distance' | 'time' {
  return workouts.every((workout) => workout.discipline === 'run') ? 'distance' : 'time';
}

export function workoutsOn(workouts: WorkoutSummary[], date: string) {
  return workouts.filter((workout) => workout.scheduledDate === date);
}
