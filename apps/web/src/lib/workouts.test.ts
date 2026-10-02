import type { WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { describe, expect, it } from 'vitest';
import { formatDistance, formatPace, formatRange, startOfWeek } from './format';
import { inferKind, intensitySegments, summarizeWeeks } from './workouts';

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
  discipline: 'running',
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
    expect(inferKind({ title, purpose: null, discipline: 'running' })).toBe(kind);
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

describe('intensitySegments', () => {
  it('expands repeats so the profile shows every effort', () => {
    const effort = (id: string, zoneKey: string, seconds: number): WorkoutStep => ({
      id,
      kind: 'effort',
      role: 'work',
      discipline: 'running',
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
