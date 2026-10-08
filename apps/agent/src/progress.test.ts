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
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const reporter = (api: AgentApi, interrupt = vi.fn(), hardStop = new AbortController().signal) =>
  new ProgressReporter(api, claim, interrupt, hardStop, 1);

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

  await progress.close().catch(() => {});
  send.mockClear();
  const controller = new AbortController();
  controller.abort('LEASE_LOST');
  const stopped = reporter(api, vi.fn(), controller.signal);
  await stopped.delta('a', 'Hello');
  await expect(stopped.flush()).rejects.toBe('LEASE_LOST');
  expect(send).not.toHaveBeenCalled();
  await stopped.close().catch(() => {});
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

const freshClaim = (remaining = 600000) => ({
  ...claim,
  deadlineAt: new Date(Date.now() + remaining).toISOString(),
});
const accepted = () => new Response(JSON.stringify({ status: 'running' }));

/** Model an in-flight fetch that obeys cancellation, optionally timing out after 20s. */
const pendingRequest = (signal: AbortSignal, timeout?: number) =>
  new Promise<Response>((_resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(() => {
            cleanup();
            reject(new TypeError('Synthetic 20-second request timeout'));
          }, timeout);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });

it.each(['network', '503', '429'])(
  'recovers from %s through the real transport with an identical batch',
  async (failure) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      if (failure === 'network') throw new TypeError('Acknowledgement lost');
      return new Response(JSON.stringify({ error: { code: 'TEMPORARY' } }), {
        status: Number(failure),
      });
    });
    fetcher.mockImplementation(async () => accepted());
    const run = freshClaim();
    const progress = new ProgressReporter(
      new AgentApi('http://synthetic.invalid/', fetcher),
      run,
      vi.fn(),
    );
    await progress.delta('a', 'Accepted prefix');
    const flush = progress.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush;
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`http://synthetic.invalid/internal/agent/runs/${run.runId}/progress`);
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${run.token}`, 'content-type': 'application/json' },
    });
    expect(fetcher.mock.calls[1]![1]?.body).toBe(init?.body);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      sequence: 1,
      items: [{ content: 'Accepted prefix' }],
    });
    await progress.close();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('bounds successive 20-second failures to one 30-second batch budget', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const signal = init!.signal!;
    signals.push(signal);
    return pendingRequest(signal, 20000);
  });
  const interrupt = vi.fn();
  const progress = new ProgressReporter(
    new AgentApi('http://synthetic.invalid', fetcher),
    freshClaim(),
    interrupt,
  );
  await progress.delta('a', 'Prefix');
  let settled = false;
  const operation = progress.flush().finally(() => {
    settled = true;
  });
  const flush = expect(operation).rejects.toMatchObject({
    code: 'API_UNREACHABLE',
    status: 503,
  });
  await vi.advanceTimersByTimeAsync(29999);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(interrupt).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  await flush;
  expect(signals[1]!.aborted).toBe(true);
  expect(interrupt).toHaveBeenCalled();
  await progress.close().catch(() => {});
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['fetch', 'response body'])(
  'caps a stalled %s at the run deadline, including body consumption',
  async (stage) => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      requestSignal = init!.signal!;
      if (stage === 'fetch') return pendingRequest(requestSignal);
      const signal = requestSignal;
      return new Response(
        new ReadableStream({
          start(controller) {
            const abort = () => {
              signal.removeEventListener('abort', abort);
              controller.error(signal.reason);
            };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          },
        }),
      );
    });
    const progress = new ProgressReporter(
      new AgentApi('http://synthetic.invalid', fetcher),
      freshClaim(3500),
      vi.fn(),
    );
    await progress.delta('a', 'Prefix');
    const flush = expect(progress.flush()).rejects.toBe('EXECUTION_TIMEOUT');
    await vi.advanceTimersByTimeAsync(3499);
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush;
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await progress.close().catch(() => {});
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(['request', 'backoff'])(
  'interrupts a pending %s and never starts another attempt',
  async (stage) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const stop = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (stage === 'backoff') throw new TypeError('Disconnected');
      return pendingRequest(init!.signal!);
    });
    const progress = new ProgressReporter(
      new AgentApi('http://synthetic.invalid', fetcher),
      freshClaim(),
      vi.fn(),
      stop.signal,
    );
    await progress.delta('a', 'Prefix');
    const flush = expect(progress.flush()).rejects.toBe('WORKER_SHUTDOWN');
    await vi.advanceTimersByTimeAsync(100);
    stop.abort('WORKER_SHUTDOWN');
    await flush;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await progress.close().catch(() => {});
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('starts no delivery after the deadline has already expired', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>();
  const progress = new ProgressReporter(
    new AgentApi('http://synthetic.invalid', fetcher),
    freshClaim(0),
    vi.fn(),
  );
  await progress.delta('a', 'Prefix');
  await expect(progress.flush()).rejects.toBe('EXECUTION_TIMEOUT');
  expect(fetcher).not.toHaveBeenCalled();
  await progress.close().catch(() => {});
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds a stalled optional timing batch without poisoning delivered text', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (JSON.parse(String(init!.body)).timings) return pendingRequest(init!.signal!);
    return accepted();
  });
  const interrupt = vi.fn();
  const progress = new ProgressReporter(
    new AgentApi('http://synthetic.invalid', fetcher),
    freshClaim(),
    interrupt,
  );
  await progress.delta('a', 'Complete reply');
  const closed = expect(progress.close()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(30000);
  await closed;
  expect(() => progress.throwIfFailed()).not.toThrow();
  expect(interrupt).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([400, 401, 409])('does not retry a real API rejection (%s)', async (status) => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'REJECTED', message: 'Private server detail' } }),
        { status },
      ),
    );
  const progress = new ProgressReporter(
    new AgentApi('http://synthetic.invalid', fetcher),
    freshClaim(),
    vi.fn(),
  );
  await progress.delta('a', 'Prefix');
  await expect(progress.flush()).rejects.toMatchObject({
    code: 'REJECTED',
    status,
    message: 'Agent API rejected request: REJECTED',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await progress.close().catch(() => {});
  expect(vi.getTimerCount()).toBe(0);
});
