import type { WorkoutSummary } from '@askesis/api-client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { labelBlocks } from '../lib/blocks';
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
  racePriority: null,
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

function calendarSchedule(today: string) {
  return (
    <AccountQueryProvider>
      <Schedule
        workouts={[workout]}
        startDate="2027-01-11"
        endDate="2027-02-28"
        coverage={[{ startDate: '2027-01-11', endDate: '2027-02-28' }]}
        units="km"
        today={today}
      />
    </AccountQueryProvider>
  );
}

it('advances the default week at a week boundary while preserving explicitly browsed weeks', () => {
  const page = render(calendarSchedule('2027-01-17'));
  expect(screen.getByRole('heading', { name: /Week 1/ })).toHaveTextContent('This week');
  page.rerender(calendarSchedule('2027-01-18'));
  expect(screen.getByRole('heading', { name: /Week 2/ })).toHaveTextContent('This week');
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  page.rerender(calendarSchedule('2027-01-25'));
  expect(screen.getByRole('heading', { name: /Week 1/ })).not.toHaveTextContent('This week');
});

it('advances the default calendar date and month, retaining an explicitly selected date', () => {
  const page = render(calendarSchedule('2027-01-31'));
  fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
  expect(screen.getByRole('grid', { name: 'January 2027' })).toBeInTheDocument();
  page.rerender(calendarSchedule('2027-02-01'));
  expect(screen.getByRole('grid', { name: 'February 2027' })).toBeInTheDocument();
  expect(screen.getByRole('gridcell', { name: 'Monday 1 February' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.click(screen.getByRole('gridcell', { name: 'Wednesday 3 February' }));
  page.rerender(calendarSchedule('2027-02-02'));
  expect(screen.getByRole('gridcell', { name: 'Wednesday 3 February' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

it('preserves an explicitly browsed calendar month across rollover', () => {
  const page = render(calendarSchedule('2027-01-31'));
  fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  page.rerender(calendarSchedule('2027-02-01'));
  expect(screen.getByRole('grid', { name: 'December 2026' })).toBeInTheDocument();
});

it('labels empty days as unplanned when generation stopped before any coverage was recorded', () => {
  render(
    <AccountQueryProvider>
      <Schedule
        workouts={[workout]}
        startDate="2027-01-11"
        endDate="2027-01-24"
        coverage={[]}
        units="km"
        today="2027-01-12"
      />
    </AccountQueryProvider>,
  );
  expect(screen.queryByText('Rest day')).not.toBeInTheDocument();
  expect(screen.getAllByText('Not planned yet')).toHaveLength(6);
});

it('constrains library presentation without changing the saved calendar preference', () => {
  localStorage.setItem('askesis-schedule-mode', 'calendar');
  const schedule = (presentation: 'week-list' | 'interactive') => (
    <AccountQueryProvider>
      <Schedule
        workouts={[workout]}
        startDate="2027-01-11"
        endDate="2027-01-24"
        coverage={[{ startDate: '2027-01-11', endDate: '2027-01-24' }]}
        units="km"
        today="2027-01-12"
        presentation={presentation}
      />
    </AccountQueryProvider>
  );
  const mounted = render(schedule('week-list'));
  expect(screen.queryByRole('radio', { name: 'Calendar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /6 km easy run/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  expect(screen.getByRole('heading', { name: /Week 2/ })).toBeInTheDocument();
  expect(localStorage.getItem('askesis-schedule-mode')).toBe('calendar');
  mounted.rerender(schedule('interactive'));
  expect(screen.getByRole('radio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('grid')).toBeInTheDocument();
});

it('names the selected week’s phase and runs its rail under the bar', () => {
  const blocks = labelBlocks([
    {
      id: 'b',
      position: 1,
      title: 'Threshold build',
      description: 'Longer threshold efforts.',
      phase: 'build',
      startDate: '2027-01-11',
      endDate: '2027-01-24',
      weeks: [],
    },
  ]);
  render(
    <AccountQueryProvider>
      <Schedule
        workouts={[workout]}
        startDate="2027-01-11"
        endDate="2027-01-24"
        coverage={null}
        units="km"
        today="2027-01-12"
        blocks={blocks}
      />
    </AccountQueryProvider>,
  );
  expect(screen.getByText('Build')).toHaveAttribute('title', 'Longer threshold efforts.');
  expect(screen.getByText(/· Threshold build/)).toBeInTheDocument();
  const bar = screen.getByRole('button', { name: /^Week 1, Build/ });
  const rail = bar.querySelector<HTMLElement>('.bar-phase')!;
  expect(rail.style.getPropertyValue('--phase')).toBe('var(--effort-threshold)');
});

it('marks cutback weeks and races on the chart, with the trophy on the goal race', () => {
  const race = {
    ...workout,
    id: 'race',
    scheduledDate: '2027-01-16',
    title: 'Tune-up 10K',
    racePriority: 'B' as const,
  };
  const goal = {
    ...workout,
    id: 'goal',
    scheduledDate: '2027-01-23',
    title: 'Half marathon',
    racePriority: 'A' as const,
  };
  render(
    <AccountQueryProvider>
      <Schedule
        workouts={[workout, race, goal]}
        startDate="2027-01-11"
        endDate="2027-01-31"
        coverage={null}
        units="km"
        today="2027-01-12"
        storedWeeks={[
          { weekNumber: 1, startDate: '2027-01-11', endDate: '2027-01-17', cutback: true },
          { weekNumber: 2, startDate: '2027-01-18', endDate: '2027-01-24', cutback: false },
        ]}
      />
    </AccountQueryProvider>,
  );
  expect(screen.getByRole('button', { name: /^Week 1, cutback week, B race/ })).toHaveClass(
    'cutback',
  );
  expect(screen.getByRole('button', { name: /^Week 2, A race/ })).not.toHaveClass('cutback');
  expect(screen.getByText('Cutback')).toBeInTheDocument();
  expect(screen.getByText('B race')).toHaveAttribute(
    'title',
    'Important tune-up, with a few easier days before it.',
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
  const trophyDays = screen
    .getAllByRole('gridcell')
    .filter((cell) => cell.querySelector('.lucide-trophy'))
    .map((cell) => cell.getAttribute('aria-label'));
  expect(trophyDays).toEqual([expect.stringMatching(/^Saturday 23 January/)]);
});

it('shows no trophy without a goal race, even on the end date', () => {
  const tuneUp = { ...workout, id: 'tune', title: 'Tune-up 5K', racePriority: 'B' as const };
  const view = (workouts: (typeof workout)[]) => (
    <AccountQueryProvider>
      <Schedule
        workouts={workouts}
        startDate="2027-01-11"
        endDate="2027-01-24"
        coverage={null}
        units="km"
        today="2027-01-12"
      />
    </AccountQueryProvider>
  );
  const trophies = () =>
    screen.getAllByRole('gridcell').filter((cell) => cell.querySelector('.lucide-trophy'));
  const mounted = render(view([workout]));
  fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
  expect(trophies()).toHaveLength(0);
  mounted.rerender(view([tuneUp]));
  expect(trophies()).toHaveLength(0);
});
