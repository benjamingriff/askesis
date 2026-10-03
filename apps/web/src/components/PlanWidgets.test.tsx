import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { BriefState } from '../plan-data';
import { knownCoverage } from '../plan-data';
import { CoverageNote } from './PlanWidgets';

const state = {
  startDate: '2027-01-01',
  endDate: '2027-01-31',
  coverage: [],
  generations: [],
} as unknown as BriefState;
afterEach(cleanup);

it('treats coverage as unknown only when no generation has been attempted', () => {
  expect(knownCoverage(state)).toBeNull();
  const interrupted = {
    ...state,
    generations: [
      {
        runId: 'run',
        startDate: '2027-01-01',
        endDate: '2027-01-28',
        prescribedThrough: null,
        status: 'interrupted',
      },
    ],
  } as BriefState;
  expect(knownCoverage(interrupted)).toEqual([]);
  render(<CoverageNote state={interrupted} />);
  expect(screen.getByText('Nothing fully prescribed yet')).toBeInTheDocument();
  expect(screen.getByText(/Generation stopped before 28 Jan/)).toBeInTheDocument();
  expect(screen.queryByText('Coverage not recorded')).not.toBeInTheDocument();
});
