import type { WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import {
  Dumbbell,
  Flag,
  Footprints,
  Gauge,
  Leaf,
  Moon,
  Signpost,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { KIND_COLORS, ZONE_COLORS } from '../theme/palette';
import { METRES_PER_MILE, addDays, daysBetween, startOfWeek } from './format';

export type WorkoutKind = keyof typeof KIND_COLORS | 'test';

export const KIND_META: Record<WorkoutKind, { label: string; icon: LucideIcon; color: string }> = {
  easy: { label: 'Easy run', icon: Footprints, color: KIND_COLORS.easy },
  recovery: { label: 'Recovery', icon: Leaf, color: KIND_COLORS.recovery },
  long: { label: 'Long run', icon: Signpost, color: KIND_COLORS.long },
  tempo: { label: 'Tempo', icon: Gauge, color: KIND_COLORS.tempo },
  intervals: { label: 'Intervals', icon: Zap, color: KIND_COLORS.intervals },
  strength: { label: 'Strength', icon: Dumbbell, color: KIND_COLORS.strength },
  race: { label: 'Race', icon: Trophy, color: KIND_COLORS.race },
  test: { label: 'Time trial', icon: Flag, color: KIND_COLORS.race },
  rest: { label: 'Rest', icon: Moon, color: KIND_COLORS.rest },
};

/**
 * The API does not yet classify workouts, so infer a presentation kind from the coach's wording.
 * This only drives colour and iconography; it never changes the prescription.
 */
export function inferKind(workout: Pick<WorkoutSummary, 'title' | 'purpose' | 'discipline'>) {
  const text = `${workout.title} ${workout.purpose ?? ''}`.toLowerCase();
  const title = workout.title.toLowerCase();
  if (workout.discipline !== 'running' && /strength|gym|mobility|core/.test(text))
    return 'strength';
  if (/\brace\b|parkrun/.test(title)) return 'race';
  if (/time trial|\btest\b|benchmark/.test(title)) return 'test';
  if (/long run|long easy|\blong\b/.test(title)) return 'long';
  if (/interval|repetition|\breps?\b|\d+\s?[x×]\s?\d|vo2|track|hill/.test(title))
    return 'intervals';
  if (/tempo|threshold|cruise|progression|marathon pace|steady/.test(title)) return 'tempo';
  if (/recovery|shake ?out/.test(title)) return 'recovery';
  if (/strength|gym|mobility/.test(title)) return 'strength';
  if (/rest/.test(title)) return 'rest';
  return 'easy';
}

// ---- Intensity profile -------------------------------------------------------------------------

const ZONE_LEVEL: Record<string, number> = {
  recovery: 1,
  easy: 1.4,
  marathon: 2.4,
  threshold: 3.2,
  interval: 4.2,
  repetition: 5,
};

export type Segment = { seconds: number; level: number; color: string; label: string };

function paceSecondsPerKm(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null) return null;
  if (unit === 'seconds_per_kilometre') return value;
  if (unit === 'seconds_per_mile') return value / (METRES_PER_MILE / 1000);
  return null;
}

function stepSeconds(step: WorkoutStep, secondsPerKm: number | null): number {
  const completion = step.completion;
  if (!completion || completion.value === null) return 60;
  switch (completion.unit) {
    case 'seconds':
      return completion.value;
    case 'minutes':
      return completion.value * 60;
    case 'hours':
      return completion.value * 3600;
    case 'metres':
      return (completion.value / 1000) * (secondsPerKm ?? 360);
    case 'kilometres':
      return completion.value * (secondsPerKm ?? 360);
    case 'miles':
      return completion.value * (METRES_PER_MILE / 1000) * (secondsPerKm ?? 360);
    default:
      return 60;
  }
}

/** Flattens a prescription tree into timed segments for the effort profile chart. */
export function intensitySegments(step: WorkoutStep): Segment[] {
  if (step.kind === 'sequence') return step.steps.flatMap(intensitySegments);
  if (step.kind === 'repeat') {
    const inner = step.steps.flatMap(intensitySegments);
    return Array.from({ length: step.repeatCount ?? 1 }, () => inner).flat();
  }
  const zone = step.targets.find((target) => target.type === 'zone');
  const key = zone?.zoneKey ?? null;
  const restful = step.role === 'recovery' || step.role === 'warmup' || step.role === 'cooldown';
  const level = key ? (ZONE_LEVEL[key] ?? 1.4) : restful ? 1 : 1.4;
  const pace = step.targets.find((target) => target.type === 'pace');
  const secondsPerKm =
    paceSecondsPerKm(pace?.targetValue, pace?.unit) ??
    paceSecondsPerKm(zone?.resolvedZone?.targetValue, zone?.resolvedZone?.unit);
  return [
    {
      seconds: Math.max(stepSeconds(step, secondsPerKm), 20),
      level: restful && key === 'easy' ? 1 : level,
      color: key ? (ZONE_COLORS[key] ?? ZONE_COLORS.easy!) : ZONE_COLORS.easy!,
      label: step.label ?? step.role ?? 'Effort',
    },
  ];
}

// ---- Weeks -------------------------------------------------------------------------------------

export type WeekSummary = {
  number: number;
  startDate: string;
  endDate: string;
  workouts: WorkoutSummary[];
  metres: number;
  seconds: number;
  runs: number;
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
      runs: inWeek.filter((w) => w.discipline === 'running').length,
      planned: planned || inWeek.length > 0,
    };
  });
}

export function workoutsOn(workouts: WorkoutSummary[], date: string) {
  return workouts.filter((workout) => workout.scheduledDate === date);
}
