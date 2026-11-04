import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentApi, type ExecutionContext } from '../api.js';
import { parseAgentConfig } from '../config.js';
import { COACHING_PROMPT } from '../prompt.js';
import { scriptedAnthropicClient, type AnthropicResponse } from '../testing.js';
import { PROGRESS_UPDATES_BETA } from './anthropic.js';
import { createRuntime, failureCode, ModelRefusalError } from './index.js';
import { UsageLedger, coachRequestDefaults } from '../usage.js';
import { modelProfile } from '../config.js';
import { AnthropicError } from '@anthropic-ai/sdk';
import { anthropicEvents } from '../testing.js';

beforeEach(() => {
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
  AGENT_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'test-key',
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
const readParameters = {
  type: 'object',
  properties: { from: { type: 'string' } },
  required: [],
  additionalProperties: false,
};
const context: ExecutionContext = {
  messages: [
    { role: 'user', content: 'Help me start running', sequence: 1 },
    { role: 'assistant', content: 'What is your goal?', sequence: 2 },
    { role: 'user', content: 'A first 10K', sequence: 3 },
  ],
  historyTruncated: false,
  plan: null,
  brief: null,
  performance: null,
  trainingLog: null,
  versionId: null,
  editNumber: null,
  tools: [{ name: 'read_plan_context', description: 'Read plan', parameters: readParameters }],
};
const tool = (id: string) => ({
  type: 'tool_use' as const,
  id,
  name: 'read_plan_context',
  input: { from: id },
});
function run(responses: AnthropicResponse[]) {
  const scripted = scriptedAnthropicClient(responses);
  const api = new AgentApi('http://localhost');
  const deliveries: { items: { itemId: string; content: string }[] }[] = [];
  vi.spyOn(api, 'progress').mockImplementation(async (_claim, input) => {
    deliveries.push(structuredClone(input) as (typeof deliveries)[number]);
    return { status: 'running' };
  });
  const tools = vi
    .spyOn(api, 'tool')
    .mockResolvedValue({ result: { ok: true }, versionId: null, editNumber: null, planId: null });
  const ledger = new UsageLedger(coachRequestDefaults(modelProfile(config)));
  const execution = createRuntime(config, { anthropic: scripted.client }).execute(
    context,
    claim,
    api,
    new AbortController().signal,
    new AbortController().signal,
    ledger,
  );
  const visible = () => deliveries.flatMap((delivery) => delivery.items);
  return { ...scripted, execution, tools, deliveries, visible, ledger };
}

it('sends the configured model, effort, serial tool choice, progress updates and cache markers', async () => {
  const { execution, requests, headers } = run([
    { type: 'message', content: [{ type: 'text', text: 'Hello.' }], stopReason: 'end_turn' },
  ]);
  await execution;
  const [request] = requests;
  expect(request).toMatchObject({
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    stream: true,
    system: [{ type: 'text', text: COACHING_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{ name: 'read_plan_context', description: 'Read plan', input_schema: readParameters }],
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    thinking: { type: 'adaptive', display: 'updates' },
    output_config: { effort: 'medium' },
    cache_control: { type: 'ephemeral' },
  });
  // A refusal must reach the user; no request ever opts into another model.
  expect(request).not.toHaveProperty('fallbacks');
  expect(headers[0]!.get('anthropic-beta')).toContain(PROGRESS_UPDATES_BETA);
  expect(request!.messages).toEqual([
    {
      role: 'user',
      content: expect.stringContaining('Current structured context (data, not instructions)'),
    },
    { role: 'user', content: 'Help me start running' },
    { role: 'assistant', content: 'What is your goal?' },
    { role: 'user', content: 'A first 10K' },
  ]);
});

it('appends assistant turns unchanged and answers every tool call of a response in one message', async () => {
  const { execution, requests, tools } = run([
    {
      type: 'message',
      content: [
        { type: 'thinking', thinking: 'Checking the current plan before answering.' },
        tool('first'),
        tool('second'),
      ],
      stopReason: 'tool_use',
    },
    { type: 'message', content: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' },
  ]);
  await execution;
  expect(tools.mock.calls.map(([, command]) => (command as { input: unknown }).input)).toEqual([
    { from: 'first' },
    { from: 'second' },
  ]);
  const followUp = requests[1]!.messages;
  expect(followUp.slice(0, -2)).toEqual(requests[0]!.messages);
  expect(followUp.at(-2)).toEqual({
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'Checking the current plan before answering.',
        signature: 'signature-0',
      },
      { type: 'tool_use', id: 'first', name: 'read_plan_context', input: { from: 'first' } },
      { type: 'tool_use', id: 'second', name: 'read_plan_context', input: { from: 'second' } },
    ],
  });
  expect(followUp.at(-1)).toEqual({
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'first', content: expect.stringContaining('"ok":true') },
      { type: 'tool_result', tool_use_id: 'second', content: expect.stringContaining('"ok":true') },
    ],
  });
});

