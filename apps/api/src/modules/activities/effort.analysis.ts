import type { WorkoutStep } from '../workouts/workout.schemas.js';

/**
 * Did the athlete do the prescribed efforts? The prescription is expanded into the segments a
 * watch would record (repeats unrolled) and aligned with the activity's laps by dynamic
 * programming: a segment may span several laps (auto-laps inside a long warm-up, pool lengths
 * inside a swim repeat), may be absent, and stray laps may be left over. Each work segment is
 * then judged on how much of it was done and whether its pace or power was in the target band.
 */

export type Lap = {
  elapsedSeconds: number;
  movingSeconds: number | null;
  distanceMetres: number | null;
  averageSpeed: number | null;
  averageWatts: number | null;
};

/** A target band in comparable terms: speed in metres per second, or watts. */
export type Band = { metric: 'speed' | 'power'; low: number; high: number };

export type Segment = {
  stepId: string;
  label: string;
  role: string | null;
  measure: 'duration' | 'distance' | 'open';
  amount: number | null;
  band: Band | null;
  repeat: { index: number; count: number } | null;
};

export type SegmentResult = Segment & {
  lapIndexes: number[];
  actualSeconds: number | null;
  actualMetres: number | null;
  /** Average speed (m/s) or power (W) over the matched laps, in the band's metric. */
  actualIntensity: number | null;
  completion: number | null;
  status: 'done' | 'short' | 'not_found';
  intensity: 'on_target' | 'above' | 'below' | null;
};

export type EffortVerdict =
  /** Laps line up with the prescription. */
  | 'aligned'
  /** One lap only: no splits to compare against. */
  | 'no_laps'
  /** Automatic kilometre or mile laps hide the intervals. */
  | 'auto_laps'
  /** Laps exist but do not resemble the prescription. */
  | 'unaligned'
  /** Not a structured endurance session (strength, or one effort). */
  | 'not_applicable';

export type EffortAnalysis = {
  verdict: EffortVerdict;
  segments: SegmentResult[];
  /** Key efforts: work reps, or main sets for sessions without reps. */
  work: { planned: number; done: number; onTarget: number; checked: number };
};

const PACE_FACTORS: Record<string, number> = {
  seconds_per_kilometre: 1000,
  seconds_per_mile: 1609.344,
  seconds_per_100_metres: 100,
};
const SPEED_FACTORS: Record<string, number> = {
  metres_per_second: 1,
  kilometres_per_hour: 1 / 3.6,
  miles_per_hour: 0.44704,
};

/** Convert a pace, speed or power target (or resolved zone) into a comparable band. */
export function bandFor(target: WorkoutStep['targets'][number]): Band | null {
  const source =
    target.type === 'zone' && target.resolvedZone
      ? {
          unit: target.resolvedZone.unit,
          min: target.resolvedZone.minimumValue,
          max: target.resolvedZone.maximumValue,
          mid: target.resolvedZone.targetValue,
        }
      : {
          unit: target.unit,
          min: target.minimumValue,
          max: target.maximumValue,
          mid: target.targetValue,
        };
  const low = source.min ?? source.mid;
  const high = source.max ?? source.mid;
  if (low === null || high === null || !source.unit) return null;
  const pace = PACE_FACTORS[source.unit];
  // A slower pace is a lower speed: the band flips.
  if (pace) return { metric: 'speed', low: pace / high, high: pace / low };
  const speed = SPEED_FACTORS[source.unit];
  if (speed) return { metric: 'speed', low: low * speed, high: high * speed };
  if (source.unit === 'watts') return { metric: 'power', low, high };
  return null;
}

const DISTANCE_FACTORS: Record<string, number> = {
  metres: 1,
  kilometres: 1000,
  miles: 1609.344,
  yards: 0.9144,
};

