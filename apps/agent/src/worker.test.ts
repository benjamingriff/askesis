import { afterEach, expect, it, vi } from 'vitest';
import { AgentApi, ApiError, type ExecutionContext } from './api.js';
import { parseAgentConfig } from './config.js';
import { Worker } from './worker.js';
import type { CoachingRuntime } from './runtime/index.js';

// Vitest's fake clock does not replace node:timers/promises. Use the fake-clock-backed
// equivalent so registration backoff and shutdown can be exercised without real waits.
vi.mock('node:timers/promises', () => ({
  setTimeout: (delay: number, value?: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve(value);
      }, delay);
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
    }),
}));

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
  trainingLog: null,
  tools: [],
  versionId: null,
  editNumber: null,
};
afterEach(() => vi.useRealTimers());

it.each([
  ['incompatible API during rollout', new ApiError('VALIDATION_ERROR', 400)],
  ['API unavailable', new ApiError('AGENT_UNAVAILABLE', 503)],
  ['connection failure', new TypeError('Private connection detail')],
])('waits for registration after a minute of %s before claiming work', async (_name, error) => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  let available = false;
  const register = vi.spyOn(api, 'register').mockImplementation(async () => {
    if (!available) throw error;
    return { registered: true };
  });
  const runtime = { execute: vi.fn() };
  const report = vi.fn();
  const worker = new Worker(config, api, runtime, report);
  const claim = vi.spyOn(api, 'claim').mockImplementation(async () => {
    worker.stop();
    return { claim: null };
  });
  const running = worker.run();
  await vi.advanceTimersByTimeAsync(60000);
  expect(register).toHaveBeenCalledTimes(13);
  expect(claim).not.toHaveBeenCalled();
  expect(runtime.execute).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith(
    'REGISTRATION_FAILED',
    undefined,
    expect.objectContaining({
      operation: 'register',
      phase: 'startup',
      attempt: 13,
      retryInMs: 5000,
      ...(error instanceof ApiError ? { httpStatus: error.status, apiCode: error.code } : {}),
    }),
  );
  expect(JSON.stringify(report.mock.calls)).not.toContain('Private connection detail');

  available = true;
  await vi.advanceTimersByTimeAsync(6000);
  await running;
  expect(claim).toHaveBeenCalledExactlyOnceWith(config.AGENT_BOOTSTRAP_TOKEN, worker.id);
  expect(register.mock.calls.every(([, input]) => (input as { id: string }).id === worker.id)).toBe(
    true,
  );
  expect(register.mock.lastCall?.[1]).toMatchObject({ ready: false });
  expect(report).toHaveBeenCalledWith('WORKER_READY', undefined, {
    operation: 'register',
    phase: 'startup',
    attempt: 14,
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('stops immediately during a registration retry delay without claiming or registering readiness', async () => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  const register = vi.spyOn(api, 'register').mockRejectedValue(new ApiError('API_ERROR', 503));
  const claim = vi.spyOn(api, 'claim');
  const worker = new Worker(config, api, { execute: vi.fn() });
  const running = worker.run();
  await vi.advanceTimersByTimeAsync(0);
  worker.stop();
  await running;
  expect(register).toHaveBeenCalledOnce();
  expect(claim).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('maps completed output and usage into one final API command', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'completed' });
  const runtime = {
    execute: vi.fn<CoachingRuntime['execute']>(async (...args) => {
      args[5]
        .begin()
        .fromOpenAIResponse({ status: 'completed', usage: { input_tokens: 12, output_tokens: 5 } });
      return { content: 'What is your goal?' };
    }),
  };
  await new Worker(config, api, runtime).execute(claim);
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, {
    status: 'completed',
    content: 'What is your goal?',
    inputTokens: 12,
    outputTokens: 5,
    usage: expect.objectContaining({
      version: 1,
      requests: [expect.objectContaining({ usageSource: 'provider', usageCompleteness: 'final' })],
      omittedRequests: 0,
    }),
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
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, {
    status: 'cancelled',
    usage: { version: 1, requests: [], omittedRequests: 0 },
  });
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
    usage: { version: 1, requests: [], omittedRequests: 0 },
  });
});

