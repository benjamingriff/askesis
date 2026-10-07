import { Usage } from '@openai/agents';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
  modelResponse,
  modelError,
} from '@openai/agents/testing';
import { SdkRuntime } from './runtime.js';
import { AgentApi, ApiError, type ExecutionContext } from './api.js';
import { parseAgentConfig } from './config.js';
beforeEach(() => {
  vi.spyOn(AgentApi.prototype, 'progress').mockResolvedValue({ status: 'running' });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Network is forbidden in deterministic runtime tests.'))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const config = parseAgentConfig({
  OPENAI_API_KEY: 'test-key',
  AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
});
const claim = {
  runId: '00000000-0000-4000-8000-000000000010',
  token: 'run-token',
  generation: 1,
  deadlineAt: new Date(Date.now() + 60000).toISOString(),
  versionId: null,
  editNumber: null,
};
const context: ExecutionContext = {
  messages: [{ role: 'user', content: 'Help me start running', sequence: 1 }],
  historyTruncated: false,
  plan: null,
  brief: null,
  performance: null,
  versionId: null,
  editNumber: null,
  tools: [
    {
      name: 'read_plan_context',
      description: 'Read scoped plan context',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ],
};
it('uses the SDK tool loop, serial execution and explicit tracing/privacy settings', async () => {
  const model = new ScriptedModel([
    modelResponse({
      usage: new Usage(),
      output: [functionCall('read_plan_context', {}, { callId: 'call1' })],
    }),
    modelResponse({
      usage: new Usage(),
      output: [assistantMessage('What would you like to achieve?')],
    }),
  ]);
  const api = new AgentApi('http://localhost');
  const tool = vi
    .spyOn(api, 'tool')
    .mockResolvedValue({ result: { plan: null }, versionId: null, editNumber: null, planId: null });
  const result = await new SdkRuntime(config, model).execute(
    context,
    claim,
    api,
    new AbortController().signal,
  );
  expect(result.content).toBe('What would you like to achieve?');
  expect(tool).toHaveBeenCalledOnce();
  expect(model.calls[0]!.request.modelSettings).toMatchObject({
    reasoning: { effort: 'medium' },
    parallelToolCalls: false,
    store: false,
  });
  expect(model.calls[0]!.request.tracing).toBe(false);
  expect(model.calls[0]!.request.systemInstructions).toContain(
    'Do not instantly generate a schedule',
  );
});
it('carries its own latest edit number between tools and stops on external conflicts', async () => {
  const model = new ScriptedModel([
    modelResponse({
      usage: new Usage(),
      output: [
        functionCall('read_plan_context', {}, { callId: 'a' }),
        functionCall('read_plan_context', {}, { callId: 'b' }),
      ],
    }),
  ]);
  const api = new AgentApi('http://localhost');
  const calls = vi
    .spyOn(api, 'tool')
    .mockResolvedValueOnce({ result: {}, versionId: 'draft', editNumber: 2, planId: 'plan' })
    .mockRejectedValueOnce(new ApiError('STALE_CONTEXT', 409));
  await expect(
    new SdkRuntime(config, model).execute(context, claim, api, new AbortController().signal),
  ).rejects.toThrow();
  expect(calls.mock.calls[1]![1]).toMatchObject({
    expectedVersionId: 'draft',
    expectedEditNumber: 2,
  });
});
it('propagates cancellation, provider failures and turn-limit exhaustion', async () => {
  const api = new AgentApi('http://localhost');
  const controller = new AbortController();
  controller.abort();
  await expect(
    new SdkRuntime(config, new ScriptedModel([])).execute(context, claim, api, controller.signal),
  ).rejects.toThrow();
  const errorModel = new ScriptedModel([modelError(new Error('provider failed'))]);
  await expect(
    new SdkRuntime(config, errorModel).execute(context, claim, api, new AbortController().signal),
  ).rejects.toThrow();
  const loop = new ScriptedModel([
    modelResponse({
      usage: new Usage(),
      output: [functionCall('read_plan_context', {}, { callId: 'a' })],
    }),
  ]);
  vi.spyOn(api, 'tool').mockResolvedValue({
    result: {},
    versionId: null,
    editNumber: null,
    planId: null,
  });
  await expect(
    new SdkRuntime({ ...config, AGENT_MAX_TURNS: 1 }, loop).execute(
      context,
      claim,
      api,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ name: 'MaxTurnsExceededError' });
});
it('retries an uncertain tool HTTP response with exactly the same operation identity and input', async () => {
  const requests: string[] = [];
  let first = true;
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(String(init?.body));
    if (first) {
      first = false;
      throw new TypeError('Connection lost after commit');
    }
    return new Response(
      JSON.stringify({
        result: { ids: { easy: 'workout-id' } },
        versionId: 'draft',
        editNumber: 3,
        planId: 'plan',
      }),
      { status: 200 },
    );
  };
  const api = new AgentApi('http://localhost', fetcher);
  const result = await api.tool(
    claim,
    {
      operationId: 'stable-op',
      name: 'apply_schedule_changes',
      input: {},
      expectedVersionId: 'draft',
      expectedEditNumber: 2,
    },
    new AbortController().signal,
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  expect(result.editNumber).toBe(3);
});
it('keeps runtime config separate from database and human-auth credentials, and validates the exact model default', () => {
  const parsed = parseAgentConfig({
    OPENAI_API_KEY: 'test',
    AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
    DATABASE_URL: 'private',
    CLERK_SECRET_KEY: 'private',
  });
  expect(parsed.AGENT_MODEL).toBe('gpt-6.1-sol');
  expect(parsed).not.toHaveProperty('DATABASE_URL');
  expect(parsed).not.toHaveProperty('CLERK_SECRET_KEY');
  expect(() =>
    parseAgentConfig({ OPENAI_API_KEY: 'secret-only', AGENT_BOOTSTRAP_TOKEN: 'short' }),
  ).toThrow('AGENT_BOOTSTRAP_TOKEN');
});
it('returns PLAN_REQUIRED to the model so it can create a draft, and caps the final reply length', async () => {
  const model = new ScriptedModel([
    modelResponse({
      usage: new Usage(),
      output: [functionCall('read_plan_context', {}, { callId: 'a' })],
    }),
    modelResponse({
      usage: new Usage(),
      output: [assistantMessage('x'.repeat(40000))],
    }),
  ]);
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'tool').mockRejectedValueOnce(new ApiError('PLAN_REQUIRED', 409));
  const result = await new SdkRuntime(config, model).execute(
    context,
    claim,
    api,
    new AbortController().signal,
  );
  expect(result.content).toHaveLength(32000);
});

