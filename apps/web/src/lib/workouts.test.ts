import type { WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { describe, expect, it } from 'vitest';
import { METRES_PER_MILE, formatDistance, formatPace, formatRange, startOfWeek } from './format';
import { inferKind, intensitySegments, summarizeWeeks, volumeMeasure } from './workouts';

const workout = (date: string, metres: number, title = 'Easy run'): WorkoutSummary => ({
  id: date,
  planId: 'p',
  planVersionId: 'v',
  planTitle: 'Plan',
  weekNumber: 1,
  scheduledDate: date,
  title,
  description: null,
  purpose: null,
  discipline: 'run',
  priority: 'medium',
  estimatedDurationSeconds: 1800,
  estimatedDistanceMetres: metres,
});

describe('inferKind', () => {
  it.each([
    ['8 km easy long run', 'long'],
    ['10k time trial', 'test'],
    ['6 x 800 m intervals', 'intervals'],
    ['Threshold cruise', 'tempo'],
    ['Easy run and strides', 'easy'],
    ['Recovery jog', 'recovery'],
  ])('classifies “%s” as %s', (title, kind) => {
    expect(inferKind({ title, purpose: null, discipline: 'run' })).toBe(kind);
  });
});

describe('summarizeWeeks', () => {
  it('uses Monday calendar weeks and marks weeks beyond coverage as unplanned', () => {
    const weeks = summarizeWeeks(
      [workout('2027-01-05', 6000), workout('2027-01-10', 9000), workout('2027-01-12', 6000)],
      '2027-01-01',
      '2027-01-24',
      [{ startDate: '2027-01-01', endDate: '2027-01-17' }],
    );
    expect(weeks.map((w) => [w.startDate, w.metres, w.planned])).toEqual([
      ['2026-12-28', 0, true],
      ['2027-01-04', 15000, true],
      ['2027-01-11', 6000, true],
      ['2027-01-18', 0, false],
    ]);
  });
});

describe('summarizeWeeks with out-of-range workouts', () => {
  it('extends the weeks to keep workouts outside edited plan dates visible', () => {
    const weeks = summarizeWeeks(
      [workout('2027-01-05', 6000), workout('2027-01-20', 8000)],
      '2027-01-04',
      '2027-01-10',
      null,
    );
    expect(weeks.map((w) => [w.startDate, w.metres])).toEqual([
      ['2027-01-04', 6000],
      ['2027-01-11', 0],
      ['2027-01-18', 8000],
    ]);
  });

  it('treats known empty coverage as nothing prescribed rather than unknown', () => {
    const weeks = summarizeWeeks([workout('2027-01-05', 6000)], '2027-01-04', '2027-01-17', []);
    expect(weeks.map((w) => w.planned)).toEqual([true, false]);
  });
});

describe('intensitySegments', () => {
  it.each([
    ['zone', 'metres', 1000],
    ['zone', 'kilometres', 1],
    ['zone', 'miles', 1],
    ['pace', 'metres', 1000],
    ['pace', 'kilometres', 1],
    ['pace', 'miles', 1],
  ] as const)(
    'keeps %s-target effort widths consistent across pace units for %s',
    (type, unit, value) => {
      const profile = (paceUnit: string, pace: number): WorkoutStep => {
        const step: WorkoutStep = {
          id: 'effort',
          kind: 'effort',
          role: 'work',
          discipline: 'run',
          repeatCount: null,
          label: 'Effort',
          instructions: null,
          movement: null,
          completion: { type: 'distance', unit, value, conditionType: null, conditionValue: null },
          targets: [
            {
              type,
              minimumValue: null,
              targetValue: type === 'pace' ? pace : null,
              maximumValue: null,
              unit: type === 'pace' ? paceUnit : null,
              zoneSystem: type === 'zone' ? 'run_pace' : null,
              zoneKey: type === 'zone' ? 'interval' : null,
              text: null,
              resolvedZone:
                type === 'zone'
                  ? {
                      calibrationId: '00000000-0000-4000-8000-000000000001',
                      effectiveFrom: '2027-01-01',
                      calculatorVersion: 'run-pace-v1',
                      method: 'threshold_pace',
                      metric: 'pace',
                      minimumValue: null,
                      targetValue: pace,
                      maximumValue: null,
                      unit: paceUnit,
                    }
                  : null,
            },
          ],
          steps: [],
        };
        return {
          ...step,
          kind: 'sequence',
          targets: [],
          completion: null,
          steps: [
            step,
            {
              ...step,
              id: 'recovery',
              role: 'recovery',
              targets: [],
              completion: {
                type: 'duration',
                unit: 'seconds',
                value: 180,
                conditionType: null,
                conditionValue: null,
              },
            },
          ],
        };
      };
      const kilometreSegments = intensitySegments(profile('seconds_per_kilometre', 240));
      const mileSegments = intensitySegments(
        profile('seconds_per_mile', (240 * METRES_PER_MILE) / 1000),
      );
      const kilometres =
        unit === 'metres'
          ? value / 1000
          : unit === 'miles'
            ? (value * METRES_PER_MILE) / 1000
            : value;
      expect(kilometreSegments[0]!.seconds).toBeCloseTo(kilometres * 240);
      expect(mileSegments[0]!.seconds).toBeCloseTo(kilometreSegments[0]!.seconds);
      expect(mileSegments[1]!.seconds).toBe(180);
    },
  );

  it('expands repeats so the profile shows every effort', () => {
    const effort = (id: string, zoneKey: string, seconds: number): WorkoutStep => ({
      id,
      kind: 'effort',
      role: 'work',
      discipline: 'run',
      repeatCount: null,
      label: zoneKey,
      instructions: null,
      movement: null as never,
      completion: {
        type: 'duration',
        value: seconds,
        unit: 'seconds',
        conditionType: null,
        conditionValue: null,
      },
      targets: [
        {
          type: 'zone',
          minimumValue: null,
          targetValue: null,
          maximumValue: null,
          unit: null,
          zoneSystem: 'run_pace',
          zoneKey,
          text: null,
          resolvedZone: null,
        },
      ],
      steps: [],
    });
    const segments = intensitySegments({
      ...effort('root', 'easy', 0),
      kind: 'repeat',
      repeatCount: 3,
      steps: [effort('a', 'interval', 120), effort('b', 'easy', 60)],
    });
    expect(segments).toHaveLength(6);
    expect(segments[0]!.level).toBeGreaterThan(segments[1]!.level);
  });
});

describe('format', () => {
  it('formats units and ranges', () => {
    expect(formatDistance(16093.44, 'mi')).toBe('10 mi');
    expect(formatDistance(21097.5, 'km')).toBe('21.1 km');
    expect(formatPace(300, 'mi')).toBe('8:03/mi');
    expect(formatRange('2027-01-01', '2027-03-31')).toBe('1 Jan – 31 Mar 2027');
    expect(startOfWeek('2027-01-03')).toBe('2026-12-28');
  });
});

describe('multi-sport presentation', () => {
  const summary = (discipline: string, title: string) => ({ title, purpose: null, discipline });
  it.each([
    ['swim', 'CSS intervals', 'swim'],
    ['cycle', 'Sweet spot 3 x 12', 'ride'],
    ['strength', 'Lower body', 'strength'],
    ['mixed', 'Bike to run brick', 'mixed'],
    ['cycle', 'FTP ramp test', 'test'],
  ])('classifies a %s workout “%s” as %s', (discipline, title, kind) => {
    expect(inferKind(summary(discipline, title))).toBe(kind);
  });
  it('measures weekly volume by time once a plan trains more than running', () => {
    expect(volumeMeasure([{ discipline: 'run' }, { discipline: 'run' }])).toBe('distance');
    expect(volumeMeasure([{ discipline: 'run' }, { discipline: 'swim' }])).toBe('time');
  });
  it('times swim distances by swim pace and sets of lifts by reps and reps in reserve', () => {
    const effort = (overrides: Partial<WorkoutStep>): WorkoutStep => ({
      id: 'e',
      kind: 'effort',
      role: 'work',
      discipline: 'swim',
      repeatCount: null,
      label: null,
      instructions: null,
      movement: null,
      completion: {
        type: 'distance',
        value: 100,
        unit: 'metres',
        conditionType: null,
        conditionValue: null,
      },
      targets: [],
      steps: [],
      ...overrides,
    });
    // 100 m at a default two minutes per 100 m.
    expect(intensitySegments(effort({}))[0]!.seconds).toBe(120);
    const squat = intensitySegments(
      effort({
        discipline: 'strength',
        completion: {
          type: 'repetitions',
          value: 8,
          unit: 'repetitions',
          conditionType: null,
          conditionValue: null,
        },
        targets: [
          {
            type: 'rir',
            minimumValue: null,
            targetValue: 1,
            maximumValue: null,
            unit: 'repetitions',
            zoneSystem: null,
            zoneKey: null,
            text: null,
            resolvedZone: null,
          },
        ],
      }),
    )[0]!;
    expect(squat.seconds).toBe(24);
    expect(squat.level).toBeCloseTo(4, 5);
  });
});
