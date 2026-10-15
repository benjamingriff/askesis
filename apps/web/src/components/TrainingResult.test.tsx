import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { PerformanceResult } from './TrainingResult';
import type { LogInput } from '../training-log';
const mock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ api: { POST: mock.post } }));
afterEach(() => {
  cleanup();
  mock.post.mockReset();
});
it('previews and attaches test evidence, recording fitness only after explicit confirmation', async () => {
  mock.post.mockImplementation(async (path) => ({
    data: path.endsWith('/preview')
      ? {
          system: 'cycle_power',
          method: 'twenty_minute_test',
          zones: [{ key: 'threshold', target: 250, unit: 'watts' }],
        }
      : { current: [] },
  }));
  function Form() {
    const [value, setValue] = useState<NonNullable<LogInput['answers']>['result']>();
    return (
      <PerformanceResult
        discipline="cycle"
        value={value}
        performedOn="2026-10-14"
        onChange={setValue}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Form />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Average power (watts)'), { target: { value: '260' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview and attach result' }));
  await screen.findByText('Result previewed and attached.');
  expect(mock.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Update my fitness guides' })).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', { name: /This result reflects my current fitness/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Update my fitness guides' }));
  await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
  expect(mock.post.mock.calls[1]?.[1].body).toMatchObject({
    system: 'cycle_power',
    input: { method: 'twenty_minute_test', averageWatts: 260 },
    observedOn: '2026-10-14',
  });
});
