import type { LoadDay, LoadMethod, LoadSport, LoadWeek, LoadWorkout, PlanLoad } from '../src/types';
import { asArray, asNumber, asString, isObject, objects, type Json } from './json';

// Training stress from the saved prescriptions, using TrainingPeaks-style formulas:
// TSS = hours × IF² × 100 for running (rTSS) and cycling, hours × IF³ × 100 for
// swimming (sTSS). IF is effort relative to threshold: threshold pace ÷ step pace,
// target watts ÷ FTP, or CSS ÷ swim pace. Fitness and fatigue are 42- and 7-day
// exponentially weighted averages of daily stress. Nothing here passes or fails a
// plan; it only describes what was prescribed.

const SPORTS: LoadSport[] = ['run', 'cycle', 'swim', 'strength', 'other'];
const FITNESS_DAYS = 42;
const FATIGUE_DAYS = 7;
/** Session RPE (1–10) to intensity factor, for steps without pace or power. */
const RPE_IF = [0, 0.5, 0.55, 0.6, 0.7, 0.75, 0.8, 0.87, 0.93, 1, 1.08];
/** Zone keys without a resolved calibration fall back to their usual intensity. */
const ZONE_IF: Record<string, number> = {
  easy: 0.72,
  marathon: 0.85,
  threshold: 1,
  interval: 1.08,
  repetition: 1.15,
  recovery: 0.5,
  endurance: 0.68,
  tempo: 0.83,
  sweet_spot: 0.91,
  vo2max: 1.13,
  anaerobic: 1.3,
  speed: 1.1,
};
/** Assumed intensity of stated baseline riding; runs and swims use their easy pace. */
const BASELINE_CYCLE_IF = 0.65;
/** Upper intensity factors of the easy and moderate bands; roughly the first and second thresholds. */
const EASY_BELOW = 0.85;
const MODERATE_BELOW = 0.95;
const DEFAULT_PACE = { run: 390, swim: 150 };

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - weekday);
}

function sportOf(value: string | null): LoadSport {
  return value === 'run' || value === 'cycle' || value === 'swim' || value === 'strength'
    ? value
    : 'other';
}

/** Threshold values in effect, read from the athlete's current calibrations. */
export function thresholds(performance: Json | null) {
  const current = objects(performance?.current);
  const threshold = (system: string) =>
    asNumber(
      objects(current.find((entry) => entry.system === system)?.zones).find(
        (zone) => zone.key === 'threshold',
      )?.target,
    );
  return {
    runPace: threshold('run_pace'),
    ftp: threshold('cycle_power'),
    cssPace: threshold('swim_pace'),
    easyRunPace: asNumber(
      objects(current.find((entry) => entry.system === 'run_pace')?.zones).find(
        (zone) => zone.key === 'easy',
      )?.target,
    ),
  };
}
type Thresholds = ReturnType<typeof thresholds>;

interface Effort {
  sport: LoadSport;
  repeat: number;
  completion: Json | null;
  targets: Json[];
}

function efforts(step: unknown, sport: LoadSport, repeat: number): Effort[] {
  if (!isObject(step)) return [];
  const own = step.discipline ? sportOf(asString(step.discipline)) : sport;
  const times = repeat * (step.kind === 'repeat' ? (asNumber(step.repeatCount) ?? 1) : 1);
  if (step.kind === 'effort')
    return [
      {
        sport: own,
        repeat: times,
        completion: isObject(step.completion) ? step.completion : null,
        targets: objects(step.targets),
      },
    ];
  return asArray(step.steps).flatMap((child) => efforts(child, own, times));
}