/** Unroll the prescription into recordable segments of one sport. */
export function expandSegments(root: WorkoutStep, discipline: string): Segment[] {
  const segments: Segment[] = [];
  const walk = (step: WorkoutStep, inherited: string | null, repeat: Segment['repeat']) => {
    const sport = step.discipline ?? inherited;
    if (step.kind === 'sequence') {
      for (const child of step.steps) walk(child, sport, repeat);
      return;
    }
    if (step.kind === 'repeat') {
      const count = step.repeatCount ?? 1;
      for (let index = 1; index <= count; index++)
        for (const child of step.steps) walk(child, sport, { index, count });
      return;
    }
    // Rests and transitions ("other") sit between efforts of the activity's sport.
    if (sport !== null && sport !== discipline && sport !== 'other') return;
    const completion = step.completion;
    let measure: Segment['measure'] = 'open';
    let amount: number | null = null;
    if (completion?.type === 'duration' && completion.value !== null) {
      measure = 'duration';
      amount = completion.value * (completion.unit === 'minutes' ? 60 : 1);
    } else if (completion?.type === 'distance' && completion.value !== null) {
      const factor = DISTANCE_FACTORS[completion.unit ?? 'metres'];
      if (factor) {
        measure = 'distance';
        amount = completion.value * factor;
      }
    }
    const band = step.targets.map(bandFor).find((candidate) => candidate !== null) ?? null;
    segments.push({
      stepId: step.id,
      label: step.label ?? step.movement?.name ?? 'Effort',
      role: sport === 'other' && step.role === null ? 'recovery' : step.role,
      measure,
      amount,
      band,
      repeat,
    });
  };
  walk(root, null, null);
  return segments;
}

const isWork = (segment: Segment) => segment.role === 'work';
const lapSeconds = (lap: Lap) => lap.elapsedSeconds;
/** How bad it is to find no laps for a segment: work matters most, short efforts least. */
function missCost(segment: Segment) {
  if (segment.role === 'recovery' || segment.role === 'transition') return 0.25;
  const scale =
    segment.measure === 'duration' && segment.amount !== null
      ? Math.min(1, 0.3 + segment.amount / 180)
      : 1;
  return (isWork(segment) ? 1 : 0.8) * scale;
}
/** A leftover lap: an accidental press costs little, ten unplanned minutes more. */
const extraCost = (lap: Lap) => 0.1 + 0.5 * Math.min(1, lapSeconds(lap) / 300);

function groupMeasure(segment: Segment, laps: Lap[]) {
  if (segment.measure === 'distance')
    return laps.every((lap) => lap.distanceMetres !== null)
      ? laps.reduce((sum, lap) => sum + lap.distanceMetres!, 0)
      : null;
  return laps.reduce((sum, lap) => sum + lapSeconds(lap), 0);
}

/** Average speed (by moving time) or time-weighted power over a group of laps. */
function groupIntensity(band: Band, laps: Lap[]): number | null {
  if (band.metric === 'speed') {
    if (laps.some((lap) => lap.distanceMetres === null)) return null;
    const metres = laps.reduce((sum, lap) => sum + lap.distanceMetres!, 0);
    const moving = laps.reduce((sum, lap) => sum + (lap.movingSeconds ?? lap.elapsedSeconds), 0);
    return moving > 0 ? metres / moving : null;
  }
  const powered = laps.filter((lap) => lap.averageWatts !== null);
  const time = powered.reduce((sum, lap) => sum + lapSeconds(lap), 0);
  return time > 0
    ? powered.reduce((sum, lap) => sum + lap.averageWatts! * lapSeconds(lap), 0) / time
    : null;
}

/** Pace and power are judged with a little give: GPS and power meters are not exact. */
const TOLERANCE = { speed: 0.03, power: 0.05 };

/** How far outside its band a value is, relative to the band; 0 inside. */
function bandMiss(band: Band, value: number) {
  const give = TOLERANCE[band.metric];
  const low = band.low * (1 - give);
  const high = band.high * (1 + give);
  return value < low ? (low - value) / band.low : value > high ? (value - high) / band.high : 0;
}

function matchCost(segment: Segment, laps: Lap[]) {
  const merge = 0.03 * (laps.length - 1);
  // Durations alone are ambiguous (an easy five minutes looks like a five-minute rep), so a
  // lap far outside the segment's band is an unlikely match.
  const intensity = segment.band ? groupIntensity(segment.band, laps) : null;
  const offBand =
    segment.band && intensity !== null ? Math.min(1, 4 * bandMiss(segment.band, intensity)) : 0;
  if (segment.measure === 'open' || segment.amount === null)
    return 0.2 * (laps.length - 1) + offBand;
  const actual = groupMeasure(segment, laps);
  if (actual === null) return 1 + merge;
  return Math.min(2, Math.abs(actual - segment.amount) / segment.amount) + merge + offBand;
}

/** Kilometre or mile auto-laps: every lap but the last the same round distance. */
export function isAutoLapped(laps: Lap[]) {
  if (laps.length < 3) return false;
  const full = laps.slice(0, -1);
  return [1000, 1609.344].some((split) =>
    full.every(
      (lap) => lap.distanceMetres !== null && Math.abs(lap.distanceMetres - split) / split < 0.015,
    ),
  );
}

