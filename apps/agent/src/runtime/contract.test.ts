/**
 * Behaviour every provider runtime must share. Each case runs once per provider from the same
 * neutral script; provider-specific request shapes live in that provider's own test file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentApi, ApiError, type ExecutionContext } from '../api.js';
import { parseAgentConfig, type Provider } from '../config.js';
import {
  anthropicScript,
  scriptedAnthropicClient,
  scriptedOpenAI,
  type ScriptedTurn,
} from '../testing.js';
import { createRuntime, failureCode, TurnLimitError } from './index.js';

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

const environment = {
  openai: { AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' },
  anthropic: { AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' },
} satisfies Record<Provider, Record<string, string>>;
/** Builds a runtime for one provider and exposes what the model received after each turn. */
function harness(provider: Provider, turns: ScriptedTurn[], maxTurns = 40) {
  const config = parseAgentConfig({
    ...environment[provider],
    AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
    AGENT_MAX_TURNS: String(maxTurns),
  });
  if (provider === 'openai') {
    const model = scriptedOpenAI(turns);
    return {
      runtime: createRuntime(config, { openai: model }),
      modelCalls: () => model.calls.length,
      modelInputs: () => JSON.stringify(model.calls.map((call) => call.request.input)),
    };
  }
  const scripted = scriptedAnthropicClient(anthropicScript(turns));
  return {
    runtime: createRuntime(config, { anthropic: scripted.client }),
    modelCalls: () => scripted.requests.length,
    modelInputs: () => JSON.stringify(scripted.requests.map((request) => request.messages)),
  };
}
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
const signals = () => [new AbortController().signal, new AbortController().signal] as const;
const read = (id?: string) => ({ name: 'read_plan_context', input: {}, ...(id ? { id } : {}) });
const noChange = { result: {}, versionId: null, editNumber: null, planId: null };