/** Intensity and speed of one effort: IF, plus seconds per metre when a pace is known. */
function intensity(effort: Effort, limits: Thresholds) {
  let factor: number | null = null;
  let secondsPerMetre: number | null = null;
  let method: LoadMethod = 'unestimated';
  for (const target of effort.targets) {
    const resolved = isObject(target.resolvedZone) ? target.resolvedZone : null;
    const value = asNumber(resolved?.targetValue) ?? asNumber(target.targetValue);
    const unit = asString(resolved?.unit) ?? asString(target.unit);
    if (value !== null && unit === 'seconds_per_kilometre') {
      secondsPerMetre = value / 1000;
      if (limits.runPace !== null) [factor, method] = [limits.runPace / value, 'targets'];
    } else if (value !== null && unit === 'seconds_per_100_metres') {
      secondsPerMetre = value / 100;
      if (limits.cssPace !== null) [factor, method] = [limits.cssPace / value, 'targets'];
    } else if (value !== null && unit === 'watts' && limits.ftp !== null)
      [factor, method] = [value / limits.ftp, 'targets'];
    if (factor !== null) break;
  }
  if (factor === null) {
    const rpe = effort.targets.find((target) => target.type === 'rpe');
    const zone = asString(effort.targets.find((target) => target.type === 'zone')?.zoneKey);
    const rpeValue = asNumber(rpe?.targetValue) ?? asNumber(rpe?.value);
    if (rpeValue !== null) [factor, method] = [RPE_IF[Math.round(rpeValue)] ?? 0.75, 'rpe'];
    else if (zone && ZONE_IF[zone] !== undefined && effort.sport !== 'strength')
      [factor, method] = [ZONE_IF[zone]!, 'zone_default'];
  }
  // Strength counts as time only unless the step states an RPE.
  if (effort.sport === 'strength' && method !== 'rpe') [factor, method] = [null, 'not_counted'];
  if (secondsPerMetre === null && (effort.sport === 'run' || effort.sport === 'swim')) {
    const zone = effort.sport === 'run' ? limits.easyRunPace : limits.cssPace;
    secondsPerMetre =
      ((zone ?? DEFAULT_PACE[effort.sport]) * (effort.sport === 'swim' ? 1.1 : 1)) /
      (effort.sport === 'run' ? 1000 : 100);
  }
  return { factor, secondsPerMetre, method };
}

const stress = (sport: LoadSport, seconds: number, factor: number) =>
  (seconds / 3600) * factor ** (sport === 'swim' ? 3 : 2) * 100;

function workoutLoad(entry: Json, limits: Thresholds): LoadWorkout | null {
  const workout = isObject(entry.workout) ? entry.workout : {};
  const date = asString(workout.scheduledDate);
  if (!date) return null;
  const sport = sportOf(asString(workout.discipline));
  const estimatedSeconds = asNumber(workout.estimatedDurationSeconds);
  const estimatedMetres = asNumber(workout.estimatedDistanceMetres);
  const steps = efforts(entry.prescription, sport, 1);
  let seconds = 0;
  let metres = 0;
  let tss = 0;
  let timed = 0;
  let weighted = 0;
  let counted = 0;
  const intensityTime = { easy: 0, moderate: 0, hard: 0, uncounted: 0 };
  const countIntensity = (duration: number, factor: number | null) => {
    const band =
      factor === null
        ? 'uncounted'
        : factor < EASY_BELOW
          ? 'easy'
          : factor < MODERATE_BELOW
            ? 'moderate'
            : 'hard';
    intensityTime[band] += duration;
  };
  let untimed = false;
  const methods = new Set<LoadMethod>();
  for (const effort of steps) {
    const { factor, secondsPerMetre, method } = intensity(effort, limits);
    const type = asString(effort.completion?.type);
    const value = asNumber(effort.completion?.value) ?? 0;
    let effortSeconds: number | null = null;
    let effortMetres: number | null = null;
    if (type === 'duration') {
      effortSeconds = value;
      if (secondsPerMetre) effortMetres = value / secondsPerMetre;
    } else if (type === 'distance') {
      effortMetres = value;
      if (secondsPerMetre) effortSeconds = value * secondsPerMetre;
    }
    if (effortMetres !== null && effort.sport !== 'strength')
      metres += effortMetres * effort.repeat;
    if (effortSeconds === null) {
      untimed = true;
      continue;
    }
    const total = effortSeconds * effort.repeat;
    seconds += total;
    timed += 1;
    methods.add(method);
    countIntensity(total, factor);
    if (factor === null) continue;
    tss += stress(effort.sport, total, factor);
    weighted += factor * total;
    counted += total;
  }
  // Without timed steps, fall back to the coach's own estimate at the main step's intensity.
  let method: LoadMethod;
  let factor: number | null = null;
  if (timed === 0) {
    const first = steps[0];
    const guess = first ? intensity(first, limits) : null;
    seconds = estimatedSeconds ?? 0;
    metres = sport === 'strength' ? 0 : (estimatedMetres ?? 0);
    factor = guess?.factor ?? null;
    method =
      guess?.method === 'not_counted'
        ? 'not_counted'
        : estimatedSeconds === null || factor === null
          ? 'unestimated'
          : 'estimate';
    if (factor !== null && method === 'estimate') tss = stress(sport, seconds, factor);
    countIntensity(seconds, factor);
  } else {
    method = methods.has('targets')
      ? 'targets'
      : methods.has('rpe')
        ? 'rpe'
        : methods.has('zone_default')
          ? 'zone_default'
          : methods.has('not_counted')
            ? 'not_counted'
            : 'unestimated';
    // Time-weighted intensity of the counted steps, for the easy/moderate/hard split.
    factor = counted > 0 ? weighted / counted : null;
    if (metres === 0 && estimatedMetres !== null && sport !== 'strength') metres = estimatedMetres;
    // Repetition-based work can have timed rests. Those rests are only part of the session;
    // retain the coach's total duration and leave the unknown work unscored.
    if (untimed && estimatedSeconds !== null && estimatedSeconds > seconds) {
      intensityTime.uncounted += estimatedSeconds - seconds;
      seconds = estimatedSeconds;
      method = sport === 'strength' && counted === 0 ? 'not_counted' : 'unestimated';
    }
  }
  return {
    id: asString(workout.id) ?? '',
    date,
    title: asString(workout.title) ?? 'Workout',
    sport,
    seconds: Math.round(seconds),
    metres: Math.round(metres),
    tss: Math.round(tss * 10) / 10,
    intensityFactor: factor === null ? null : Math.round(factor * 100) / 100,
    method,
    intensity: intensityTime,
  };
}

