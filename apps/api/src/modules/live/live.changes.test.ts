import { expect, it } from 'vitest';
import {
  combineSummaries,
  compareAggregates,
  compactSummary,
  storedSummary,
} from './live.changes.js';
import type { ChangeSummary } from './live.schemas.js';
import type { SemanticValue } from '../plans/plan.canonical.js';
import type { Aggregate } from '../plans/plan.aggregate.js';
const aggregate = (
  workouts: { lineage: string; date: string; title?: string; week?: string }[],
  calibrations: SemanticValue[] = [],
) =>
  ({
    semantic: {
      brief: [],
      weekdays: [],
      description: 'Plan',
      calibrations,
      startDate: '2027-01-01',
      endDate: '2027-01-31',
    },
    entities: {
      workouts: workouts.map((w) => ({
        lineage: w.lineage,
        value: {
          content: {
            scheduled_date: w.date,
            title: w.title ?? 'Easy run',
            position: 1,
            prescription: [],
          },
          relationships: { week_id: w.week ?? 'week1' },
        },
      })),
    },
    validation: {
      startDate: '2027-01-01',
      endDate: '2027-01-31',
      blocks: [],
      weeks: [],
      workouts: [],
    },
  }) as Aggregate;
it('compares lineage, distinguishes moves plus edits and excludes week movement from prescription changes', () => {
  const before = aggregate([
    { lineage: 'a', date: '2027-01-02' },
    { lineage: 'b', date: '2027-01-03' },
    { lineage: 'removed', date: '2027-01-05' },
  ]);
  const after = aggregate([
    { lineage: 'a', date: '2027-01-09', week: 'week2' },
    { lineage: 'b', date: '2027-01-04', title: 'Harder run' },
    { lineage: 'new', date: '2027-01-06' },
  ]);
  const changes = compareAggregates(
    before,
    after,
    new Map([
      ['a', 'current-a'],
      ['b', 'current-b'],
      ['new', 'current-new'],
    ]),
  );
  expect(changes.workouts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        lineageId: 'a',
        workoutId: 'current-a',
        change: 'moved',
        prescriptionChanged: false,
        previousDate: '2027-01-02',
      }),
      expect.objectContaining({ lineageId: 'b', change: 'moved', prescriptionChanged: true }),
      expect.objectContaining({ lineageId: 'removed', change: 'removed', workoutId: null }),
      expect.objectContaining({ lineageId: 'new', change: 'added' }),
    ]),
  );
});
it('has no pending highlight after a revert and explains pace changes separately from workouts', () => {
  const before = aggregate([{ lineage: 'a', date: '2027-01-02' }]);
  expect(compareAggregates(before, structuredClone(before), new Map()).workouts).toEqual([]);
  const after = aggregate([{ lineage: 'a', date: '2027-01-02' }], [{ threshold: 320 }]);
  expect(compareAggregates(before, after, new Map())).toMatchObject({
    workouts: [],
    paceGuidesChanged: true,
    assumptionsChanged: false,
  });
  expect(compareAggregates(null, after, new Map()).workouts[0]!.change).toBe('added');
});

it('bounds stored change details without losing full counts or rejecting a large valid batch', () => {
  const summary = compareAggregates(
    null,
    aggregate(
      Array.from({ length: 300 }, (_, i) => ({
        lineage: `lineage-${i}`,
        date: '2027-01-02',
        title: '😀'.repeat(2000),
      })),
    ),
    new Map(),
  );
  // Stored summaries keep every workout so a run's operations combine exactly.
  const stored = storedSummary(summary);
  expect(stored.workouts).toHaveLength(300);
  expect(stored.omittedWorkouts).toBe(0);
  expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThan(262144);
  const compact = compactSummary(stored);
  expect(compact.workouts).toHaveLength(50);
  expect(compact.counts.added).toBe(300);
  expect(compact.omittedWorkouts).toBe(250);
  // Even an operation too large to list keeps complete counts through combination.
  const huge = storedSummary(
    compareAggregates(
      null,
      aggregate(Array.from({ length: 450 }, (_, i) => ({ lineage: `l-${i}`, date: '2027-01-02' }))),
      new Map(),
    ),
  );
  expect(huge).toMatchObject({ omittedWorkouts: 50, counts: { added: 450 } });
  expect(combineSummaries([huge])).toMatchObject({ counts: { added: 450 }, omittedWorkouts: 400 });
});

const summary = (workouts: Partial<ChangeSummary['workouts'][number]>[], flags = {}) =>
  ({
    workouts: workouts.map((w) => ({
      lineageId: 'a',
      workoutId: 'w-a',
      title: 'Easy run',
      date: '2027-01-02',
      previousDate: '2027-01-02',
      change: 'changed',
      prescriptionChanged: true,
      ...w,
    })),
    counts: { added: 0, changed: 0, moved: 0, removed: 0 },
    assumptionsChanged: false,
    paceGuidesChanged: false,
    datesChanged: false,
    ...flags,
  }) as ChangeSummary;
it('combines a run’s operations into its net changes', () => {
  const combined = combineSummaries([
    summary([
      { lineageId: 'moved', change: 'moved', date: '2027-01-04', prescriptionChanged: false },
      { lineageId: 'temporary', change: 'added', previousDate: null, workoutId: 'w-t' },
      { lineageId: 'added', change: 'added', previousDate: null, title: 'Draft title' },
      { lineageId: 'back', change: 'moved', date: '2027-01-05', prescriptionChanged: false },
    ]),
    summary(
      [
        { lineageId: 'moved', change: 'changed', date: '2027-01-04', previousDate: '2027-01-04' },
        { lineageId: 'temporary', change: 'removed', workoutId: null, previousDate: '2027-01-02' },
        { lineageId: 'added', change: 'changed', previousDate: '2027-01-02', title: 'Final' },
        {
          lineageId: 'back',
          change: 'moved',
          previousDate: '2027-01-05',
          prescriptionChanged: false,
        },
        { lineageId: 'gone', change: 'removed', workoutId: null, title: 'Long run' },
      ],
      // This operation also added two workouts it could not list.
      {
        paceGuidesChanged: true,
        omittedWorkouts: 2,
        counts: { added: 2, changed: 2, moved: 1, removed: 2 },
      },
    ),
  ])!;
  expect(combined.workouts).toEqual([
    expect.objectContaining({ lineageId: 'added', change: 'added', title: 'Final' }),
    expect.objectContaining({ lineageId: 'gone', change: 'removed', title: 'Long run' }),
    expect.objectContaining({
      lineageId: 'moved',
      change: 'moved',
      previousDate: '2027-01-02',
      date: '2027-01-04',
      prescriptionChanged: true,
    }),
  ]);
  expect(combined).toMatchObject({
    paceGuidesChanged: true,
    assumptionsChanged: false,
    omittedWorkouts: 2,
    counts: { added: 3, changed: 0, moved: 1, removed: 1 },
  });
  expect(combineSummaries([])).toBeNull();
});
