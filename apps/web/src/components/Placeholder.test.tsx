import type { WorkoutSummary } from '@askesis/api-client';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { Schedule } from './Schedule';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get } }));

const club: WorkoutSummary = {
  id: 'club',
  planId: 'p',
  lineageId: 'club-lineage',
  sessionType: 'intervals',
  plannedRpe: 6.5,
  planVersionId: 'v',
  planTitle: 'Plan',
  weekNumber: 1,
  scheduledDate: '2027-01-12',
  title: 'Tuesday track club',
  description: null,
  purpose: 'Track nights are usually intervals; treated as the week’s quality session.',
  discipline: 'run',
  priority: 'high',
  racePriority: null,
  estimatedDurationSeconds: 4500,
  estimatedDistanceMetres: null,
  placeholder: true,
  expectedRpe: { minimum: 5, maximum: 8 },
};
const football: WorkoutSummary = {
  ...club,
  id: 'football',
  lineageId: 'football-lineage',
  scheduledDate: '2027-01-14',
  title: '5-a-side football',
  purpose: null,
  discipline: 'other',
  priority: 'medium',
  sessionType: 'speed',
  estimatedDurationSeconds: 3600,
  expectedRpe: { minimum: 6, maximum: 9 },
};
beforeEach(() => {
  localStorage.clear();
  mocks.get.mockResolvedValue({
    data: {
      workout: club,
      tags: ['club'],
      prescription: {
        id: 'step',
        kind: 'effort',
        role: 'main',
        discipline: 'run',
        repeatCount: null,
        label: club.title,
        instructions: null,
        movement: null,
        completion: {
          type: 'duration',
          value: 4500,
          unit: 'seconds',
          conditionType: null,
          conditionValue: null,
        },
        targets: [],
        steps: [],
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shows placeholders and other activities as booked sessions with an expected effort', async () => {
  render(
    <AccountQueryProvider>
      <Schedule
        workouts={[club, football]}
        startDate="2027-01-11"
        endDate="2027-01-17"
        coverage={[{ startDate: '2027-01-11', endDate: '2027-01-17' }]}
        units="km"
        today="2027-01-11"
      />
    </AccountQueryProvider>,
  );
  const card = screen.getByRole('button', { name: /Tuesday track club/ });
  expect(card).toHaveClass('is-placeholder');
  expect(card).toHaveTextContent('Run');
  expect(card).toHaveTextContent('Placeholder');
  expect(card).toHaveTextContent('~1h 15 · RPE 5–8');
  const other = screen.getByRole('button', { name: /5-a-side football/ });
  expect(other).toHaveTextContent('Other activity');
  expect(other).toHaveTextContent('~1h · RPE 6–9');

  fireEvent.click(card);
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Placeholder session');
  expect(dialog).toHaveTextContent('assuming intervals at RPE 5–8');
  expect(within(dialog).getByLabelText('Expected effort RPE 5–8')).toBeInTheDocument();
  await within(dialog).findByText('club');
  expect(dialog).not.toHaveTextContent('Prescription');
  expect(dialog).not.toHaveTextContent('Effort profile');
});