/** The athlete's stated pre-plan training as daily stress, assuming easy effort. */
function baselineLoad(scenario: Json | null, limits: Thresholds) {
  const persona = isObject(scenario?.persona) ? scenario.persona : null;
  const expectations = isObject(scenario?.expectations) ? scenario.expectations : {};
  const sports = persona
    ? objects(persona.sports)
    : asNumber(expectations.weeklyDistanceMetres) !== null
      ? [{ sport: 'run', weeklyDistanceMetres: expectations.weeklyDistanceMetres }]
      : [];
  let weeklyTss = 0;
  let weeklySeconds = 0;
  let weeklyMetres = 0;
  const parts: string[] = [];
  for (const sport of sports) {
    const name = asString(sport.sport);
    if (name === 'run' || name === 'swim') {
      const metres = asNumber(sport.weeklyDistanceMetres);
      if (!metres) continue;
      const pace =
        name === 'run'
          ? (limits.easyRunPace ?? DEFAULT_PACE.run) / 1000
          : ((limits.cssPace ?? DEFAULT_PACE.swim) * 1.1) / 100;
      const seconds = metres * pace;
      // Baseline easy effort uses the same pace-to-threshold ratio as prescribed easy steps.
      const factor =
        name === 'run'
          ? limits.runPace !== null && limits.easyRunPace !== null
            ? limits.runPace / limits.easyRunPace
            : 0.75
          : 1 / 1.1;
      weeklySeconds += seconds;
      weeklyMetres += metres;
      weeklyTss += stress(name, seconds, factor);
      parts.push(`${name} ${Math.round(metres / 100) / 10} km`);
    } else if (name === 'cycle') {
      const seconds = asNumber(sport.weeklyDurationSeconds);
      if (!seconds) continue;
      weeklySeconds += seconds;
      weeklyTss += stress('cycle', seconds, BASELINE_CYCLE_IF);
      parts.push(`cycle ${Math.round(seconds / 60)} min`);
    }
  }
  if (weeklyTss === 0) return null;
  return {
    weeklyTss: Math.round(weeklyTss),
    weeklySeconds: Math.round(weeklySeconds),
    weeklyMetres: Math.round(weeklyMetres),
    assumption: `Stated weekly training (${parts.join(', ')}) assumed at easy effort; strength excluded.`,
  };
}

