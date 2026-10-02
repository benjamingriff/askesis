import type { WorkoutSummary } from '@askesis/api-client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

it.each(['access', 'write'])(
  'keeps the schedule and view switching usable when storage %s fails',
  (failure) => {
    const deny = () => {
      throw new DOMException('Storage denied', 'SecurityError');
    };
    if (failure === 'access') vi.spyOn(window, 'localStorage', 'get').mockImplementation(deny);
    else vi.spyOn(Storage.prototype, 'setItem').mockImplementation(deny);
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
    fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
    expect(screen.getByRole('radio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true');
  },
);
