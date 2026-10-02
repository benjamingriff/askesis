import type { EffortStep, Step, Workout, Zone } from '../data/types';
import type { Units } from '../state/settings';

/** Seconds per km. The prototype's calibration: a ~1:45 half-marathoner, estimated. */
export const PACE_GUIDES: Record<Zone, { min: number; max: number; label: string; feel: string }> =
  {
    recovery: { min: 390, max: 430, label: 'Recovery', feel: 'Very gentle, fully conversational' },
    easy: { min: 350, max: 390, label: 'Easy', feel: 'Conversational, nose-breathing most of it' },
    steady: { min: 325, max: 345, label: 'Steady', feel: 'Purposeful but sustainable for hours' },
    tempo: { min: 298, max: 310, label: 'Tempo', feel: 'Comfortably hard, short sentences only' },
    threshold: {
      min: 280,
      max: 290,
      label: 'Threshold',
      feel: 'Hard, controlled; a few words at a time',
    },
    interval: {
      min: 255,
      max: 270,
      label: 'Interval',
      feel: 'Fast and strong, with full recoveries',
    },
  };

export const ZONE_ORDER: Zone[] = ['recovery', 'easy', 'steady', 'tempo', 'threshold', 'interval'];

export const ZONE_INTENSITY: Record<Zone, number> = {
  recovery: 0.22,
  easy: 0.4,
  steady: 0.55,
  tempo: 0.72,
  threshold: 0.85,
  interval: 1,
};

export const midPace = (zone: Zone) => (PACE_GUIDES[zone].min + PACE_GUIDES[zone].max) / 2;

export type Segment = { seconds: number; zone: Zone | null; role: EffortStep['role'] };

function effortTotals(step: EffortStep): { meters: number; seconds: number } {
  if (step.meters != null) {
    const pace = midPace(step.zone ?? 'easy');
    return { meters: step.meters, seconds: (step.meters / 1000) * pace };
  }
  const seconds = step.seconds ?? 0;
  if (step.zone) {
    return { meters: (seconds / midPace(step.zone)) * 1000, seconds };
  }
  return { meters: 0, seconds };
}

export function stepTotals(steps: Step[]): { meters: number; seconds: number } {
  let meters = 0;
  let seconds = 0;
  for (const step of steps) {
    if (step.type === 'effort') {
      const t = effortTotals(step);
      meters += t.meters;
      seconds += t.seconds;
    } else {
      const t = stepTotals(step.steps);
      meters += t.meters * step.count;
      seconds += t.seconds * step.count;
    }
  }
  return { meters, seconds };
}

export function workoutTotals(workout: Pick<Workout, 'steps'>) {
  return stepTotals(workout.steps);
}

/** Flatten a step tree into chart segments, expanding repeats. */
export function flattenSegments(steps: Step[]): Segment[] {
  const out: Segment[] = [];
  for (const step of steps) {
    if (step.type === 'effort') {
      out.push({
        seconds: Math.max(effortTotals(step).seconds, 1),
        zone: step.zone ?? null,
        role: step.role,
      });
    } else {
      const inner = flattenSegments(step.steps);
      for (let i = 0; i < step.count; i++) out.push(...inner);
    }
  }
  return out;
}

export function isHard(kind: Workout['kind']): boolean {
  return kind === 'tempo' || kind === 'intervals' || kind === 'race';
}

// ---- Formatting -----------------------------------------------------------------------------

const KM_PER_MILE = 1.609344;

export function distanceValue(meters: number, units: Units): number {
  return units === 'km' ? meters / 1000 : meters / 1000 / KM_PER_MILE;
}

export function formatDistance(meters: number, units: Units, withUnit = true): string {
  const v = distanceValue(meters, units);
  const text = v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '');
  return withUnit ? `${text} ${units}` : text;
}

export function formatPace(secPerKm: number, units: Units, withUnit = true): string {
  const s = units === 'km' ? secPerKm : secPerKm * KM_PER_MILE;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  const [mm, ss] = sec === 60 ? [m + 1, 0] : [m, sec];
  const text = `${mm}:${String(ss).padStart(2, '0')}`;
  return withUnit ? `${text} /${units}` : text;
}

export function formatPaceRange(zone: Zone, units: Units): string {
  const { min, max } = PACE_GUIDES[zone];
  return `${formatPace(min, units, false)}–${formatPace(max, units, false)} /${units}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatClock(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

export function formatCompletion(step: EffortStep, units: Units): string {
  if (step.meters != null) {
    return step.meters < 1000 && units === 'km'
      ? `${Math.round(step.meters)} m`
      : formatDistance(step.meters, units);
  }
  if (step.seconds != null) {
    return step.seconds < 120 ? `${step.seconds} sec` : `${Math.round(step.seconds / 60)} min`;
  }
  return 'Open';
}