it('logs a terminal delivery failure separately from the original provider failure', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  vi.spyOn(api, 'finish').mockRejectedValue(new ApiError('MACHINE_AUTH_REQUIRED', 401));
  const report = vi.fn();
  await new Worker(
    config,
    api,
    {
      execute: vi.fn().mockRejectedValue(new Error('private provider error')),
    },
    report,
  ).execute(claim);
  expect(report).toHaveBeenCalledExactlyOnceWith('FINISH_FAILED', claim.runId, {
    operation: 'finish',
    phase: 'running',
    failureCode: 'PROVIDER_ERROR',
    errorKind: 'http',
    httpStatus: 401,
    apiCode: 'MACHINE_AUTH_REQUIRED',
  });
  expect(JSON.stringify(report.mock.calls)).not.toContain('private');
});

it('logs queue polling failures with HTTP context and retry delay', async () => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'register').mockResolvedValue({ registered: true });
  const report = vi.fn();
  const worker = new Worker(config, api, { execute: vi.fn() }, report);
  vi.spyOn(api, 'claim')
    .mockRejectedValueOnce(new ApiError('AGENT_UNAVAILABLE', 503))
    .mockImplementation(async () => {
      worker.stop();
      return { claim: null };
    });
  const running = worker.run();
  await vi.advanceTimersByTimeAsync(2000);
  await running;
  expect(report).toHaveBeenCalledWith('POLL_FAILED', undefined, {
    operation: 'claim',
    phase: 'running',
    retryInMs: 1000,
    errorKind: 'http',
    httpStatus: 503,
    apiCode: 'AGENT_UNAVAILABLE',
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

const cancellationCases = (['openai', 'anthropic'] as const).flatMap((provider) =>
  (['shutdown', 'lease loss', 'deadline', 'cancellation only'] as const).map(
    (stop) => [provider, stop] as const,
  ),
);
/** A provider stream that shows a prefix when told, then fails only once its request aborts. */
async function blockingProvider(
  provider: 'openai' | 'anthropic',
  emit: Promise<void>,
  onSignal: (signal: AbortSignal) => void,
) {
  const untilAborted = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
  const providerConfig = parseAgentConfig(
    provider === 'openai'
      ? { OPENAI_API_KEY: 'test', AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters' }
      : {
          AGENT_PROVIDER: 'anthropic',
          ANTHROPIC_API_KEY: 'test',
          AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
        },
  );
  const { createRuntime } = await import('./runtime/index.js');
  if (provider === 'openai') {
    const { ScriptedModel, modelStreamResponder } = await import('@openai/agents/testing');
    const model = new ScriptedModel([
      modelStreamResponder(({ request }) =>
        (async function* () {
          onSignal(request.signal!);
          yield { type: 'response_started' as const };
          await emit;
          yield {
            type: 'output_text_delta' as const,
            itemId: 'prefix',
            delta: 'Accepted before cancellation',
          };
          await untilAborted(request.signal!);
          throw new Error('Provider interrupted');
        })(),
      ),
    ]);
    return { config: providerConfig, runtime: createRuntime(providerConfig, { openai: model }) };
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { anthropicEvents, serverSentEvents } = await import('./testing.js');
  const events = anthropicEvents(
    {
      type: 'message',
      content: [{ type: 'text', text: 'Accepted before cancellation' }],
      stopReason: 'end_turn',
    },
    'claude-opus-5-5',
    'msg_prefix',
  );
  const client = new Anthropic({
    apiKey: 'test',
    maxRetries: 0,
    fetch: async (_url, init) => {
      const signal = init!.signal!;
      onSignal(signal);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(serverSentEvents(events.slice(0, 2))));
          await emit;
          controller.enqueue(encoder.encode(serverSentEvents(events.slice(2, 3))));
          await untilAborted(signal);
          controller.error(new Error('Provider interrupted'));
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return { config: providerConfig, runtime: createRuntime(providerConfig, { anthropic: client }) };
}

it.each(cancellationCases)(
  '%s preserves cancellation prefix flushing while observing a later %s',
  async (provider, stop) => {
    vi.useFakeTimers();
    const emit = deferred<void>();
    const pending = deferred<void>();
    const delivery = deferred<Response>();
    let providerSignal: AbortSignal | undefined;
    const { config, runtime } = await blockingProvider(provider, emit.promise, (signal) => {
      providerSignal = signal;
    });
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
    expect(providerSignal!.aborted).toBe(true);
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
    expect(finish).toHaveBeenCalledExactlyOnceWith(
      run,
      expect.objectContaining({
        status: 'cancelled',
        usage: expect.objectContaining({
          version: 1,
          requests: [
            expect.objectContaining({
              status: expect.stringMatching(/interrupted|error_without_response/),
            }),
          ],
        }),
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
  },
);

it('reports completed usage when a later provider operation fails', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'failed' });
  const runtime = {
    execute: vi.fn<CoachingRuntime['execute']>(async (...args) => {
      args[5]
        .begin()
        .fromOpenAIResponse({ status: 'completed', usage: { input_tokens: 12, output_tokens: 3 } });
      throw new Error('Private provider failure');
    }),
  };
  await new Worker(config, api, runtime).execute(claim);
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    claim,
    expect.objectContaining({
      status: 'failed',
      failureCode: 'PROVIDER_ERROR',
      inputTokens: 12,
      outputTokens: 3,
      usage: expect.objectContaining({
        requests: [
          expect.objectContaining({
            status: 'completed',
            tokens: expect.objectContaining({ input: 12 }),
          }),
        ],
      }),
    }),
  );
  expect(JSON.stringify(finish.mock.calls)).not.toContain('Private');
});

it('resends identical finish bytes including detailed usage after a transport failure', async () => {
  const bodies: string[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/finish')) throw new Error('Unexpected request');
    bodies.push(String(init!.body));
    if (bodies.length === 1) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ status: 'completed' }));
  });
  const api = new AgentApi('http://localhost', fetcher);
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const runtime = {
    execute: vi.fn<CoachingRuntime['execute']>(async (...args) => {
      args[5]
        .begin()
        .fromOpenAIResponse({ status: 'completed', usage: { input_tokens: 12, output_tokens: 3 } });
      return { content: 'Done.' };
    }),
  };
  await new Worker(config, api, runtime).execute(claim);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[0]!).usage.requests).toHaveLength(1);
});

