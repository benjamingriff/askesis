import { afterEach, expect, it, vi } from 'vitest';
import { AgentApi, ApiError, type ExecutionContext } from './api.js';
import { parseAgentConfig } from './config.js';
import { Worker } from './worker.js';
const config = parseAgentConfig({
  OPENAI_API_KEY: 'test',
  AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
});
const claim = {
  runId: '00000000-0000-4000-8000-000000000010',
  token: 'token',
  generation: 1,
  deadlineAt: new Date(Date.now() + 600000).toISOString(),
  versionId: null,
  editNumber: null,
};
const context: ExecutionContext = {
  messages: [],
  historyTruncated: false,
  plan: null,
  brief: null,
  performance: null,
  tools: [],
  versionId: null,
  editNumber: null,
};
afterEach(() => vi.useRealTimers());
it('maps completed output and usage into one final API command', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'completed' });
  const runtime = {
    execute: vi
      .fn()
      .mockResolvedValue({ content: 'What is your goal?', inputTokens: 12, outputTokens: 5 }),
  };
  await new Worker(config, api, runtime).execute(claim);
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, {
    status: 'completed',
    content: 'What is your goal?',
    inputTokens: 12,
    outputTokens: 5,
  });
});
it('aborts the runtime on cancellation and acknowledges it without a final assistant reply', async () => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  vi.spyOn(api, 'heartbeat').mockResolvedValue({
    status: 'cancelling',
    deadlineAt: claim.deadlineAt,
  });
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'cancelled' });
  const runtime = {
    execute: vi.fn(
      async (_context, _claim, _api, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }),
        ),
    ),
  };
  const execution = new Worker(config, api, runtime).execute(claim);
  await vi.advanceTimersByTimeAsync(15000);
  await execution;
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, { status: 'cancelled' });
});
it('reports provider failure while leaving already committed tool receipts to the API', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'failed' });
  const runtime = { execute: vi.fn().mockRejectedValue(new Error('Provider unavailable')) };
  await new Worker(config, api, runtime).execute(claim);
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, {
    status: 'failed',
    failureCode: 'PROVIDER_ERROR',
  });
});
it('survives a transient heartbeat failure but abandons the run after repeated ones', async () => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const heartbeat = vi
    .spyOn(api, 'heartbeat')
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ status: 'running', deadlineAt: claim.deadlineAt })
    .mockRejectedValue(new Error('network'));
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'failed' });
  let aborted = false;
  const runtime = {
    execute: vi.fn(
      async (_context, _claim, _api, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('Aborted'));
            },
            { once: true },
          ),
        ),
    ),
  };
  const execution = new Worker(config, api, runtime).execute(claim);
  await vi.advanceTimersByTimeAsync(30000);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  expect(aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(45000);
  await execution;
  expect(aborted).toBe(true);
  expect(finish).toHaveBeenCalledOnce();
});
it('abandons the run immediately when the API reports the lease as lost', async () => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  vi.spyOn(api, 'heartbeat').mockRejectedValue(new ApiError('LEASE_LOST', 409));
  vi.spyOn(api, 'finish').mockResolvedValue({ status: 'failed' });
  const runtime = {
    execute: vi.fn(
      async (_context, _claim, _api, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }),
        ),
    ),
  };
  const execution = new Worker(config, api, runtime).execute(claim);
  await vi.advanceTimersByTimeAsync(15000);
  await execution;
  expect(runtime.execute).toHaveBeenCalledOnce();
});

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};

it.each(['shutdown', 'lease loss', 'deadline', 'cancellation only'] as const)(
  'preserves cancellation prefix flushing while observing a later %s',
  async (stop) => {
    vi.useFakeTimers();
    const { ScriptedModel, modelStreamResponder } = await import('@openai/agents/testing');
    const { SdkRuntime } = await import('./runtime.js');
    const emit = deferred<void>();
    const pending = deferred<void>();
    const delivery = deferred<Response>();
    let providerSignal: AbortSignal | undefined;
    const model = new ScriptedModel([
      modelStreamResponder(({ request }) =>
        (async function* () {
          providerSignal = request.signal!;
          yield { type: 'response_started' as const };
          await emit.promise;
          yield {
            type: 'output_text_delta' as const,
            itemId: 'prefix',
            delta: 'Accepted before cancellation',
          };
          await new Promise<void>((resolve) => {
            if (request.signal!.aborted) resolve();
            else request.signal!.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new Error('Provider interrupted');
        })(),
      ),
    ]);
    const run = {
      ...claim,
      deadlineAt: new Date(Date.now() + (stop === 'deadline' ? 20000 : 200000)).toISOString(),
    };
    let progressSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      if (body.timings) return new Response(JSON.stringify({ status: 'cancelling' }));
      expect(body.items).toMatchObject([{ content: 'Accepted before cancellation' }]);
      progressSignal = init!.signal!;
      const signal = progressSignal;
      const abort = () => delivery.reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      pending.resolve();
      try {
        return await delivery.promise;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    });
    const api = new AgentApi('http://synthetic.invalid', fetcher);
    vi.spyOn(api, 'context').mockResolvedValue(context);
    vi.spyOn(api, 'heartbeat')
      .mockResolvedValueOnce({ status: 'cancelling', deadlineAt: run.deadlineAt })
      .mockRejectedValue(new ApiError('LEASE_LOST', 409));
    const tool = vi.spyOn(api, 'tool');
    const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'cancelled' });
    const runtime = new SdkRuntime(config, model);
    const execute = vi.spyOn(runtime, 'execute');
    const worker = new Worker(config, api, runtime);
    const execution = worker.execute(run);
    // Empty periodic flushes refresh lastFlush. Emit a small dirty prefix just before
    // the first heartbeat cancels, so close() (not the streaming timer) delivers it.
    await vi.advanceTimersByTimeAsync(14900);
    emit.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await pending.promise;
    const executionSignal = execute.mock.calls[0]![3];
    const hardStopSignal = execute.mock.calls[0]![4];
    expect(executionSignal.reason).toBe('CANCELLED');
    expect(providerSignal!.reason).toBe('CANCELLED');
    expect(hardStopSignal.aborted).toBe(false);
    expect(progressSignal!.aborted).toBe(false);
    expect(finish).not.toHaveBeenCalled();

    if (stop === 'shutdown') worker.stop();
    else if (stop === 'lease loss') await vi.advanceTimersByTimeAsync(15000);
    else if (stop === 'deadline') await vi.advanceTimersByTimeAsync(5000);
    else delivery.resolve(new Response(JSON.stringify({ status: 'cancelling' })));
    if (stop !== 'cancellation only') expect(progressSignal!.aborted).toBe(true);
    await execution;

    expect(executionSignal.reason).toBe('CANCELLED');
    if (stop === 'cancellation only') {
      expect(hardStopSignal.aborted).toBe(false);
      expect(progressSignal!.aborted).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(2); // Prefix, then optional timings.
    } else {
      const reason = {
        shutdown: 'WORKER_SHUTDOWN',
        'lease loss': 'LEASE_LOST',
        deadline: 'EXECUTION_TIMEOUT',
      }[stop];
      expect(hardStopSignal.reason).toBe(reason);
      expect(progressSignal!.reason).toBe(reason);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(tool).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledExactlyOnceWith(run, { status: 'cancelled' });
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
  },
);
