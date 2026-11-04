import { addDays, diffDays, weekdayIndex, WEEKDAYS_SHORT } from '../data/dates';
import { phaseForWeek, weekList, weekNumberFor, type Week } from '../data/seed';
import type { PlanMeta, Workout } from '../data/types';
import { isHard, workoutTotals } from './metrics';

export type WeekSummary = Week & {
  phase: ReturnType<typeof phaseForWeek>;
  workouts: Workout[];
  /** True once the coach has prescribed anything for this week. */
  planned: boolean;
  meters: number;
  seconds: number;
  runs: number;
  hard: number;
  strength: number;
  targetMeters: number;
};

export function summarizeWeek(meta: PlanMeta, workouts: Workout[], week: Week): WeekSummary {
  const inWeek = workouts
    .filter((w) => w.date >= week.startDate && w.date <= week.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  let meters = 0;
  let seconds = 0;
  for (const w of inWeek) {
    const t = workoutTotals(w);
    meters += t.meters;
    seconds += t.seconds;
  }
  const km = meters / 1000;
  return {
    ...week,
    phase: phaseForWeek(week.number),
    workouts: inWeek,
    planned: inWeek.length > 0,
    meters,
    seconds,
    runs: inWeek.filter((w) => w.kind !== 'rest' && w.kind !== 'strength').length,
    hard: inWeek.filter((w) => isHard(w.kind)).length,
    strength: inWeek.filter((w) => w.kind === 'strength').length,
    targetMeters: Math.round(km / 5) * 5 * 1000,
  };
}

export function summarizeWeeks(meta: PlanMeta, workouts: Workout[]): WeekSummary[] {
  return weekList(meta).map((w) => summarizeWeek(meta, workouts, w));
}

export function workoutOn(workouts: Workout[], date: string): Workout | undefined {
  return workouts.find((w) => w.date === date);
}

export function lastPlannedDate(workouts: Workout[]): string | null {
  let last: string | null = null;
  for (const w of workouts) if (!last || w.date > last) last = w.date;
  return last;
}

export function plannedThroughWeek(summaries: WeekSummary[]): number {
  let through = 0;
  for (const s of summaries) if (s.planned) through = s.number;
  return through;
}

export function changedWorkouts(workouts: Workout[]): Workout[] {
  return workouts.filter((w) => w.change).sort((a, b) => a.date.localeCompare(b.date));
}

export function dayLabel(date: string): string {
  return WEEKDAYS_SHORT[weekdayIndex(date)];
}

export function isPast(date: string, today: string): boolean {
  return diffDays(date, today) < 0;
}

export function daysUntil(date: string, today: string): number {
  return diffDays(date, today);
}

export { addDays };

export function changeLabel(meta: PlanMeta, workout: Workout): string {
  return `Wk ${weekNumberFor(meta, workout.date)} · ${dayLabel(workout.date)} · ${workout.title}`;
}
