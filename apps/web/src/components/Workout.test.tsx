import { cleanup, render, screen } from '@testing-library/react';
import type { StepTarget, WorkoutStep } from '@askesis/api-client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsProvider } from '../settings';
import { StepList } from './Workout';

const target = (overrides: Partial<StepTarget>): StepTarget => ({
  type: 'zone',
  minimumValue: null,
  targetValue: null,
  maximumValue: null,
  unit: null,
  zoneSystem: null,
  zoneKey: null,
  text: null,
  resolvedZone: null,
  ...overrides,
});
const effort = (id: string, overrides: Partial<WorkoutStep>): WorkoutStep => ({
  id,
  kind: 'effort',
  role: 'work',
  discipline: 'run',
  repeatCount: null,
  label: id,
  instructions: null,
  movement: null,
  completion: {
    type: 'duration',
    value: 600,
    unit: 'seconds',
    conditionType: null,
    conditionValue: null,
  },
  targets: [],
  steps: [],
  ...overrides,
});
const resolved = (unit: string, minimumValue: number, maximumValue: number) => ({
  calibrationId: '00000000-0000-4000-8000-000000000001',
  effectiveFrom: '2026-05-11',
  calculatorVersion: 'v1',
  method: 'ftp',
  metric: unit === 'watts' ? 'power' : 'pace',
  minimumValue,
  targetValue: minimumValue,
  maximumValue,
  unit,
});
const session: WorkoutStep = {
  ...effort('root', {}),
  kind: 'sequence',
  role: null,
  completion: null,
  steps: [
    effort('Ride', {
      discipline: 'cycle',
      targets: [
        target({
          zoneSystem: 'cycle_power',
          zoneKey: 'sweet_spot',
          resolvedZone: resolved('watts', 220, 235),
        }),
      ],
    }),
    effort('Swim set', {
      discipline: 'swim',
      completion: {
        type: 'distance',
        value: 91.44,
        unit: 'metres',
        conditionType: null,
        conditionValue: null,
      },
      targets: [
        target({
          zoneSystem: 'swim_pace',
          zoneKey: 'threshold',
          resolvedZone: resolved('seconds_per_100_metres', 101, 106),
        }),
      ],
    }),
    effort('Back squat', {
      discipline: 'strength',
      completion: {
        type: 'repetitions',
        value: 6,
        unit: 'repetitions',
        conditionType: null,
        conditionValue: null,
      },
      targets: [
        target({ type: 'rir', targetValue: 2, unit: 'repetitions' }),
        target({ type: 'load', targetValue: 60, unit: 'kilograms' }),
      ],
    }),
  ],
};
beforeEach(() =>
  localStorage.setItem(
    'askesis.settings.v1',
    JSON.stringify({ ...DEFAULT_SETTINGS, pool: 'yd', load: 'lb' }),
  ),
);
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('shows each sport’s zones, distances and strength targets in the athlete’s units', () => {
  render(
    <SettingsProvider>
      <StepList step={session} units="km" mixed />
    </SettingsProvider>,
  );
  expect(screen.getByText('Sweet spot · 220–235 W')).toBeInTheDocument();
  expect(screen.getByText('CSS · 1:32–1:37/100yd')).toBeInTheDocument();
  expect(screen.getByText('100 yd')).toBeInTheDocument();
  expect(screen.getByText('6 reps')).toBeInTheDocument();
  expect(screen.getByText('2 reps in reserve')).toBeInTheDocument();
  expect(screen.getByText('~130 lb')).toBeInTheDocument();
  // A mixed session labels each effort with its sport.
  expect(screen.getAllByText(/Ride|Swim|Strength/).length).toBeGreaterThanOrEqual(3);
});
