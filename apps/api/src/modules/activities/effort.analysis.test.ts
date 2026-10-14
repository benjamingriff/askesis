import { describe, expect, it } from 'vitest';
import type { WorkoutStep } from '../workouts/workout.schemas.js';
import {
  analyzeEfforts,
  bandFor,
  expandSegments,
  isAutoLapped,
  type Lap,
} from './effort.analysis.js';

let ids = 0;
const id = () => `00000000-0000-0000-0000-${String(++ids).padStart(12, '0')}`;
const zone = (unit: string, minimumValue: number, maximumValue: number) => ({
  type: 'zone' as const,
  minimumValue: null,
  targetValue: null,
  maximumValue: null,
  unit: null,
  zoneSystem: 'cycle_power',
  zoneKey: 'tempo',
  text: null,
  resolvedZone: {
    calibrationId: id(),
    effectiveFrom: '2026-10-01',
    calculatorVersion: 'v1',
    method: 'ftp',
    metric: unit === 'watts' ? 'power' : 'pace',
    minimumValue,
    targetValue: null,
    maximumValue,
    unit,
  },
});
function effort(
  role: string,
  seconds: number | null,
  options: { metres?: number; discipline?: string; targets?: WorkoutStep['targets'] } = {},
): WorkoutStep {
  return {
    id: id(),
    kind: 'effort',
    role,
    discipline: options.discipline ?? null,
    repeatCount: null,
    label: role,
    instructions: null,
    movement: null,
    completion:
      options.metres !== undefined
        ? {
            type: 'distance',
            value: options.metres,
            unit: 'metres',
            conditionType: null,
            conditionValue: null,
          }
        : seconds === null
          ? { type: 'open', value: null, unit: null, conditionType: null, conditionValue: null }
          : {
              type: 'duration',
              value: seconds,
              unit: 'seconds',
              conditionType: null,
              conditionValue: null,
            },
    targets: options.targets ?? [],
    steps: [],
  };
}
const node = (
  kind: 'sequence' | 'repeat',
  steps: WorkoutStep[],
  repeatCount: number | null = null,
) =>
  ({ ...effort('x', null), kind, role: null, completion: null, repeatCount, steps }) as WorkoutStep;

/** Warm-up, 3 × (5 min tempo at 200–220 W, 3 min easy), cool-down: the example plan's ride. */
const tempo = node('sequence', [
  { ...effort('warmup', 600), discipline: 'cycle' },
  node(
    'repeat',
    [effort('work', 300, { targets: [zone('watts', 200, 220)] }), effort('recovery', 180)],
    3,
  ),
  effort('cooldown', 300),
]);
const lap = (seconds: number, watts: number | null = null, metres: number | null = null): Lap => ({
  elapsedSeconds: seconds,
  movingSeconds: seconds,
  distanceMetres: metres,
  averageSpeed: metres === null ? null : metres / seconds,
  averageWatts: watts,
});

describe('effort analysis', () => {
  it('unrolls repeats and converts pace zones into speed bands', () => {
    const segments = expandSegments(tempo, 'cycle');
    expect(
      segments.map((s) => `${s.role}${s.repeat ? ` ${s.repeat.index}/${s.repeat.count}` : ''}`),
    ).toEqual([
      'warmup',
      'work 1/3',
      'recovery 1/3',
      'work 2/3',
      'recovery 2/3',
      'work 3/3',
      'recovery 3/3',
      'cooldown',
    ]);
    // 4:00–5:00/km is 3.33–4.17 m/s.
    const band = bandFor(zone('seconds_per_kilometre', 240, 300));
    expect(band!.metric).toBe('speed');
    expect(band!.low).toBeCloseTo(1000 / 300);
    expect(band!.high).toBeCloseTo(1000 / 240);
  });

  it('confirms every rep from interval laps and flags one ridden too easy', () => {
    const laps = [
      lap(605, 150),
      lap(300, 212),
      lap(180, 120),
      lap(298, 209),
      lap(181, 118),
      lap(302, 181),
      lap(178, 110),
      lap(310, 130),
    ];
    const analysis = analyzeEfforts(tempo, 'cycle', laps);
    expect(analysis.verdict).toBe('aligned');
    expect(analysis.work).toEqual({ planned: 3, done: 3, onTarget: 2, checked: 3 });
    const third = analysis.segments.filter((s) => s.role === 'work')[2]!;
    expect(third).toMatchObject({ intensity: 'below', lapIndexes: [6], status: 'done' });
  });

  it('merges split laps and reports reps that never happened', () => {
    // Warm-up recorded as two laps; the athlete stopped after the second rep.
    const laps = [
      lap(300, 150),
      lap(300, 150),
      lap(300, 215),
      lap(180, 120),
      lap(300, 214),
      lap(400, 120),
    ];
    const analysis = analyzeEfforts(tempo, 'cycle', laps);
    expect(analysis.verdict).toBe('aligned');
    expect(analysis.segments[0]!.lapIndexes).toEqual([1, 2]);
    expect(analysis.work).toMatchObject({ planned: 3, done: 2 });
    expect(analysis.segments.filter((s) => s.role === 'work')[2]!.status).toBe('not_found');
  });

  it('declines to judge reps from a single lap or kilometre auto-laps', () => {
    expect(analyzeEfforts(tempo, 'cycle', [lap(3000, 170)]).verdict).toBe('no_laps');
    const auto = [
      lap(300, null, 1000),
      lap(290, null, 1000),
      lap(295, null, 1000),
      lap(100, null, 400),
    ];
    expect(isAutoLapped(auto)).toBe(true);
    const run = node('sequence', [
      effort('warmup', 600, { discipline: 'run' }),
      node('repeat', [effort('work', 180), effort('recovery', 90)], 4),
    ]);
    expect(analyzeEfforts(run, 'run', auto).verdict).toBe('auto_laps');
    expect(analyzeEfforts(effort('main', 3600, { discipline: 'run' }), 'run', auto).verdict).toBe(
      'not_applicable',
    );
  });

  it('aligns pool lengths to distance repeats and ignores the other sport of a brick', () => {
    const swim = node('sequence', [
      effort('warmup', null, { metres: 200, discipline: 'swim' }),
      node(
        'repeat',
        [effort('work', null, { metres: 100 }), { ...effort('recovery', 20), discipline: 'other' }],
        4,
      ),
    ]);
    // 25 m lengths, rests recorded as their own zero-distance laps.
    const length = (s: number) => lap(s, null, 25);
    const rest = lap(20, null, 0);
    const laps = [
      ...Array(8).fill(length(30)),
      ...[1, 2, 3, 4].flatMap(() => [...Array(4).fill(length(22)), rest]),
    ];
    const analysis = analyzeEfforts(swim, 'swim', laps);
    expect(analysis.verdict).toBe('aligned');
    expect(analysis.work).toMatchObject({ planned: 4, done: 4 });
    const brick = node('sequence', [
      effort('main', 3000, { discipline: 'cycle' }),
      effort('transition', 120, { discipline: 'other' }),
      effort('main', 900, { discipline: 'run' }),
    ]);
    expect(expandSegments(brick, 'run').map((s) => s.role)).toEqual(['transition', 'main']);
  });

  it('calls laps that resemble nothing in the prescription unaligned', () => {
    const laps = [lap(40, 300), lap(1500, 140), lap(45, 310), lap(2000, 150)];
    expect(analyzeEfforts(tempo, 'cycle', laps).verdict).toBe('unaligned');
  });
});
