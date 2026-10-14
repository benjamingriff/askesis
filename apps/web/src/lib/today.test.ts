import type { TrainingWeek, WorkoutSummary } from '@askesis/api-client';
import { describe, expect, it } from 'vitest';
import type { PlanBlock } from './blocks';
import {
  countdownTarget,
  firstMark,
  firstMarkLabel,
  planToDate,
  upcomingMilestones,
} from './today';

function workout(overrides: Partial<WorkoutSummary>): WorkoutSummary {
  return {
    id: `${overrides.scheduledDate ?? '2027-01-04'}-${overrides.title ?? 'Easy run'}`,
    planId: 'plan',
    planVersionId: 'version',
    planTitle: 'Plan',
    weekNumber: 1,
    scheduledDate: '2027-01-04',
    title: 'Easy run',
    description: null,
    purpose: null,
    discipline: 'run',
    priority: 'medium',
    racePriority: null,
    estimatedDurationSeconds: 3600,
    estimatedDistanceMetres: null,
    ...overrides,
  };
}

const minutes = (value: number) => value * 60;

it('counts the sessions scheduled before today, by sport', () => {
  const progress = planToDate(
    [
      workout({ scheduledDate: '2027-01-04', discipline: 'run', estimatedDistanceMetres: 8000 }),
      workout({ scheduledDate: '2027-01-05', discipline: 'cycle', estimatedDurationSeconds: 9000 }),
      workout({ scheduledDate: '2027-01-06', discipline: 'run', estimatedDistanceMetres: 10000 }),
    ],
    '2027-01-06',
  );
  expect(progress).toMatchObject({ sessions: 3, doneSessions: 2, doneSeconds: 12600 });
  expect(progress.sports.map((sport) => sport.sport)).toEqual(['cycle', 'run']);
  expect(progress.sports[1]).toMatchObject({ sessions: 2, doneSessions: 1, doneMetres: 8000 });
});

describe('firstMark', () => {
  const rides = (lengths: number[]) =>
    lengths.map((length, week) =>
      workout({
        scheduledDate: `2027-01-${String(4 + week * 7).padStart(2, '0')}`,
        title: 'Long endurance ride',
        discipline: 'cycle',
        estimatedDurationSeconds: minutes(length),
      }),
    );

  it('ignores steady growth and marks the first session past a round length', () => {
    const plan = rides([105, 111, 118, 126]);
    expect(plan.map((ride) => firstMark(ride, plan))).toEqual([
      null,
      null,
      null,
      { unit: 'minutes', value: 120 },
    ]);
  });

  it('has nothing to beat on a sport’s first session and leaves races out', () => {
    const plan = [
      workout({
        scheduledDate: '2027-01-03',
        title: 'Goal 10K',
        racePriority: 'A',
        estimatedDurationSeconds: minutes(95),
      }),
      workout({ scheduledDate: '2027-01-04', estimatedDurationSeconds: minutes(50) }),
      workout({ scheduledDate: '2027-01-11', estimatedDurationSeconds: minutes(62) }),
    ];
    expect(firstMark(plan[0]!, plan)).toBeNull();
    expect(firstMark(plan[1]!, plan)).toBeNull();
    expect(firstMark(plan[2]!, plan)).toEqual({ unit: 'minutes', value: 60 });
  });

  it('measures swims by distance', () => {
    const plan = [1800, 2000].map((metres, week) =>
      workout({
        scheduledDate: `2027-01-${String(4 + week * 7).padStart(2, '0')}`,
        title: 'Endurance swim',
        discipline: 'swim',
        estimatedDistanceMetres: metres,
        estimatedDurationSeconds: minutes(40),
      }),
    );
    expect(firstMark(plan[1]!, plan)).toEqual({ unit: 'metres', value: 2000 });
  });

  it('compares bricks with bricks and gives gym circuits no length milestones', () => {
    const plan = [
      workout({
        scheduledDate: '2027-01-02',
        discipline: 'cycle',
        estimatedDurationSeconds: minutes(150),
      }),
      workout({
        scheduledDate: '2027-01-03',
        title: 'Bike → run brick',
        discipline: 'mixed',
        estimatedDurationSeconds: minutes(80),
      }),
      workout({
        scheduledDate: '2027-01-10',
        title: 'Bike → run brick',
        discipline: 'mixed',
        estimatedDurationSeconds: minutes(95),
      }),
      workout({
        scheduledDate: '2027-01-04',
        title: 'AMRAP gym circuit',
        discipline: 'mixed',
        estimatedDurationSeconds: minutes(30),
      }),
      workout({
        scheduledDate: '2027-01-11',
        title: 'AMRAP gym circuit',
        discipline: 'mixed',
        estimatedDurationSeconds: minutes(50),
      }),
    ];
    expect(firstMark(plan[2]!, plan)).toEqual({ unit: 'minutes', value: 90 });
    expect(firstMark(plan[4]!, plan)).toBeNull();
  });
});

