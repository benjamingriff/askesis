import { describe, expect, it } from 'vitest';
import { buildLoad } from './load';
import { normalizeScenario, requiredFacts } from './scenario';

const zones = (system: string, threshold: number, easy = threshold) => ({
  system,
  zones: [
    { key: 'easy', target: easy },
    { key: 'threshold', target: threshold },
  ],
});
const performance = {
  current: [zones('run_pace', 300, 400), zones('cycle_power', 200), zones('swim_pace', 100)],
};
const effort = (
  discipline: string,
  completion: Record<string, unknown>,
  target: Record<string, unknown>,
) => ({ kind: 'effort', discipline, completion, targets: [target], steps: [] });
const resolved = (unit: string, value: number) => ({
  type: 'zone',
  resolvedZone: { unit, targetValue: value },
});
const workout = (id: string, date: string, discipline: string, prescription: unknown) => ({
  workout: {
    id,
    scheduledDate: date,
    discipline,
    title: id,
    estimatedDurationSeconds: 3600,
    estimatedDistanceMetres: null,
  },
  prescription,
});

describe('training load', () => {
  const plan = {
    workouts: [
      // One hour at threshold pace is 100 by definition, and covers 12 km at 5:00/km.
      workout(
        'run',
        '2026-10-19',
        'run',
        effort('run', { type: 'duration', value: 3600 }, resolved('seconds_per_kilometre', 300)),
      ),
      // Half an hour at 80% of FTP: 0.5 × 0.8² × 100 = 32.
      workout(
        'ride',
        '2026-10-20',
        'cycle',
        effort('cycle', { type: 'duration', value: 1800 }, resolved('watts', 160)),
      ),
      // Swimming cubes IF: 1000 m at CSS takes 1000 s, so (1000/3600) × 1 × 100 ≈ 27.8.
      workout(
        'swim',
        '2026-10-21',
        'swim',
        effort('swim', { type: 'distance', value: 1000 }, resolved('seconds_per_100_metres', 100)),
      ),
      // Strength counts as time only without an RPE.
      workout(
        'lift',
        '2026-10-22',
        'strength',
        effort('strength', { type: 'repetitions', value: 10 }, { type: 'rir', value: 2 }),
      ),
      // A repeat of 4 × 5 minutes at RPE 9 (IF 1.0): 20 minutes is 33.3.
      workout('reps', '2026-10-23', 'run', {
        kind: 'repeat',
        repeatCount: 4,
        steps: [effort('run', { type: 'duration', value: 300 }, { type: 'rpe', targetValue: 9 })],
      }),
    ],
  };
  const scenario = normalizeScenario({
    edition: 'v1',
    persona: { sports: [{ sport: 'run', weeklyDistanceMetres: 21000 }], availability: [] },
    dates: { startDate: '2026-10-19', coverageEndDate: '2026-11-01', endDate: '2027-01-10' },
    events: [{ label: 'Race', date: '2027-01-10' }],
    expectations: { requiredDiscovery: ['goal'] },
  });
  const load = buildLoad(plan, performance, scenario)!;
  const byId = Object.fromEntries(load.workouts.map((item) => [item.id, item]));

  it('scores each sport from its targets against threshold', () => {
    expect(byId.run).toMatchObject({
      tss: 100,
      metres: 12000,
      intensityFactor: 1,
      method: 'targets',
    });
    expect(byId.ride).toMatchObject({ tss: 32, method: 'targets' });
    expect(byId.swim!.tss).toBeCloseTo(27.8, 1);
    expect(byId.swim!.seconds).toBe(1000);
    expect(byId.lift).toMatchObject({ tss: 0, seconds: 3600, method: 'not_counted' });
    expect(byId.reps).toMatchObject({ seconds: 1200, method: 'rpe' });
    expect(byId.reps!.tss).toBeCloseTo(33.3, 1);
  });

  it('seeds fitness and fatigue from the stated baseline at easy effort', () => {
    // 21 km at the 6:40/km easy pace is 2⅓ h; at IF 0.75 that is about 131 a week.
    expect(load.baseline?.weeklyTss).toBe(131);
    expect(load.days[0]!.date).toBe('2026-10-19');
    expect(load.days[0]!.fitness).toBeGreaterThan(18);
    expect(load.weeks).toHaveLength(2);
    expect(load.weeks[0]!.tss).toBeCloseTo(100 + 32 + 27.8 + 33.3, 0);
    expect(load.weeks[1]!.tss).toBe(0);
    // A week without training lets fatigue fall below fitness.
    expect(load.weeks[1]!.form).toBeGreaterThan(load.weeks[0]!.form);
    expect(load.events).toEqual([{ label: 'Race', date: '2027-01-10' }]);
  });

  it('reads both dataset scenarios and the retired running-poc format', () => {
    expect(requiredFacts(scenario)).toEqual(['goal']);
    const legacy = normalizeScenario({ expectations: {}, dates: { eventDate: '2027-01-03' } });
    expect(requiredFacts(legacy)).toContain('fitness');
    expect(legacy?.events).toEqual([{ label: 'Goal race', date: '2027-01-03' }]);
  });

  it('keeps hard intervals separate from easy time in the weekly split', () => {
    const mixed = buildLoad(
      {
        workouts: [
          workout('intervals', '2026-10-19', 'run', {
            kind: 'sequence',
            steps: [
              effort(
                'run',
                { type: 'duration', value: 2400 },
                resolved('seconds_per_kilometre', 400),
              ),
              effort(
                'run',
                { type: 'duration', value: 600 },
                resolved('seconds_per_kilometre', 300),
              ),
            ],
          }),
        ],
      },
      performance,
      scenario,
    )!;
    expect(mixed.weeks[0]!.intensity).toEqual({ easy: 2400, moderate: 0, hard: 600, uncounted: 0 });
  });

  it('does not mistake timed rests for a whole repetition-based strength session', () => {
    const lift = buildLoad(
      {
        workouts: [
          workout('lift', '2026-10-19', 'strength', {
            kind: 'repeat',
            repeatCount: 3,
            steps: [
              effort('strength', { type: 'repetitions', value: 10 }, { type: 'rir', value: 2 }),
              effort('strength', { type: 'duration', value: 60 }, {}),
            ],
          }),
        ],
      },
      performance,
      scenario,
    )!;
    expect(lift.workouts[0]).toMatchObject({ seconds: 3600, tss: 0, method: 'not_counted' });
    expect(lift.weeks[0]!.intensity.uncounted).toBe(3600);
  });
});