it('persists text before tools and a separate final segment, with bounded timing measurements', async () => {
  const model = new ScriptedModel([
    modelResponse({
      usage: new Usage(),
      output: [
        assistantMessage('Let me check.', { id: 'commentary' }),
        functionCall('read_plan_context', {}, { callId: 'read' }),
      ],
    }),
    modelResponse({
      usage: new Usage(),
      output: [assistantMessage('Here is the answer.', { id: 'answer' })],
    }),
  ]);
  const api = new AgentApi('http://localhost');
  const deliveries: unknown[] = [];
  vi.spyOn(api, 'progress').mockImplementation(async (_claim, input) => {
    deliveries.push(structuredClone(input));
    return { status: 'running' };
  });
  vi.spyOn(api, 'tool').mockImplementation(async () => {
    expect(JSON.stringify(deliveries)).toContain('Let me check.');
    return { result: {}, versionId: null, editNumber: null, planId: null };
  });
  const result = await new SdkRuntime(config, model).execute(
    context,
    claim,
    api,
    new AbortController().signal,
  );
  expect(model.calls.every((call) => call.streamed)).toBe(true);
  expect(result.finalOutputItemId).toBeTruthy();
  expect(JSON.stringify(deliveries)).toContain('Here is the answer.');
  expect(deliveries.at(-1)).toMatchObject({
    timings: {
      modelMs: [expect.any(Number), expect.any(Number)],
      toolMs: [expect.any(Number)],
      firstVisibleMs: expect.any(Number),
      firstDurableOutputMs: expect.any(Number),
      totalMs: expect.any(Number),
    },
  });
});
it.each(['provider failure', 'cancellation'] as const)(
  'flushes an accepted visible prefix after %s without a completed answer',
  async (kind) => {
    const { modelStreamResponder } = await import('@openai/agents/testing');
    const controller = new AbortController();
    const model = new ScriptedModel([
      modelStreamResponder(() =>
        (async function* () {
          yield { type: 'response_started' as const };
          yield {
            type: 'output_text_delta' as const,
            itemId: 'partial',
            delta: 'Visible before interruption',
          };
          // Allow the Runner to deliver the text event before failing the provider.
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (kind === 'cancellation') controller.abort('CANCELLED');
          throw new Error('private provider error');
        })(),
      ),
    ]);
    const api = new AgentApi('http://localhost');
    const progress = vi.spyOn(api, 'progress').mockResolvedValue({ status: 'running' });
    await expect(
      new SdkRuntime(config, model).execute(context, claim, api, controller.signal),
    ).rejects.toThrow();
    expect(JSON.stringify(progress.mock.calls)).toContain('Visible before interruption');
    expect(JSON.stringify(progress.mock.calls)).not.toContain('private provider error');
  },
);
it('retries progress and finish transport delivery with stable payloads', async () => {
  const requests: unknown[] = [];
  let fail = true;
  const api = new AgentApi('http://localhost', async (_url, init) => {
    requests.push(init?.body);
    if (fail) {
      fail = false;
      throw new TypeError('Acknowledgement lost');
    }
    return new Response(JSON.stringify({ status: 'running' }));
  });
  // Restore the class method mocked by this suite's deterministic runtime setup.
  vi.mocked(AgentApi.prototype.progress).mockRestore();
  await api.progress(claim, { sequence: 1, items: [] });
  expect(requests[0]).toEqual(requests[1]);
  requests.length = 0;
  fail = true;
  await api.finish(claim, { status: 'failed', failureCode: 'PROVIDER_ERROR' });
  expect(requests[0]).toEqual(requests[1]);
});
it('caps streamed Unicode replies without corrupting the durable final segment', async () => {
  const content = 'x' + '😀'.repeat(20000);
  const model = new ScriptedModel([
    modelResponse({ usage: new Usage(), output: [assistantMessage(content)] }),
  ]);
  const api = new AgentApi('http://localhost');
  const result = await new SdkRuntime(config, model).execute(
    context,
    claim,
    api,
    new AbortController().signal,
  );
  expect(result.content).toBe('x' + '😀'.repeat(15999));
  expect(result.finalOutputItemId).toBeTruthy();
});
