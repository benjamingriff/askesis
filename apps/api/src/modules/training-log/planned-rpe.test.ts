import { expect, it } from 'vitest';
import { plannedRpe, type EffortNode } from './planned-rpe.js';
const step = (
  id: string,
  seconds: number,
  rpe: number | null,
  zoneKey: string | null = null,
  parentId: string | null = null,
): EffortNode => ({
  id,
  parentId,
  kind: 'effort',
  repeatCount: null,
  discipline: 'cycle',
  completion: { value: seconds, unit: 'seconds' },
  rpe,
  zoneKey,
  pacePerKm: null,
});
it('weights nested repeats and uses explicit effort before zone mapping', () => {
  const nodes: EffortNode[] = [
    step('warm', 600, null, 'recovery'),
    { ...step('repeat', 0, null), kind: 'repeat', repeatCount: 3 },
    step('work', 300, 9, 'threshold', 'repeat'),
    step('rest', 60, 2, null, 'repeat'),
  ];
  expect(plannedRpe(nodes)).toBe(5.8);
});
it('estimates distance timing by sport and keeps unknown effort unknown', () => {
  const run = {
    ...step('run', 1000, null, 'threshold'),
    discipline: 'run',
    completion: { value: 1000, unit: 'metres' },
    pacePerKm: 300,
  };
  const swim = {
    ...step('swim', 100, null, 'endurance'),
    discipline: 'swim',
    completion: { value: 100, unit: 'metres' },
    pacePerKm: 1200,
  };
  expect(plannedRpe([run, swim])).toBe(5.9);
  expect(plannedRpe([{ ...run, rpe: null, zoneKey: null }])).toBeNull();
});
it('excludes unknown intensity rather than treating it as zero', () => {
  expect(plannedRpe([step('known', 60, 7), step('unknown', 600, null)])).toBe(7);
});
