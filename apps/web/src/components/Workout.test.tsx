import { cleanup, render, screen, within } from '@testing-library/react';
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

const runningSession: WorkoutStep = {
  ...effort('running-root', {}),
  kind: 'sequence',
  role: null,
  completion: null,
  steps: [
    effort('warmup', {
      role: 'warmup',
      label: 'Warm up',
      instructions: 'Start gently and build to easy effort.',
      targets: [
        target({
          zoneSystem: 'run_pace',
          zoneKey: 'easy',
          resolvedZone: {
            ...resolved('seconds_per_kilometre', 300, 360),
            method: 'threshold',
            calculatorVersion: 'run-pace-v1',
          },
        }),
      ],
    }),
    {
      ...effort('repeat', {}),
      kind: 'repeat',
      role: null,
      label: 'Cruise repeats',
      repeatCount: 3,
      completion: null,
      steps: [
        {
          ...effort('pair', {}),
          kind: 'sequence',
          role: null,
          completion: null,
          steps: [
            effort('work', {
              label: 'Controlled effort',
              instructions: 'Keep the pace even.',
              completion: {
                type: 'distance',
                value: 1609.344,
                unit: 'metres',
                conditionType: null,
                conditionValue: null,
              },
              targets: [target({ type: 'pace', targetValue: 300, unit: 'seconds_per_kilometre' })],
            }),
            effort('recovery', {
              role: 'recovery',
              label: 'Recovery jog',
              instructions: 'Jog until breathing settles.',
              completion: {
                type: 'duration',
                value: 90,
                unit: 'seconds',
                conditionType: null,
                conditionValue: null,
              },
            }),
          ],
        },
      ],
    },
    effort('cooldown', {
      role: 'cooldown',
      label: 'Cool down',
      instructions: 'Finish with relaxed running.',
      completion: {
        type: 'duration',
        value: 120,
        unit: 'seconds',
        conditionType: null,
        conditionValue: null,
      },
    }),
  ],
};

it('keeps nested work and recovery instructions once, in order, inside their repeat', () => {
  render(
    <SettingsProvider>
      <StepList step={runningSession} units="km" />
    </SettingsProvider>,
  );

  // Sequences flatten; the repeated pair stays in its own list and is shown once with a count.
  expect(screen.getAllByRole('list')).toHaveLength(2);
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
  const repeat = screen.getByText('Cruise repeats').closest('li')!;
  expect(within(repeat).getByText('3×')).toBeInTheDocument();
  const pair = within(repeat).getByRole('list');
  const [work, recovery] = within(pair).getAllByRole('listitem');
  expect(within(pair).getAllByRole('listitem')).toHaveLength(2);
  expect(within(work!).getByText('work')).toBeInTheDocument();
  expect(within(work!).getByText('Controlled effort')).toBeInTheDocument();
  expect(within(work!).getByText('Keep the pace even.')).toBeInTheDocument();
  expect(within(work!).getByText('1.6 km')).toBeInTheDocument();
  expect(within(recovery!).getByText('recovery')).toBeInTheDocument();
  expect(within(recovery!).getByText('Recovery jog')).toBeInTheDocument();
  expect(within(recovery!).getByText('Jog until breathing settles.')).toBeInTheDocument();
  expect(within(recovery!).getByText('90s')).toBeInTheDocument();

  const warmup = screen.getByText('Warm up').closest('li')!;
  expect(within(warmup).getByText('warmup')).toBeInTheDocument();
  expect(within(warmup).getByText('Start gently and build to easy effort.')).toBeInTheDocument();
  expect(within(warmup).getByText('10 min')).toBeInTheDocument();
  const cooldown = screen.getByText('Cool down').closest('li')!;
  expect(within(cooldown).getByText('cooldown')).toBeInTheDocument();
  expect(within(cooldown).getByText('Finish with relaxed running.')).toBeInTheDocument();
  expect(within(cooldown).getByText('2 min')).toBeInTheDocument();

  const labels = ['Warm up', 'Cruise repeats', 'Controlled effort', 'Recovery jog', 'Cool down'];
  const rendered = labels.map((label) => screen.getByText(label));
  for (let index = 1; index < rendered.length; index++) {
    expect(rendered[index - 1]!.compareDocumentPosition(rendered[index]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }
});

it.each([
  ['km', 'Easy · 5:00–6:00/km', 'pace 5:00/km', '1.6 km'],
  ['mi', 'Easy · 8:03–9:39/mi', 'pace 8:03/mi', '1 mi'],
] as const)(
  'renders resolved run zones, canonical pace and completions in %s',
  (units, zoneText, paceText, distanceText) => {
    render(
      <SettingsProvider>
        <StepList step={runningSession} units={units} />
      </SettingsProvider>,
    );
    const warmup = screen.getByText('Warm up').closest('li')!;
    expect(within(warmup).getByText(zoneText)).toBeInTheDocument();
    expect(within(warmup).getByText('10 min')).toBeInTheDocument();
    const work = screen.getByText('Controlled effort').closest('li')!;
    expect(within(work).getByText(paceText)).toBeInTheDocument();
    expect(within(work).getByText(distanceText)).toBeInTheDocument();
  },
);

it('retains the zone name and coaching target text without resolved numeric values', () => {
  render(
    <SettingsProvider>
      <StepList
        step={effort('unresolved', {
          targets: [
            target({ zoneSystem: 'run_pace', zoneKey: 'threshold' }),
            target({ type: 'instruction', text: 'Run tall and keep your shoulders relaxed.' }),
          ],
        })}
        units="mi"
      />
    </SettingsProvider>,
  );
  const step = screen.getByRole('listitem');
  expect(within(step).getByText('Threshold')).toBeInTheDocument();
  expect(within(step).getByText('Run tall and keep your shoulders relaxed.')).toBeInTheDocument();
});
