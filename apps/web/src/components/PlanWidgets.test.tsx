import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { BriefState, Plan } from '../plan-data';
import { knownCoverage } from '../plan-data';
import { CoverageNote, PlanStatus } from './PlanWidgets';

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
