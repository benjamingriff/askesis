import type { WorkoutSummary } from '@askesis/api-client';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { Schedule } from './Schedule';

const workout: WorkoutSummary = {
  id: 'w1',
  planId: 'p',
  planVersionId: 'v',
  planTitle: 'Plan',
  weekNumber: 1,
  scheduledDate: '2027-01-12',
  title: '6 km easy run',
  description: null,
  purpose: null,
  discipline: 'running',
  priority: 'medium',
  estimatedDurationSeconds: 2400,
  estimatedDistanceMetres: 6000,
};
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('labels days beyond the prescribed coverage as unplanned rather than rest', () => {
  render(
    <AccountQueryProvider>
      <Schedule
        workouts={[workout]}
        startDate="2027-01-11"
        endDate="2027-01-24"
        coverage={[{ startDate: '2027-01-11', endDate: '2027-01-12' }]}
        units="km"
        today="2027-01-12"
      />
    </AccountQueryProvider>,
  );
  expect(screen.getByRole('button', { name: /6 km easy run/ })).toBeInTheDocument();
  // Monday 11 is covered and empty → rest; Wednesday 13 to Sunday 17 are not prescribed.
  expect(screen.getAllByText('Rest day')).toHaveLength(1);
  expect(screen.getAllByText('Not planned yet')).toHaveLength(5);
});