export function buildLoad(
  plan: Json | null,
  performance: Json | null,
  scenario: Json | null,
): PlanLoad | null {
  if (!plan) return null;
  const limits = thresholds(performance);
  const workouts = objects(plan.workouts)
    .map((entry) => workoutLoad(entry, limits))
    .filter((workout): workout is LoadWorkout => workout !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = isObject(scenario?.dates) ? scenario.dates : {};
  const header = isObject(plan.header) && isObject(plan.header.draft) ? plan.header.draft : {};
  const start = asString(dates.startDate) ?? asString(header.startDate) ?? workouts[0]?.date;
  if (!start || workouts.length === 0) return null;
  const coverageEnd = asString(dates.coverageEndDate);
  const last = [workouts.at(-1)!.date, coverageEnd ?? ''].sort().at(-1)!;
  const end = addDays(mondayOf(last), 6);
  const baseline = baselineLoad(scenario, limits);
  let fitness = (baseline?.weeklyTss ?? 0) / 7;
  let fatigue = fitness;
  const days: LoadDay[] = [];
  for (let date = mondayOf(start); date <= end; date = addDays(date, 1)) {
    const own = workouts.filter((workout) => workout.date === date);
    const sports = Object.fromEntries(
      SPORTS.flatMap((sport) => {
        const items = own.filter((workout) => workout.sport === sport);
        if (!items.length) return [];
        const sum = (key: 'seconds' | 'metres' | 'tss') =>
          items.reduce((total, item) => total + item[key], 0);
        return [[sport, { seconds: sum('seconds'), metres: sum('metres'), tss: sum('tss') }]];
      }),
    );
    const tss = own.reduce((total, workout) => total + workout.tss, 0);
    fitness += (tss - fitness) / FITNESS_DAYS;
    fatigue += (tss - fatigue) / FATIGUE_DAYS;
    days.push({
      date,
      sports,
      seconds: own.reduce((total, workout) => total + workout.seconds, 0),
      metres: own.reduce((total, workout) => total + workout.metres, 0),
      tss: Math.round(tss * 10) / 10,
      fitness: Math.round(fitness * 10) / 10,
      fatigue: Math.round(fatigue * 10) / 10,
      form: Math.round((fitness - fatigue) * 10) / 10,
    });
  }
  const weeks: LoadWeek[] = [];
  for (let index = 0; index * 7 < days.length; index++) {
    const own = days.slice(index * 7, index * 7 + 7);
    const startDate = own[0]!.date;
    const ownWorkouts = workouts.filter(
      (workout) => workout.date >= startDate && workout.date <= own.at(-1)!.date,
    );
    const bandSeconds = (band: keyof LoadWeek['intensity']) =>
      ownWorkouts.reduce((total, workout) => total + workout.intensity[band], 0);
    const sports: LoadWeek['sports'] = {};
    for (const day of own)
      for (const [sport, value] of Object.entries(day.sports)) {
        const entry = (sports[sport as LoadSport] ??= { seconds: 0, metres: 0, tss: 0 });
        entry.seconds += value.seconds;
        entry.metres += value.metres;
        entry.tss += value.tss;
      }
    weeks.push({
      index: index + 1,
      start: startDate,
      sports,
      seconds: own.reduce((total, day) => total + day.seconds, 0),
      metres: own.reduce((total, day) => total + day.metres, 0),
      tss: Math.round(own.reduce((total, day) => total + day.tss, 0) * 10) / 10,
      fitness: own.at(-1)!.fitness,
      fatigue: own.at(-1)!.fatigue,
      form: own.at(-1)!.form,
      intensity: {
        easy: bandSeconds('easy'),
        moderate: bandSeconds('moderate'),
        hard: bandSeconds('hard'),
        uncounted: bandSeconds('uncounted'),
      },
    });
  }
  const methods: Partial<Record<LoadMethod, number>> = {};
  for (const workout of workouts) methods[workout.method] = (methods[workout.method] ?? 0) + 1;
  return {
    start: days[0]!.date,
    end,
    coverageEnd,
    events: objects(scenario?.events).flatMap((event) => {
      const date = asString(event.date);
      return date ? [{ date, label: asString(event.label) ?? 'Event' }] : [];
    }),
    baseline,
    thresholds: {
      runPaceSecondsPerKm: limits.runPace,
      ftpWatts: limits.ftp,
      cssSecondsPer100m: limits.cssPace,
    },
    days,
    weeks,
    workouts,
    methods,
  };
}
