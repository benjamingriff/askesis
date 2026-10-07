import { expect, it } from 'vitest';
import { describeChanges, type ChangeSummary } from './PlanChanges';

const summary = (overrides: Partial<ChangeSummary> = {}): ChangeSummary => ({
  workouts: [],
  counts: { added: 2, changed: 0, moved: 1, removed: 0 },
  assumptionsChanged: true,
  datesChanged: false,
  ...overrides,
});

it('describes complete counts and other changes in one line', () => {
  expect(describeChanges(summary())).toBe('2 added · 1 moved · assumptions updated');
});

it('says when totals include an operation too large to reconcile exactly', () => {
  expect(describeChanges(summary({ approximate: true }))).toBe(
    '2 added · 1 moved · assumptions updated (approximate)',
  );
});