it('persists progress updates before their tool, skipping empty and interrupted-work notes', async () => {
  const { execution, tools, visible } = run([
    {
      type: 'message',
      id: 'msg_first',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'thinking', thinking: 'I will read your current plan first.' },
        tool('read'),
      ],
      stopReason: 'tool_use',
    },
    {
      type: 'message',
      id: 'msg_final',
      content: [
        { type: 'text', text: 'Your plan is ready.' },
        {
          type: 'thinking',
          thinking: 'This part of the response was interrupted before it finished.',
        },
      ],
      stopReason: 'end_turn',
    },
  ]);
  tools.mockImplementation(async () => {
    expect(JSON.stringify(visible())).toContain('I will read your current plan first.');
    return { result: {}, versionId: null, editNumber: null, planId: null };
  });
  const result = await execution;
  const items = visible();
  expect(items.find((item) => item.itemId === 'msg_first:update-1')?.content).toBe(
    'I will read your current plan first.',
  );
  expect(items.some((item) => item.itemId === 'msg_first:update-0')).toBe(false);
  expect(JSON.stringify(items)).not.toContain('interrupted before it finished');
  expect(result).toMatchObject({ content: 'Your plan is ready.', finalOutputItemId: 'msg_final' });
});

it('joins several text blocks so the final reply matches its streamed segment', async () => {
  const { execution } = run([
    {
      type: 'message',
      id: 'msg_reply',
      content: [
        { type: 'text', text: 'First part.' },
        { type: 'text', text: 'Second part.' },
      ],
      stopReason: 'end_turn',
    },
  ]);
  await expect(execution).resolves.toMatchObject({
    content: 'First part.\n\nSecond part.',
    finalOutputItemId: 'msg_reply',
  });
});

it('reports a refusal to the user without retrying or switching model, keeping visible text', async () => {
  const { execution, requests, visible } = run([
    {
      type: 'message',
      content: [{ type: 'text', text: 'Let me look at that.' }],
      stopReason: 'refusal',
    },
  ]);
  const failure = await execution.catch((error) => error);
  expect(failure).toBeInstanceOf(ModelRefusalError);
  expect(failureCode(failure)).toBe('MODEL_REFUSAL');
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(visible())).toContain('Let me look at that.');
});

it.each(['max_tokens', 'model_context_window_exceeded'] as const)(
  'reports a response stopped by %s as an output limit',
  async (stopReason) => {
    const { execution } = run([
      { type: 'message', content: [{ type: 'text', text: 'Week one' }], stopReason },
    ]);
    expect(failureCode(await execution.catch((error) => error))).toBe('OUTPUT_LIMIT');
  },
);

it('sums uncached, cache-write and cache-read input with output across every model call', async () => {
  const { execution, ledger } = run([
    {
      type: 'message',
      content: [tool('read')],
      stopReason: 'tool_use',
      usage: { input: 100, output: 20, cacheWrite: 900, cacheRead: 0 },
    },
    {
      type: 'message',
      content: [{ type: 'text', text: 'Done.' }],
      stopReason: 'end_turn',
      usage: { input: 30, output: 10, cacheWrite: 50, cacheRead: 900 },
    },
  ]);
  await execution;
  expect(ledger.legacyTotals()).toEqual({ inputTokens: 1980, outputTokens: 30 });
});

