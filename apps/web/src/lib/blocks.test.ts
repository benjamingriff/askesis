import type { TrainingBlock } from '@askesis/api-client';
import { expect, it } from 'vitest';
import { PHASE_COLORS } from '../theme/palette';
import {
  coveringRange,
  isCutback,
  labelBlocks,
  phasedBlocks,
  planStructure,
  timeline,
} from './blocks';

const block = (
  id: string,
  phase: TrainingBlock['phase'],
  startDate: string,
  endDate: string,
): TrainingBlock => ({
  id,
  position: 1,
  title: `${id} focus`,
  description: null,
  phase,
  startDate,
  endDate,
  weeks: [],
});

const plan = [
  block('a', 'base', '2027-01-04', '2027-01-17'),
  block('b', 'build', '2027-01-18', '2027-01-31'),
  block('c', 'build', '2027-02-01', '2027-02-07'),
  block('d', 'taper', '2027-02-08', '2027-02-14'),
];

it('numbers repeated phases and colours blocks by phase', () => {
  expect(labelBlocks(plan).map((b) => [b.label, b.color])).toEqual([
    ['Base', PHASE_COLORS.base],
    ['Build 1', PHASE_COLORS.build],
    ['Build 2', PHASE_COLORS.build],
    ['Taper', PHASE_COLORS.taper],
  ]);
});

it('shows no shape for plans whose blocks predate phases', () => {
  expect(phasedBlocks([block('a', null, '2027-01-04', '2027-01-17')])).toEqual([]);
  const mixed = phasedBlocks([...plan, block('e', null, '2027-02-15', '2027-02-21')]);
  expect(mixed.at(-1)!.label).toBe('e focus');
});

it('assigns a week to the block covering most of its days', () => {
  const blocks = [
    block('a', 'base', '2027-01-04', '2027-01-12'),
    block('b', 'build', '2027-01-13', '2027-01-31'),
  ];
  expect(coveringRange(blocks, { startDate: '2027-01-11', endDate: '2027-01-17' })?.id).toBe('b');
  expect(coveringRange(blocks, { startDate: '2027-03-01', endDate: '2027-03-07' })).toBeNull();
});

it('lays blocks end to end and marks plan dates without blocks as gaps', () => {
  const line = timeline(labelBlocks(plan.slice(0, 2)), '2027-01-04', '2027-02-14')!;
  expect(line.days).toBe(42);
  expect(line.segments.map((s) => [s.kind, s.days])).toEqual([
    ['block', 14],
    ['block', 14],
    ['gap', 14],
  ]);
});

it('keeps cutback weeks even when no block names a phase', () => {
  const legacy = {
    ...block('a', null, '2027-01-04', '2027-01-17'),
    weeks: [
      { weekNumber: 1, startDate: '2027-01-04', endDate: '2027-01-10', cutback: false },
      { weekNumber: 2, startDate: '2027-01-11', endDate: '2027-01-17', cutback: true },
    ],
  };
  const structure = planStructure([legacy]);
  expect(structure.blocks).toEqual([]);
  expect(isCutback(structure.weeks, { startDate: '2027-01-11', endDate: '2027-01-17' })).toBe(true);
  expect(isCutback(structure.weeks, { startDate: '2027-01-04', endDate: '2027-01-10' })).toBe(
    false,
  );
});

it('flags only the displayed week mostly covered by a stored cutback week', () => {
  // Stored weeks run Friday to Thursday; the cutback covers 8–14 January.
  const weeks = [
    { weekNumber: 1, startDate: '2027-01-01', endDate: '2027-01-07', cutback: false },
    { weekNumber: 2, startDate: '2027-01-08', endDate: '2027-01-14', cutback: true },
  ];
  expect(isCutback(weeks, { startDate: '2027-01-04', endDate: '2027-01-10' })).toBe(false);
  expect(isCutback(weeks, { startDate: '2027-01-11', endDate: '2027-01-17' })).toBe(true);
});