it('names a mark in the sport’s words', () => {
  const metres = (value: number) => `${value.toLocaleString('en-GB')} m`;
  const label = (discipline: string, value: number, unit: 'minutes' | 'metres' = 'minutes') =>
    firstMarkLabel({ discipline }, { unit, value }, metres);
  expect(label('cycle', 120)).toBe('First 2-hour ride');
  expect(label('run', 90)).toBe('First 90-minute run');
  expect(label('cycle', 150)).toBe('First 2½-hour ride');
  expect(label('swim', 2000, 'metres')).toBe('First 2,000 m swim');
  expect(label('mixed', 60)).toBe('First 1-hour brick');
});

describe('upcomingMilestones', () => {
  const block = (label: string, startDate: string, endDate: string) =>
    ({
      id: label,
      position: 1,
      title: `${label} title`,
      description: null,
      phase: 'build',
      startDate,
      endDate,
      weeks: [],
      label,
      color: '',
    }) as PlanBlock;
  const week = (startDate: string, cutback: boolean) =>
    ({ weekNumber: 1, startDate, endDate: startDate, cutback }) as TrainingWeek;
  const base = {
    blocks: [block('Base', '2027-01-04', '2027-01-31'), block('Build', '2027-02-01', '2027-02-28')],
    weeks: [week('2027-01-25', true), week('2027-03-08', true)],
    startDate: '2027-01-04',
    endDate: '2027-03-28',
    today: '2027-01-12',
  };

  it('lists the next four weeks in date order, ending with the plan’s finish', () => {
    const items = upcomingMilestones({ ...base, workouts: [] });
    expect(items.map((item) => [item.kind, item.date])).toEqual([
      ['cutback', '2027-01-25'],
      ['block', '2027-02-01'],
      ['finish', '2027-03-28'],
    ]);
  });

  it('always ends with the goal race, or else the plan’s finish', () => {
    const race = workout({ scheduledDate: '2027-03-28', title: 'Goal half', racePriority: 'A' });
    expect(upcomingMilestones({ ...base, workouts: [race] }).at(-1)).toMatchObject({
      kind: 'race',
      date: '2027-03-28',
    });
    expect(upcomingMilestones({ ...base, workouts: [] })).not.toContainEqual(
      expect.objectContaining({ kind: 'race' }),
    );
    expect(upcomingMilestones({ ...base, workouts: [], horizon: Infinity }).at(-1)).toEqual({
      kind: 'finish',
      date: '2027-03-28',
    });
  });

  it('marks halfway and the biggest week when they fall within the horizon', () => {
    const sessions = [
      workout({ scheduledDate: '2027-01-05', estimatedDurationSeconds: 3600 }),
      workout({ scheduledDate: '2027-02-16', estimatedDurationSeconds: 9000 }),
    ];
    const kinds = upcomingMilestones({ ...base, workouts: sessions, horizon: Infinity }).map(
      (item) => `${item.kind} ${item.date}`,
    );
    expect(kinds).toContain('halfway 2027-02-14');
    expect(kinds).toContain('biggest-week 2027-02-15');
  });
});

describe('countdownTarget', () => {
  const race = (scheduledDate: string, racePriority: 'A' | 'B') =>
    workout({ scheduledDate, title: `${racePriority} ${scheduledDate}`, racePriority });

  it('counts to the next goal race, including one today', () => {
    const races = [race('2027-01-05', 'A'), race('2027-01-16', 'B'), race('2027-01-24', 'A')];
    expect(countdownTarget(races, '2027-03-28', '2027-01-12')).toMatchObject({
      date: '2027-01-24',
      days: 12,
    });
    expect(countdownTarget(races, '2027-03-28', '2027-01-24')).toMatchObject({ days: 0 });
  });

  it('falls back to the plan’s end, and to nothing once it has passed', () => {
    expect(countdownTarget([], '2027-03-28', '2027-03-20')).toMatchObject({ days: 8, race: null });
    expect(countdownTarget([], '2027-03-28', '2027-04-01')).toBeNull();
  });
});
