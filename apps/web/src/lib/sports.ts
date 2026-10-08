import type { CalibrationEntry, PerformanceState } from '@askesis/api-client';
import {
  Bike,
  Dumbbell,
  Footprints,
  Layers,
  Ship,
  Snowflake,
  Waves,
  Shuffle,
  type LucideIcon,
} from 'lucide-react';
import type { Units } from '../settings';
import {
  formatClock,
  formatDistance,
  formatPace,
  formatPower,
  formatSwimPace,
  METRES_PER_YARD,
  type PoolUnits,
} from './format';

export type System = PerformanceSystem;
type PerformanceSystem = PerformanceState['usedByPlans'][number];
export type BriefSport = 'run' | 'cycle' | 'swim' | 'strength';
export type Sport = BriefSport | 'row' | 'ski_erg' | 'other' | 'mixed';

/** Sports are told apart by icon; colour is reserved for effort. */
export const SPORT_META: Record<Sport, { label: string; noun: string; icon: LucideIcon }> = {
  run: { label: 'Run', noun: 'running', icon: Footprints },
  cycle: { label: 'Ride', noun: 'cycling', icon: Bike },
  swim: { label: 'Swim', noun: 'swimming', icon: Waves },
  strength: { label: 'Strength', noun: 'strength', icon: Dumbbell },
  row: { label: 'Row', noun: 'rowing', icon: Ship },
  ski_erg: { label: 'SkiErg', noun: 'SkiErg', icon: Snowflake },
  other: { label: 'Transition', noun: 'other', icon: Shuffle },
  mixed: { label: 'Multisport', noun: 'multisport', icon: Layers },
};

export const BRIEF_SPORTS: BriefSport[] = ['run', 'cycle', 'swim', 'strength'];

type ZoneMeta = { label: string; short: string; description: string };

/** Performance systems in display order, with their zones from easiest to hardest. */
export const SYSTEM_META: Record<
  System,
  { sport: BriefSport; title: string; noun: string; zones: Record<string, ZoneMeta> }
> = {
  run_pace: {
    sport: 'run',
    title: 'Running pace guides',
    noun: 'pace guides',
    zones: {
      easy: {
        label: 'Easy',
        short: 'E',
        description: 'Relaxed aerobic running, warm-ups, cool-downs and recovery.',
      },
      marathon: {
        label: 'Marathon',
        short: 'M',
        description: 'Sustained running guided by current marathon fitness.',
      },
      threshold: {
        label: 'Threshold',
        short: 'T',
        description: 'Comfortably hard, controlled tempos and cruise intervals.',
      },
      interval: {
        label: 'Interval',
        short: 'I',
        description: 'Hard aerobic repetitions with recovery between efforts.',
      },
      repetition: {
        label: 'Repetition',
        short: 'R',
        description: 'Short, fast, relaxed efforts with generous recovery.',
      },
    },
  },
  cycle_power: {
    sport: 'cycle',
    title: 'Cycling power zones',
    noun: 'power zones',
    zones: {
      recovery: { label: 'Recovery', short: 'Z1', description: 'Very easy spinning to recover.' },
      endurance: {
        label: 'Endurance',
        short: 'Z2',
        description: 'All-day aerobic riding; the base of most weeks.',
      },
      tempo: { label: 'Tempo', short: 'Z3', description: 'Steady, purposeful pressure.' },
      sweet_spot: {
        label: 'Sweet spot',
        short: 'SS',
        description: 'Hard but repeatable; a lot of fitness for the fatigue.',
      },
      threshold: {
        label: 'Threshold',
        short: 'Z4',
        description: 'Around the power you could hold for an hour.',
      },
      vo2max: { label: 'VO2 max', short: 'Z5', description: 'Hard 3–8 minute intervals.' },
      anaerobic: {
        label: 'Anaerobic',
        short: 'Z6',
        description: 'Short, very hard efforts above VO2 max.',
      },
    },
  },
  swim_pace: {
    sport: 'swim',
    title: 'Swim pace zones',
    noun: 'swim paces',
    zones: {
      recovery: {
        label: 'Recovery',
        short: 'R',
        description: 'Easy swimming, drills, warm-ups and recovery.',
      },
      endurance: { label: 'Endurance', short: 'E', description: 'Steady aerobic swimming.' },
      tempo: {
        label: 'Tempo',
        short: 'T',
        description: 'Strong and controlled, just slower than CSS.',
      },
      threshold: {
        label: 'CSS',
        short: 'CSS',
        description: 'Critical swim speed: hard but sustainable.',
      },
      speed: { label: 'Speed', short: 'S', description: 'Fast repeats with full rest.' },
    },
  },
};

