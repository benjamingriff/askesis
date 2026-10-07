import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CalibrationEntry, PerformanceState } from '@askesis/api-client';
import { AccountQueryProvider } from '../query-provider';
import { api } from '../api';
import { DEFAULT_SETTINGS, SettingsProvider } from '../settings';
import { parseClock, PerformancePage } from './performance';

vi.mock('../api', () => ({ api: { GET: vi.fn(), POST: vi.fn() } }));
const zones = ['easy', 'marathon', 'threshold', 'interval', 'repetition'].map((key, i) => ({
  key,
  metric: 'pace',
  unit: 'seconds_per_kilometre',
  minimum: 330 - i * 20,
  target: 340 - i * 20,
  maximum: 350 - i * 20,
}));
const race: CalibrationEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  system: 'run_pace',
  method: 'race_result',
  input: { method: 'race_result', distanceMetres: 21097.5, durationSeconds: 5880 },
  calculatorVersion: 'run-pace-v1',
  provenance: 'user_supplied',
  estimateBasis: 'Half marathon at the weekend.',
  observedOn: '2026-10-04',
  effectiveFrom: '2026-10-07',
  recordedAt: '2026-10-07T08:00:00.000Z',
  recordedBy: 'coach',
  conversationId: '00000000-0000-4000-8000-000000000009',
  retractedAt: null,
  zones,
};
let performance: PerformanceState;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  performance = {
    timezone: 'Europe/London',
    today: '2026-10-07',
    current: [],
    entries: [],
    usedByPlans: [],
  };
  vi.mocked(api.GET).mockImplementation(
    async () =>
      ({ data: structuredClone(performance), response: new Response() }) as Awaited<
        ReturnType<typeof api.GET>
      >,
  );
});
afterEach(cleanup);
function mount() {
  const router = createMemoryRouter([{ path: '/performance', element: <PerformancePage /> }], {
    initialEntries: ['/performance'],
  });
  render(
    <SettingsProvider>
      <AccountQueryProvider>
        <RouterProvider router={router} />
      </AccountQueryProvider>
    </SettingsProvider>,
  );
}

it('parses finish times and rejects malformed ones', () => {
  expect(parseClock('25:00')).toBe(1500);
  expect(parseClock('1:38:00')).toBe(5880);
  expect(() => parseClock('25')).toThrow();
  expect(() => parseClock('25:61')).toThrow();
});

it('records a race with its date, applying from today in the device timezone', async () => {
  vi.mocked(api.POST).mockResolvedValue({
    data: { ...performance, current: [race], entries: [race] },
    response: new Response(),
  } as Awaited<ReturnType<typeof api.POST>>);
  mount();
  expect(await screen.findByText(/No running fitness yet/)).toBeInTheDocument();
  expect(screen.getByText(/this device’s timezone \(Europe\/London\)/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Distance'), { target: { value: '21097.5' } });
  fireEvent.change(screen.getByLabelText('Finish time (mm:ss or hh:mm:ss)'), {
    target: { value: '1:38:00' },
  });
  fireEvent.change(screen.getByLabelText('Race date'), { target: { value: '2026-10-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate and save pace guides' }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith('/api/v1/performance/calibrations', {
      body: {
        system: 'run_pace',
        input: { method: 'race_result', distanceMetres: 21097.5, durationSeconds: 5880 },
        provenance: 'user_supplied',
        observedOn: '2026-10-04',
        idempotencyKey: expect.any(String),
      },
    }),
  );
  expect(await screen.findByText(/Evidence: 21.1 km in 1:38:00/)).toBeInTheDocument();
});

it('records the same result again after recording a different one', async () => {
  vi.mocked(api.POST).mockResolvedValue({
    data: performance,
    response: new Response(),
  } as Awaited<ReturnType<typeof api.POST>>);
  mount();
  fireEvent.change(await screen.findByLabelText('Fitness input'), {
    target: { value: 'threshold_pace' },
  });
  for (const [index, pace] of ['4:30', '4:20', '4:30'].entries()) {
    fireEvent.change(screen.getByLabelText('Threshold pace (min/km)'), { target: { value: pace } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate and save pace guides' }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(index + 1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Calculate and save pace guides' })).toBeEnabled(),
    );
  }
  const keys = vi
    .mocked(api.POST)
    .mock.calls.map(
      (call) => (call[1] as { body: { idempotencyKey: string } }).body.idempotencyKey,
    );
  expect(new Set(keys).size).toBe(3);
});

it('converts a miles threshold estimate to canonical seconds per kilometre', async () => {
  localStorage.setItem('askesis.settings.v1', JSON.stringify({ ...DEFAULT_SETTINGS, units: 'mi' }));
  vi.mocked(api.POST).mockResolvedValue({
    data: performance,
    response: new Response(),
  } as Awaited<ReturnType<typeof api.POST>>);
  mount();
  fireEvent.change(await screen.findByLabelText('Fitness input'), {
    target: { value: 'threshold_pace' },
  });
  fireEvent.change(screen.getByLabelText('Threshold pace (min/mi)'), { target: { value: '8:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate and save pace guides' }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/performance/calibrations',
      expect.objectContaining({
        body: expect.objectContaining({
          input: { method: 'threshold_pace', secondsPerKilometre: 480 / 1.609344 },
          provenance: 'user_estimate',
        }),
      }),
    ),
  );
});

it('shows coach-recorded history and withdraws a mistaken result after confirmation', async () => {
  performance = { ...performance, current: [race], entries: [race] };
  vi.mocked(api.POST).mockResolvedValue({
    data: {
      ...performance,
      current: [],
      entries: [{ ...race, retractedAt: '2026-10-07T09:00:00.000Z' }],
    },
    response: new Response(),
  } as Awaited<ReturnType<typeof api.POST>>);
  mount();
  const link = await screen.findByRole('link', { name: 'Recorded by your coach' });
  expect(link).toHaveAttribute('href', `/chat/${race.conversationId}`);
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
  const dialog = await screen.findByRole('dialog');
  expect(api.POST).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/performance/calibrations/{calibrationId}/retract',
      {
        params: { path: { calibrationId: race.id } },
        body: { idempotencyKey: expect.any(String) },
      },
    ),
  );
  expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
});

