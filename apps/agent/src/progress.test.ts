import { afterEach, expect, it, vi } from 'vitest';
import { AgentApi, ApiError } from './api.js';
import { ProgressReporter } from './progress.js';

const claim = {
  runId: '00000000-0000-4000-8000-000000000010',
  token: 'run-token',
  generation: 1,
  deadlineAt: new Date(Date.now() + 60000).toISOString(),
  versionId: null,
  editNumber: null,
};
afterEach(() => {
  vi.restoreAllMocks();
});
const reporter = (api: AgentApi, interrupt = vi.fn(), stopped = () => false) =>
  new ProgressReporter(api, claim, interrupt, stopped, 1);

it('retries a transient outage with the same batch instead of failing the turn', async () => {
  const api = new AgentApi('http://localhost');
  const bodies: unknown[] = [];
  vi.spyOn(api, 'progress')
    .mockImplementationOnce(async (_claim, body) => {
      bodies.push(structuredClone(body));
      throw new ApiError('API_UNREACHABLE', 503);
    })
    .mockImplementation(async (_claim, body) => {
      bodies.push(structuredClone(body));
      return { status: 'running' };
    });
  const interrupt = vi.fn();
  const progress = reporter(api, interrupt);
  await progress.delta('a', 'Hello');
  await progress.flush();
  expect(bodies[0]).toEqual(bodies[1]);
  expect(interrupt).not.toHaveBeenCalled();
  await progress.close();
});

it('fails immediately when the API rejects a batch or the lease is gone', async () => {
  const api = new AgentApi('http://localhost');
  const send = vi.spyOn(api, 'progress').mockRejectedValue(new ApiError('LEASE_LOST', 409));
  const interrupt = vi.fn();
  const progress = reporter(api, interrupt);
  await progress.delta('a', 'Hello');
  await expect(progress.flush()).rejects.toMatchObject({ code: 'LEASE_LOST' });
  expect(send).toHaveBeenCalledOnce();
  expect(interrupt).toHaveBeenCalled();

  send.mockReset().mockRejectedValue(new ApiError('API_UNREACHABLE', 503));
  const stopped = reporter(api, vi.fn(), () => true);
  await stopped.delta('a', 'Hello');
  await expect(stopped.flush()).rejects.toMatchObject({ code: 'API_UNREACHABLE' });
  expect(send).toHaveBeenCalledOnce();
});

it('keeps a delivered reply when only the timing summary cannot be saved', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'progress').mockImplementation(async (_claim, body) => {
    if ((body as { timings?: unknown }).timings) throw new ApiError('INVALID_INPUT', 400);
    return { status: 'running' };
  });
  const progress = reporter(api);
  await progress.delta('a', 'Complete reply');
  await expect(progress.close()).resolves.toBeUndefined();
});

it('records truncation once instead of resending unchanged text', async () => {
  const api = new AgentApi('http://localhost');
  const send = vi.spyOn(api, 'progress').mockResolvedValue({ status: 'running' });
  const progress = reporter(api);
  await progress.delta('a', 'x'.repeat(32000));
  await progress.delta('a', 'more');
  await progress.flush();
  await progress.delta('a', 'even more');
  await progress.flush();
  const items = send.mock.calls.flatMap(
    ([, body]) => (body as { items: { revision: number; truncated: boolean }[] }).items,
  );
  expect(items.map(({ revision, truncated }) => ({ revision, truncated }))).toEqual([
    { revision: 1, truncated: false },
    { revision: 2, truncated: true },
  ]);
  await progress.close();
});
