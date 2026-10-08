import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { BriefState, Plan } from '../plan-data';
import { knownCoverage } from '../plan-data';
import { labelBlocks } from '../lib/blocks';
import { BlockTimeline, CoverageNote, PlanStatus } from './PlanWidgets';

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

const version = {
  id: 'locked-1',
  state: 'locked' as const,
  versionNumber: 1,
  editNumber: 1,
  description: null,
  startDate: null,
  endDate: null,
  basedOnVersionId: null,
  supersedesVersionId: null,
  lockedAt: null,
};
const locked: Plan = {
  id: 'plan-1',
  displayName: 'Autumn running',
  stateVersion: 1,
  active: false,
  archived: false,
  draft: null,
  locked: version,
};
const draft = {
  ...version,
  id: 'draft-1',
  state: 'draft' as const,
  versionNumber: null,
  basedOnVersionId: version.id,
};

it.each([
  [{ ...locked, locked: null, draft }, 'Draft', 'Inactive'],
  [locked, 'Locked', 'Inactive'],
  [{ ...locked, draft, active: true }, 'Unlocked', 'Active'],
  [{ ...locked, draft }, 'Unlocked', 'Inactive'],
  [{ ...locked, draft, archived: true }, 'Archived', 'Inactive'],
] as const)(
  'shows independent lifecycle and activation labels for %j',
  (plan, status, activation) => {
    render(<PlanStatus plan={plan} />);
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.getByText(activation)).toBeInTheDocument();
  },
);

it('keeps the logical plan unlocked when switching between draft and locked content', () => {
  const plan = { ...locked, draft, active: true };
  const page = render(<PlanStatus plan={plan} view="draft" />);
  expect(screen.getByText('Draft · from v1')).toBeInTheDocument();
  page.rerender(<PlanStatus plan={plan} view="locked" />);
  expect(screen.getByText('Unlocked')).toBeInTheDocument();
  expect(screen.getByText('Active')).toBeInTheDocument();
  expect(screen.getByText('Locked v1')).toBeInTheDocument();
});

it('does not label a restored draft as copied from the current lock', () => {
  render(
    <PlanStatus
      plan={{ ...locked, draft: { ...draft, basedOnVersionId: 'older-version' } }}
      view="draft"
    />,
  );
  expect(screen.getByText('Restored draft')).toBeInTheDocument();
  expect(screen.queryByText('Draft · from v1')).not.toBeInTheDocument();
});

it('explains why an initial draft cannot be activated', () => {
  render(<PlanStatus plan={{ ...locked, locked: null, draft }} view="draft" />);
  expect(screen.getByText('Inactive')).toHaveAttribute(
    'title',
    'Lock a version before activating this plan.',
  );
});

it('shows the plan as phased blocks with the current one named', () => {
  const blocks = labelBlocks([
    {
      id: 'a',
      position: 1,
      title: 'Aerobic foundation',
      description: null,
      phase: 'base',
      startDate: '2027-01-04',
      endDate: '2027-01-17',
      weeks: [],
    },
    {
      id: 'b',
      position: 2,
      title: 'Threshold build',
      description: null,
      phase: 'build',
      startDate: '2027-01-18',
      endDate: '2027-01-31',
      weeks: [],
    },
  ]);
  const race = (id: string, scheduledDate: string, racePriority: 'A' | 'B' | 'C') => ({
    id,
    title: `${racePriority} event`,
    scheduledDate,
    racePriority,
  });
  render(
    <BlockTimeline
      blocks={blocks}
      startDate="2027-01-04"
      endDate="2027-02-14"
      today="2027-01-20"
      races={[
        race('b', '2027-01-23', 'B'),
        race('c', '2027-01-27', 'C'),
        race('a', '2027-02-14', 'A'),
      ]}
    />,
  );
  // Goal and tune-up races are marked; C races are training and stay off the line.
  expect(screen.getByText('A race: A event, 14 Feb')).toBeInTheDocument();
  expect(screen.getByText('B race: B event, 23 Jan')).toBeInTheDocument();
  expect(screen.queryByText(/C race/)).not.toBeInTheDocument();
  const items = screen.getAllByRole('listitem');
  expect(items.map((item) => item.className)).toEqual([
    'block-segment past',
    'block-segment current',
    'block-segment gap',
  ]);
  expect(items[1]).toHaveTextContent(
    'Build: Threshold build, 18 Jan – 31 Jan 2027 (current block)',
  );
  expect(items[2]).toHaveTextContent('not organised into blocks yet');
  expect(screen.getByText('Now')).toBeInTheDocument();
  expect(screen.getByText('until 31 Jan')).toBeInTheDocument();
});