it('shows sports the athlete’s plans train and adds others on request', async () => {
  performance = { ...performance, usedByPlans: ['run_pace', 'cycle_power'] };
  mount();
  expect(await screen.findByText(/No cycling power yet/)).toBeInTheDocument();
  expect(screen.queryByText(/No swim paces yet/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Swimming' }));
  expect(await screen.findByText(/No swim paces yet/)).toBeInTheDocument();
  expect(screen.queryByText('Add another sport')).not.toBeInTheDocument();
});

it('records an FTP from a 20-minute test and a CSS test swum in a yard pool', async () => {
  localStorage.setItem('askesis.settings.v1', JSON.stringify({ ...DEFAULT_SETTINGS, pool: 'yd' }));
  performance = { ...performance, usedByPlans: ['cycle_power', 'swim_pace'] };
  vi.mocked(api.POST).mockResolvedValue({
    data: performance,
    response: new Response(),
  } as Awaited<ReturnType<typeof api.POST>>);
  mount();
  fireEvent.change(await screen.findByLabelText('Power input'), {
    target: { value: 'twenty_minute_test' },
  });
  fireEvent.change(screen.getByLabelText('Average power for 20 minutes (watts)'), {
    target: { value: '263' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate and save power zones' }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith('/api/v1/performance/calibrations', {
      body: {
        system: 'cycle_power',
        input: { method: 'twenty_minute_test', averageWatts: 263 },
        provenance: 'user_supplied',
        observedOn: '2026-10-07',
        idempotencyKey: expect.any(String),
      },
    }),
  );
  fireEvent.change(screen.getByLabelText('400 yd time (mm:ss)'), { target: { value: '5:48' } });
  fireEvent.change(screen.getByLabelText('200 yd time (mm:ss)'), { target: { value: '2:36' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate and save swim paces' }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  const body = (vi.mocked(api.POST).mock.calls[1]![1] as { body: { input: object } }).body;
  expect(body).toMatchObject({ system: 'swim_pace', provenance: 'user_supplied' });
  expect(body.input).toEqual({
    method: 'css_test',
    t400Seconds: expect.closeTo(348 / 0.9144, 6),
    t200Seconds: expect.closeTo(156 / 0.9144, 6),
  });
});

it('shows a malformed swim time as a form error instead of saving', async () => {
  performance = { ...performance, usedByPlans: ['swim_pace'] };
  mount();
  fireEvent.change(await screen.findByLabelText('400 m time (mm:ss)'), {
    target: { value: '6.20' },
  });
  fireEvent.change(screen.getByLabelText('200 m time (mm:ss)'), { target: { value: '2:50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate and save swim paces' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a time as mm:ss');
  expect(api.POST).not.toHaveBeenCalled();
});