it('keeps completed and interrupted requests when the execution deadline aborts the worker', async () => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'failed' });
  const runtime = {
    execute: vi.fn<CoachingRuntime['execute']>(async (...args) => {
      args[5]
        .begin()
        .fromOpenAIResponse({ status: 'completed', usage: { input_tokens: 12, output_tokens: 3 } });
      const inFlight = args[5].begin();
      inFlight.responseStarted();
      return new Promise<never>((_resolve, reject) =>
        args[3].addEventListener(
          'abort',
          () => {
            inFlight.interrupted();
            reject(args[3].reason);
          },
          { once: true },
        ),
      );
    }),
  };
  const run = { ...claim, deadlineAt: new Date(Date.now() + 50).toISOString() };
  const executing = new Worker(config, api, runtime).execute(run);
  await vi.advanceTimersByTimeAsync(50);
  await executing;
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    run,
    expect.objectContaining({
      status: 'failed',
      failureCode: 'EXECUTION_TIMEOUT',
      inputTokens: 12,
      outputTokens: 3,
      usage: expect.objectContaining({
        requests: [
          expect.objectContaining({ status: 'completed' }),
          expect.objectContaining({
            status: 'interrupted',
            tokens: expect.objectContaining({ input: null, output: null }),
          }),
        ],
      }),
    }),
  );
  expect(vi.getTimerCount()).toBe(0);
});
