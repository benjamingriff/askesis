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
  description: SemanticValue = 'Plan',
) =>
  ({
    semantic: {
      brief: [],
      weekdays: [],
      description,
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
it('has no pending highlight after a revert and explains assumption changes separately from workouts', () => {
  const before = aggregate([{ lineage: 'a', date: '2027-01-02' }]);
  expect(compareAggregates(before, structuredClone(before), new Map()).workouts).toEqual([]);
  const after = aggregate([{ lineage: 'a', date: '2027-01-02' }], 'Revised plan');
  expect(compareAggregates(before, after, new Map())).toMatchObject({
    workouts: [],
    assumptionsChanged: true,
    datesChanged: false,
  });
  expect(compareAggregates(null, after, new Map()).workouts[0]!.change).toBe('added');
});

it('stores every changed workout and presents complete counts with a bounded list', () => {
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
  expect(stored.workouts.every((workout) => workout.title.length <= 80)).toBe(true);
  const compact = compactSummary(stored);
  expect(compact.workouts).toHaveLength(50);
  expect(compact.counts.added).toBe(300);
  expect(compact.omittedWorkouts).toBe(250);
  // Identities are never dropped, so a run's operations cancel out exactly at any size.
  const batch = (from: number) =>
    compareAggregates(
      null,
      aggregate(
        Array.from({ length: 90 }, (_, i) => ({ lineage: `l-${from + i}`, date: '2027-01-02' })),
      ),
      new Map(),
    );
  const added = [0, 90, 180, 270, 360].map((from) => storedSummary(batch(from)));
  const all = aggregate(
    Array.from({ length: 450 }, (_, i) => ({ lineage: `l-${i}`, date: '2027-01-02' })),
  );
  const removedAll = storedSummary(compareAggregates(all, aggregate([]), new Map()));
  expect(removedAll.workouts).toHaveLength(450);
  expect(combineSummaries([...added, removedAll])).toMatchObject({
    workouts: [],
    counts: { added: 0, changed: 0, moved: 0, removed: 0 },
    omittedWorkouts: 0,
  });
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
      { assumptionsChanged: true },
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
    assumptionsChanged: true,
    datesChanged: false,
    omittedWorkouts: 0,
    counts: { added: 1, changed: 0, moved: 1, removed: 1 },
  });
  expect(combineSummaries([])).toBeNull();
});

it('stores every identity, shedding titles before exceeding the summary column bound', () => {
  const workouts = Array.from({ length: 12000 }, (_, i) => ({
    lineageId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    workoutId: null,
    title: '😀'.repeat(200),
    date: '2027-01-02',
    previousDate: '2027-01-02',
    change: 'removed' as const,
    prescriptionChanged: false,
  }));
  const stored = storedSummary({
    workouts,
    counts: { added: 0, changed: 0, moved: 0, removed: 12000 },
    assumptionsChanged: false,
    datesChanged: false,
  });
  expect(stored.workouts).toHaveLength(12000);
  expect(stored.workouts[0]!.title).not.toBe('');
  expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThan(4194304);
});

it('never rejects a pathologically large operation, keeping complete counts', () => {
  const removed = Array.from({ length: 30000 }, (_, i) => ({
    lineageId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    workoutId: null,
    title: 'Easy run',
    date: '2027-01-02',
    previousDate: '2027-01-02',
    change: 'removed' as const,
    prescriptionChanged: false,
  }));
  const stored = storedSummary({
    workouts: removed,
    counts: { added: 0, changed: 0, moved: 0, removed: 30000 },
    assumptionsChanged: false,
    datesChanged: false,
  });
  expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThan(4194304);
  expect(stored.workouts.length + (stored.omittedWorkouts ?? 0)).toBe(30000);
  expect(combineSummaries([stored])?.counts.removed).toBe(30000);
  // An earlier edit to a workout the oversized deletion could not list cannot be reconciled,
  // so the run's totals say they are approximate.
  const last = removed.at(-1)!;
  const edit = {
    workouts: [{ ...last, workoutId: 'w', change: 'changed' as const, prescriptionChanged: true }],
    counts: { added: 0, changed: 1, moved: 0, removed: 0 },
    assumptionsChanged: false,
    datesChanged: false,
  };
  expect(combineSummaries([storedSummary(edit), stored])).toMatchObject({ approximate: true });
  expect(combineSummaries([storedSummary(edit)])?.approximate).toBeUndefined();
});