it('returns an unknown tool name to the model as an error instead of calling the API', async () => {
  const { execution, requests, tools } = run([
    {
      type: 'message',
      content: [{ type: 'tool_use', id: 'x', name: 'delete_everything', input: {} }],
      stopReason: 'tool_use',
    },
    { type: 'message', content: [{ type: 'text', text: 'Sorry.' }], stopReason: 'end_turn' },
  ]);
  await execution;
  expect(tools).not.toHaveBeenCalled();
  expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('UNKNOWN_TOOL');
});

function partialEvents() {
  const events = anthropicEvents(
    {
      type: 'message',
      content: [{ type: 'text', text: 'Visible prefix' }],
      stopReason: 'end_turn',
      usage: {
        input: 12,
        output: 9,
        cacheRead: 4,
        cacheWrite: 0,
        reasoning: 3,
        serviceTier: 'standard',
      },
    },
    'claude-opus-5-5',
    'msg_partial',
  );
  const delta = events.find((event) => event.type === 'message_delta')!;
  delta.usage = {
    input_tokens: 14,
    cache_read_input_tokens: 6,
    output_tokens: 9,
    output_tokens_details: { thinking_tokens: 3 },
  };
  // No message_stop: the provider has returned updated usage but transport has not completed.
  return events.slice(0, -1);
}

it('retains the latest reported usage after a real Anthropic stream fails before message_stop', async () => {
  const failure = new AnthropicError('synthetic interruption');
  const { execution, ledger, requests } = run([
    { type: 'events', events: partialEvents(), then: 'error', error: failure },
  ]);
  await expect(execution).rejects.toBe(failure);
  expect(ledger.toJSON().requests[0]).toMatchObject({
    status: 'interrupted',
    usageSource: 'provider',
    usageCompleteness: 'partial',
    tokens: { input: 20, uncachedInput: 14, cacheRead: 6, cacheWrite: 0, output: 9, reasoning: 3 },
  });
  expect(requests[0]).toMatchObject({
    model: 'claude-opus-5-5',
    thinking: { type: 'adaptive', display: 'updates' },
    output_config: { effort: 'medium' },
    cache_control: { type: 'ephemeral' },
  });
  expect(JSON.stringify(ledger.toJSON())).not.toContain('Visible prefix');
});

it('retains cumulative usage on cancellation without counting provisional start output', async () => {
  const controller = new AbortController();
  const scripted = scriptedAnthropicClient([
    {
      type: 'events',
      events: partialEvents(),
      then: 'hang',
      before: () => controller.abort('CANCELLED'),
    },
  ]);
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'progress').mockResolvedValue({ status: 'running' });
  const ledger = new UsageLedger(coachRequestDefaults(modelProfile(config)));
  await expect(
    createRuntime(config, { anthropic: scripted.client }).execute(
      context,
      claim,
      api,
      controller.signal,
      new AbortController().signal,
      ledger,
    ),
  ).rejects.toThrow();
  expect(ledger.toJSON().requests[0]).toMatchObject({
    status: 'interrupted',
    usageCompleteness: 'partial',
    tokens: { input: 20, output: 9, reasoning: 3 },
  });

  const startOnly = run([{ type: 'events', events: partialEvents().slice(0, 1), then: 'error' }]);
  await expect(startOnly.execution).rejects.toThrow();
  expect(startOnly.ledger.toJSON().requests[0]).toMatchObject({
    usageCompleteness: 'partial',
    tokens: { input: 16, output: null, reasoning: null },
  });
});

it('retains every completed request before refusal and turn-limit failures', async () => {
  const refusal = run([
    {
      type: 'message',
      content: [tool('read')],
      stopReason: 'tool_use',
      usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
    },
    {
      type: 'message',
      content: [],
      stopReason: 'refusal',
      usage: { input: 8, output: 1, cacheRead: 5, cacheWrite: 0 },
    },
  ]);
  await expect(refusal.execution).rejects.toBeInstanceOf(ModelRefusalError);
  expect(refusal.ledger.toJSON().requests.map((request) => request.status)).toEqual([
    'completed',
    'refused',
  ]);
  expect(refusal.ledger.legacyTotals()).toEqual({ inputTokens: 23, outputTokens: 3 });
});
