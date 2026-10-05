import { expect, it } from 'vitest';
import { compareAggregates, compactSummary } from './live.changes.js';
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
  const compact = compactSummary(summary);
  expect(compact.workouts).toHaveLength(50);
  expect(compact.counts?.added).toBe(300);
  expect(compact.omittedWorkouts).toBe(250);
  expect(Buffer.byteLength(JSON.stringify(compact), 'utf8')).toBeLessThan(65536);
  expect(summary.workouts).toHaveLength(300);
});
