import type { WorkoutSummary } from '@askesis/api-client';
import { describe, expect, it } from 'vitest';
import { addDays } from './format';
import {
  formRatio,
  formState,
  loadSeries,
  loadSnapshot,
  sessionLoad,
  weeklyLoads,
  type LoadDay,
} from './load';

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

describe('sessionLoad', () => {
  it('scores an hour by its kind of session, like a training stress score', () => {
    expect(sessionLoad(workout({ title: 'Easy run' }))).toBeCloseTo(42.25);
    expect(sessionLoad(workout({ title: '5 x 3 min intervals' }))).toBeCloseTo(72.25);
    expect(sessionLoad(workout({ title: 'Threshold ride', discipline: 'cycle' }))).toBeCloseTo(
      68.89,
    );
  });

  it('reads strength effort from its wording and gives rest no load', () => {
    const lift = (title: string) => sessionLoad(workout({ title, discipline: 'strength' }));
    expect(lift('Heavy squats')).toBeGreaterThan(lift('Lower body strength'));
    expect(lift('Lower body strength')).toBeGreaterThan(lift('Activation and prehab'));
    expect(sessionLoad(workout({ title: 'Rest day' }))).toBe(0);
  });

  it('assumes 45 minutes when the coach gave no duration', () => {
    expect(sessionLoad(workout({ estimatedDurationSeconds: null }))).toBeCloseTo(42.25 * 0.75);
  });
});

describe('loadSeries', () => {
  const start = '2027-01-04';
  const plan = Array.from({ length: 28 }, (_, i) =>
    workout({
      scheduledDate: addDays(start, i),
      estimatedDurationSeconds: i % 7 === 6 ? 7200 : 3600,
    }),
  ).filter((_, i) => i % 7 !== 4);

  it('covers every plan date, including days without sessions', () => {
    const series = loadSeries(plan, start, addDays(start, 34));
    expect(series).toHaveLength(35);
    expect(series[4]!.load).toBe(0);
    expect(series.at(-1)!.load).toBe(0);
  });

  it('starts at the first fortnight’s average so the plan does not begin from zero fitness', () => {
    const series = loadSeries(plan, start, addDays(start, 27));
    const fortnight = series.slice(0, 14).reduce((sum, day) => sum + day.load, 0) / 14;
    expect(series[0]!.fitness).toBeCloseTo(fortnight);
    expect(series[0]!.fatigue).toBeCloseTo(fortnight);
    expect(series[0]!.form).toBe(0);
  });

  it('describes each morning, before that day’s training', () => {
    const series = loadSeries(plan, start, addDays(start, 27));
    const sunday = series[6]!;
    const monday = series[7]!;
    // Sunday's long session shows up on Monday morning: fatigue reacts faster than fitness.
    expect(monday.fatigue - sunday.fatigue).toBeGreaterThan(monday.fitness - sunday.fitness);
    expect(monday.form).toBeLessThan(sunday.form);
  });

  it('is empty without dates or sessions', () => {
    expect(loadSeries([], null, null)).toEqual([]);
  });
});

describe('formState', () => {
  const day = (form: number, fitness = 50) => ({ form, fitness });
  it('bands form relative to fitness', () => {
    expect(formState(day(15))).toBe('fresh');
    expect(formState(day(5))).toBe('ready');
    expect(formState(day(0))).toBe('neutral');
    expect(formState(day(-10))).toBe('building');
    expect(formState(day(-20))).toBe('stretched');
  });

  it('treats a plan without fitness yet as balanced', () => {
    expect(formRatio(day(0, 0))).toBe(0);
    expect(formState(day(0, 0))).toBe('neutral');
  });
});

describe('loadSnapshot', () => {
  const series: LoadDay[] = Array.from({ length: 21 }, (_, i) => ({
    date: addDays('2027-01-04', i),
    load: 40,
    fitness: 30 + i,
    fatigue: 32 + i,
    form: -2,
  }));

  it('reports the ramp over the past week and race morning', () => {
    const snapshot = loadSnapshot(series, '2027-01-18', '2027-01-24')!;
    expect(snapshot.today.date).toBe('2027-01-18');
    expect(snapshot.ramp).toBe(7);
    expect(snapshot.raceDay?.date).toBe('2027-01-24');
  });

  it('is null outside the plan', () => {
    expect(loadSnapshot(series, '2027-03-01')).toBeNull();
  });
});

it('sums load, time and sessions per Monday-start week', () => {
  const sessions = [
    workout({ scheduledDate: '2027-01-04', estimatedDurationSeconds: 1800 }),
    workout({ scheduledDate: '2027-01-10', estimatedDurationSeconds: 3600 }),
    workout({ scheduledDate: '2027-01-11', estimatedDurationSeconds: 2700 }),
  ];
  const weeks = weeklyLoads(loadSeries(sessions, '2027-01-04', '2027-01-17'), sessions);
  expect(weeks.map((week) => [week.startDate, week.sessions, week.seconds])).toEqual([
    ['2027-01-04', 2, 5400],
    ['2027-01-11', 1, 2700],
  ]);
  expect(weeks[0]!.load).toBeCloseTo(sessionLoad(sessions[0]!) + sessionLoad(sessions[1]!));
});