const MAX_MERGE = 24;

/** Align segments with laps; returns the lap indexes (0-based) given to each segment. */
export function align(segments: Segment[], laps: Lap[]) {
  const n = segments.length;
  const m = laps.length;
  const cost = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array<[number, number]>(m + 1));
  cost[0]![0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const here = cost[i]![j]!;
      if (here === Infinity) continue;
      const relax = (ni: number, nj: number, value: number) => {
        if (value < cost[ni]![nj]!) {
          cost[ni]![nj] = value;
          back[ni]![nj] = [i, j];
        }
      };
      if (j < m) relax(i, j + 1, here + extraCost(laps[j]!));
      if (i < n) {
        // Ties go to stopping early: a missing last rep is likelier than a skipped first one.
        relax(i + 1, j, here + missCost(segments[i]!) + 1e-3 * (n - i));
        for (let k = 1; k <= MAX_MERGE && j + k <= m; k++)
          relax(i + 1, j + k, here + matchCost(segments[i]!, laps.slice(j, j + k)));
      }
    }
  const assigned: number[][] = segments.map(() => []);
  let [i, j] = [n, m];
  while (i > 0 || j > 0) {
    const [pi, pj] = back[i]![j]!;
    if (pi < i && pj < j) for (let lap = pj; lap < j; lap++) assigned[pi]!.push(lap);
    [i, j] = [pi, pj];
  }
  const worst = segments.reduce((sum, segment) => sum + missCost(segment), 0);
  return { assigned, cost: cost[n]![m]!, worst };
}

function judge(segment: Segment, laps: Lap[]): SegmentResult {
  const seconds = laps.length ? laps.reduce((sum, lap) => sum + lapSeconds(lap), 0) : null;
  const metres =
    laps.length && laps.every((lap) => lap.distanceMetres !== null)
      ? laps.reduce((sum, lap) => sum + lap.distanceMetres!, 0)
      : null;
  const actual = laps.length ? groupMeasure(segment, laps) : null;
  const completion =
    segment.measure === 'open' || segment.amount === null || actual === null
      ? null
      : actual / segment.amount;
  const actualIntensity = segment.band && laps.length ? groupIntensity(segment.band, laps) : null;
  let intensity: SegmentResult['intensity'] = null;
  if (segment.band && actualIntensity !== null)
    intensity =
      bandMiss(segment.band, actualIntensity) === 0
        ? 'on_target'
        : actualIntensity > segment.band.high
          ? 'above'
          : 'below';
  return {
    ...segment,
    lapIndexes: [],
    actualSeconds: seconds,
    actualMetres: metres,
    actualIntensity,
    completion,
    status: !laps.length
      ? 'not_found'
      : completion !== null && completion < 0.85
        ? 'short'
        : 'done',
    intensity,
  };
}

/** The efforts a session is judged by: its work reps, or its main sets when it has no reps. */
function keyRole(segments: Segment[]) {
  return segments.some(isWork) ? 'work' : 'main';
}

export function analyzeEfforts(
  prescription: WorkoutStep,
  discipline: string,
  laps: Lap[],
): EffortAnalysis {
  const segments = expandSegments(prescription, discipline);
  const key = keyRole(segments);
  const workSegments = segments.filter((segment) => segment.role === key);
  const empty = (verdict: EffortVerdict): EffortAnalysis => ({
    verdict,
    segments: segments.map((segment) => judge(segment, [])),
    work: { planned: workSegments.length, done: 0, onTarget: 0, checked: 0 },
  });
  if (!['run', 'cycle', 'swim'].includes(discipline) || segments.length < 2)
    return empty('not_applicable');
  if (laps.length < 2) return empty('no_laps');
  if (isAutoLapped(laps) && !segments.every((s) => s.measure === 'distance'))
    return empty('auto_laps');
  const { assigned, cost, worst } = align(segments, laps);
  if (cost > worst * 0.6) return empty('unaligned');
  const results = segments.map((segment, index) => ({
    ...judge(
      segment,
      assigned[index]!.map((lap) => laps[lap]!),
    ),
    lapIndexes: assigned[index]!.map((lap) => lap + 1),
  }));
  const work = results.filter((segment) => segment.role === key);
  return {
    verdict: 'aligned',
    segments: results,
    work: {
      planned: work.length,
      done: work.filter((segment) => segment.status === 'done').length,
      onTarget: work.filter((segment) => segment.intensity === 'on_target').length,
      checked: work.filter((segment) => segment.intensity !== null).length,
    },
  };
}