describe.each(['openai', 'anthropic'] as const)('%s runtime contract', (provider) => {
  it('completes a tool round trip and returns the final reply', async () => {
    const { runtime, modelCalls } = harness(provider, [
      { type: 'tools', calls: [read()] },
      { type: 'reply', text: 'What would you like to achieve?' },
    ]);
    const api = new AgentApi('http://localhost');
    const tool = vi.spyOn(api, 'tool').mockResolvedValue({ ...noChange, result: { plan: null } });
    const result = await runtime.execute(context, claim, api, ...signals());
    expect(result).toMatchObject({
      content: 'What would you like to achieve?',
      finalOutputItemId: expect.any(String),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
    });
    expect(tool).toHaveBeenCalledOnce();
    expect(tool.mock.calls[0]![1]).toMatchObject({
      operationId: expect.any(String),
      name: 'read_plan_context',
      expectedVersionId: null,
      expectedEditNumber: null,
      input: {},
    });
    expect(modelCalls()).toBe(2);
  });

  it('starts each tool only after the previous one finishes, carrying its latest edit number', async () => {
    const { runtime } = harness(provider, [
      { type: 'tools', calls: [read('a'), read('b')] },
      { type: 'reply', text: 'Done.' },
    ]);
    const api = new AgentApi('http://localhost');
    let active = 0;
    const calls = vi.spyOn(api, 'tool').mockImplementation(async () => {
      expect(active).toBe(0);
      active++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return {
        result: {},
        versionId: 'draft',
        editNumber: calls.mock.calls.length + 1,
        planId: 'p',
      };
    });
    await runtime.execute(context, claim, api, ...signals());
    expect(calls.mock.calls[1]![1]).toMatchObject({
      expectedVersionId: 'draft',
      expectedEditNumber: 2,
    });
  });

  it('stops on an external draft conflict and reports it as stale context', async () => {
    const { runtime } = harness(provider, [{ type: 'tools', calls: [read('a'), read('b')] }]);
    const api = new AgentApi('http://localhost');
    vi.spyOn(api, 'tool')
      .mockResolvedValueOnce({ result: {}, versionId: 'draft', editNumber: 2, planId: 'plan' })
      .mockRejectedValueOnce(new ApiError('STALE_CONTEXT', 409));
    const failure = await runtime.execute(context, claim, api, ...signals()).catch((e) => e);
    expect(failureCode(failure)).toBe('STALE_CONTEXT');
  });

  it('returns correctable tool rejections to the model and caps the final reply', async () => {
    const { runtime, modelInputs } = harness(provider, [
      { type: 'tools', calls: [read()] },
      { type: 'reply', text: 'x'.repeat(40000) },
    ]);
    const api = new AgentApi('http://localhost');
    vi.spyOn(api, 'tool').mockRejectedValueOnce(new ApiError('PLAN_REQUIRED', 409));
    const result = await runtime.execute(context, claim, api, ...signals());
    expect(result.content).toHaveLength(32000);
    expect(modelInputs()).toContain('PLAN_REQUIRED');
  });

  it('rejects an already cancelled run without completing', async () => {
    const { runtime } = harness(provider, []);
    const controller = new AbortController();
    controller.abort('CANCELLED');
    await expect(
      runtime.execute(
        context,
        claim,
        new AgentApi('http://localhost'),
        controller.signal,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it('reports a provider rejection as a provider error', async () => {
    const { runtime } = harness(provider, [{ type: 'error' }]);
    const failure = await runtime
      .execute(context, claim, new AgentApi('http://localhost'), ...signals())
      .catch((e) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failureCode(failure)).toBe('PROVIDER_ERROR');
  });

  it('stops a model that keeps calling tools at the turn limit', async () => {
    const { runtime } = harness(provider, [{ type: 'tools', calls: [read()] }], 1);
    const api = new AgentApi('http://localhost');
    vi.spyOn(api, 'tool').mockResolvedValue(noChange);
    const failure = await runtime.execute(context, claim, api, ...signals()).catch((e) => e);
    expect(failure).toBeInstanceOf(TurnLimitError);
    expect(failureCode(failure)).toBe('TURN_LIMIT');
  });

  it('rejects an empty reply', async () => {
    const { runtime } = harness(provider, [{ type: 'reply', text: '' }]);
    await expect(
      runtime.execute(context, claim, new AgentApi('http://localhost'), ...signals()),
    ).rejects.toThrow('Empty coaching response');
  });

  it('persists text before tools and a separate final segment, with bounded timing measurements', async () => {
    const { runtime } = harness(provider, [
      { type: 'tools', text: 'Let me check.', id: 'commentary', calls: [read()] },
      { type: 'reply', text: 'Here is the answer.', id: 'answer' },
    ]);
    const api = new AgentApi('http://localhost');
    const deliveries: unknown[] = [];
    vi.spyOn(api, 'progress').mockImplementation(async (_claim, input) => {
      deliveries.push(structuredClone(input));
      return { status: 'running' };
    });
    vi.spyOn(api, 'tool').mockImplementation(async () => {
      expect(JSON.stringify(deliveries)).toContain('Let me check.');
      return noChange;
    });
    const result = await runtime.execute(context, claim, api, ...signals());
    expect(result.finalOutputItemId).toBeTruthy();
    const items = deliveries.flatMap(
      (delivery) => (delivery as { items: { itemId: string; content: string }[] }).items,
    );
    const final = items.filter((item) => item.itemId === result.finalOutputItemId).at(-1);
    expect(final?.content).toBe('Here is the answer.');
    expect(items.some((item) => item.itemId !== result.finalOutputItemId)).toBe(true);
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
      const controller = new AbortController();
      const { runtime } = harness(provider, [
        {
          type: 'interrupted',
          text: 'Visible before interruption',
          before: () => {
            if (kind === 'cancellation') controller.abort('CANCELLED');
          },
        },
      ]);
      const api = new AgentApi('http://localhost');
      const progress = vi.spyOn(api, 'progress').mockResolvedValue({ status: 'running' });
      await expect(
        runtime.execute(context, claim, api, controller.signal, new AbortController().signal),
      ).rejects.toThrow();
      expect(JSON.stringify(progress.mock.calls)).toContain('Visible before interruption');
      expect(JSON.stringify(progress.mock.calls)).not.toContain('Scripted provider failure');
    },
  );

  it('caps streamed Unicode replies without corrupting the durable final segment', async () => {
    const { runtime } = harness(provider, [{ type: 'reply', text: 'x' + '😀'.repeat(20000) }]);
    const result = await runtime.execute(
      context,
      claim,
      new AgentApi('http://localhost'),
      ...signals(),
    );
    expect(result.content).toBe('x' + '😀'.repeat(15999));
    expect(result.finalOutputItemId).toBeTruthy();
  });
});