export const SYSTEMS = Object.keys(SYSTEM_META) as System[];

export function systemForSport(sport: string | null | undefined): System | null {
  return SYSTEMS.find((system) => SYSTEM_META[system].sport === sport) ?? null;
}

export function zoneLabel(key: string, system?: string | null): string {
  const meta = system ? SYSTEM_META[system as System]?.zones[key] : undefined;
  const fallback = SYSTEMS.map((s) => SYSTEM_META[s].zones[key]).find(Boolean);
  return meta?.label ?? fallback?.label ?? key.replaceAll('_', ' ');
}

export type DisplayUnits = { units: Units; pool: PoolUnits };

/** A zone or target value in its own unit, for display. */
export function formatZoneValue(value: number, unit: string, display: DisplayUnits): string {
  if (unit === 'seconds_per_kilometre') return formatPace(value, display.units);
  if (unit === 'seconds_per_mile') return formatPace(value / 1.609344, display.units);
  if (unit === 'seconds_per_100_metres') return formatSwimPace(value, display.pool);
  if (unit === 'watts') return formatPower(value);
  return `${value} ${unit.replaceAll('_', ' ')}`;
}

/** The evidence behind a calibration entry, in one line. */
export function describeEvidence(entry: CalibrationEntry, display: DisplayUnits): string {
  const input = entry.input;
  const ftp = (watts: number) => `FTP ${formatPower(watts)}`;
  const css = () => {
    const threshold = entry.zones.find((zone) => zone.key === 'threshold');
    return threshold ? ` → CSS ${formatSwimPace(threshold.target, display.pool)}` : '';
  };
  switch (input.method) {
    case 'race_result':
      return `${formatDistance(input.distanceMetres, display.units)} in ${formatClock(input.durationSeconds)}`;
    case 'threshold_pace':
      return `Threshold ${formatPace(input.secondsPerKilometre, display.units)}`;
    case 'ftp':
      return ftp(input.watts);
    case 'twenty_minute_test':
      return `20-minute test at ${formatPower(input.averageWatts)} → ${ftp(input.averageWatts * 0.95)}`;
    case 'ramp_test':
      return `Ramp test best minute ${formatPower(input.bestMinuteWatts)} → ${ftp(input.bestMinuteWatts * 0.75)}`;
    case 'css_test': {
      // Stored as metric 400 m / 200 m times; a yard pool covers 0.9144 of each at the same speed.
      const factor = display.pool === 'yd' ? METRES_PER_YARD : 1;
      const time = (seconds: number) => formatClock(seconds * factor);
      return `400 ${display.pool} in ${time(input.t400Seconds)}, 200 ${display.pool} in ${time(input.t200Seconds)}${css()}`;
    }
    case 'css_pace':
      return `CSS ${formatSwimPace(input.secondsPer100Metres, display.pool)}`;
  }
}

/** Entries the athlete supplied as a guess, or the coach estimated, rather than measured. */
export function isEstimate(entry: CalibrationEntry): boolean {
  return (
    entry.provenance === 'agent_estimate' ||
    entry.provenance === 'user_estimate' ||
    entry.input.method === 'threshold_pace'
  );
}

/** The entry in effect today for a system, if the athlete has one. */
export function currentEntry(
  state: PerformanceState | undefined,
  system: System,
): CalibrationEntry | undefined {
  return state?.current.find((entry) => entry.system === system);
}

/** Systems a set of sports resolves zones in, in display order. */
export function systemsForSports(sports: Iterable<string>): System[] {
  const set = new Set(sports);
  return SYSTEMS.filter((system) => set.has(SYSTEM_META[system].sport));
}

/** Sports a plan trains: those in its brief plus any its workouts name directly. */
export function planSports(
  brief: { sports: { sport: string }[] } | undefined,
  workouts: { discipline: string }[] | undefined,
): string[] {
  return [
    ...new Set([
      ...(brief?.sports.map((sport) => sport.sport) ?? []),
      ...(workouts?.map((workout) => workout.discipline) ?? []),
    ]),
  ];
}
