import { Agent, Runner, OpenAIResponsesModel, type Model } from '@openai/agents';
import { expect, it } from 'vitest';
import { scriptedOpenAI, rawResponse, scriptedResponsesClient } from './testing.js';
import {
  AnthropicUsageObserver,
  UsageLedger,
  coachRequestDefaults,
  normalizeOpenAIUsage,
  normalizeAnthropicUsage,
  observeOpenAIModel,
  observeStream,
  readUsageLedger,
} from './usage.js';

const defaults = coachRequestDefaults({
  provider: 'openai',
  model: 'gpt-6.1-sol',
  reasoning: 'low',
  maxOutputTokens: 256,
});
const fullUsage = {
  input_tokens: 12,
  input_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
  output_tokens: 3,
  output_tokens_details: { reasoning_tokens: 1 },
  total_tokens: 15,
};

it('keeps provider zero distinct from missing usage and separates cache writes from ordinary input', () => {
  expect(normalizeOpenAIUsage(fullUsage).tokens).toMatchObject({
    input: 12,
    uncachedInput: 6,
    cacheRead: 4,
    cacheWrite: 2,
    output: 3,
    reasoning: 1,
  });
  expect(normalizeOpenAIUsage(undefined)).toMatchObject({
    usageSource: 'provider_missing',
    tokens: { input: null, output: null },
  });
  expect(normalizeOpenAIUsage({ input_tokens: 0, output_tokens: 0 })).toMatchObject({
    usageSource: 'provider',
    tokens: { input: 0, output: 0, cacheRead: null },
  });
  expect(
    normalizeOpenAIUsage({
      input_tokens: 2,
      input_tokens_details: { cached_tokens: 3, cache_write_tokens: 0 },
    }).tokens.uncachedInput,
  ).toBeNull();
  expect(
    normalizeAnthropicUsage({
      input_tokens: 12,
      cache_creation_input_tokens: 8,
      cache_read_input_tokens: 6,
      cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 5 },
      output_tokens: 9,
      output_tokens_details: { thinking_tokens: 3 },
    }).tokens,
  ).toEqual({
    input: 26,
    uncachedInput: 12,
    cacheRead: 6,
    cacheWrite: 8,
    cacheWrite5m: 3,
    cacheWrite1h: 5,
    output: 9,
    reasoning: 3,
  });
  expect(
    normalizeAnthropicUsage({ input_tokens: 12, cache_read_input_tokens: null }).tokens.input,
  ).toBeNull();
});

it('projects bounded safe metadata and rejects malformed saved ledgers rather than treating them as complete', () => {
  const ledger = new UsageLedger(defaults);
  ledger.begin().fromOpenAIResponse({
    status: 'completed',
    model: 'gpt-6.1-sol',
    service_tier: 'default',
    usage: {
      ...fullUsage,
      authorization: 'Bearer SECRET',
      thinking: 'HIDDEN',
      input_tokens_details: { cached_tokens: 4, cache_write_tokens: 2, forbidden: 'SECRET' },
    },
  });
  const json = ledger.toJSON();
  expect(JSON.stringify(json)).not.toMatch(/SECRET|HIDDEN|authorization|thinking/);
  expect(readUsageLedger(json)).toEqual(json);
  for (const value of [
    null,
    {},
    { ...json, version: 2 },
    { ...json, requests: [{ ...json.requests[0], tokens: {} }] },
    { ...json, requests: [json.requests[0], json.requests[0]] },
    { ...json, requests: [{ ...json.requests[0], raw: { secret: 'SECRET' } }] },
  ])
    expect(readUsageLedger(value)).toBeNull();
  for (let index = 1; index < 203; index++) ledger.begin().noResponse();
  expect(ledger.toJSON()).toMatchObject({ omittedRequests: 3 });
  expect(ledger.toJSON().requests).toHaveLength(200);
});

it('retains cumulative Anthropic deltas as partial observations, including explicit zero replacements', () => {
  const observer = new AnthropicUsageObserver();
  observer.observe({
    type: 'message_start',
    message: {
      id: 'msg_test',
      model: 'claude-opus-5-5',
      content: ['HIDDEN'],
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        service_tier: 'standard',
      },
    },
  });
  expect(normalizeAnthropicUsage(observer.interruption()!.anthropicUsage).tokens.output).toBeNull();
  observer.observe({
    type: 'message_delta',
    usage: {
      input_tokens: 14,
      cache_read_input_tokens: 6,
      output_tokens: 9,
      output_tokens_details: { thinking_tokens: 3 },
    },
  });
  observer.observe({
    type: 'message_delta',
    usage: {
      cache_read_input_tokens: 0,
      output_tokens: 11,
      output_tokens_details: { thinking_tokens: 0 },
    },
  });
  const ledger = new UsageLedger({ ...defaults, provider: 'anthropic' });
  ledger.begin().interrupted(observer.interruption()!);
  expect(ledger.toJSON().requests[0]).toMatchObject({
    status: 'interrupted',
    usageSource: 'provider',
    usageCompleteness: 'partial',
    returnedModel: 'claude-opus-5-5',
    tokens: { input: 14, cacheRead: 0, output: 11, reasoning: 0 },
  });
  expect(JSON.stringify(ledger)).not.toContain('HIDDEN');
});

async function realSdk(response: Record<string, unknown>, observed: boolean) {
  const scripted = scriptedResponsesClient([{ type: 'response', response }]);
  const delegate = new OpenAIResponsesModel(
    scripted.client as unknown as ConstructorParameters<typeof OpenAIResponsesModel>[0],
    'gpt-6.1-sol',
  );
  const order: string[] = [];
  const model: Model = {
    supportsPromptModelSelection: true,
    getResponse: delegate.getResponse.bind(delegate),
    async *getStreamedResponse(request) {
      for await (const event of delegate.getStreamedResponse(request)) {
        order.push(
          event.type === 'model'
            ? `model:${String((event.event as { type?: string }).type)}`
            : event.type,
        );
        yield event;
      }
    },
  };
  const ledger = new UsageLedger(defaults);
  const agent = new Agent({
    name: 'Usage fixture',
    instructions: 'Reply briefly.',
    model: observed ? observeOpenAIModel(model, ledger) : model,
    modelSettings: { store: false, reasoning: { effort: 'low' }, maxTokens: 256 },
  });
  const result = await new Runner({ tracingDisabled: true }).run(agent, 'Hello', {
    stream: true,
    maxTurns: 1,
  });
  let error: unknown;
  try {
    for await (const _event of result) {
      /* consume SDK events */
    }
    await result.completed;
  } catch (caught) {
    error = caught;
  }
  return {
    ledger,
    order,
    error,
    sdkUsage: result.runContext.usage,
    calls: scripted.calls.map(({ body, options }) => {
      const { signal, ...other } = options;
      return {
        body,
        options: other,
        signal:
          signal instanceof AbortSignal
            ? { aborted: signal.aborted, reason: signal.reason }
            : signal,
      };
    }),
  };
}

it.each([
  ['reported', fullUsage, 'provider', 12],
  ['missing', undefined, 'provider_missing', null],
  [
    'zero',
    {
      input_tokens: 0,
      output_tokens: 0,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    'provider',
    0,
  ],
] as const)(
  'prefers raw %s usage despite response_done preceding response.completed in the real SDK',
  async (_label, usage, source, input) => {
    const response = rawResponse({
      ...(usage ? { usage: { ...usage } } : {}),
      serviceTier: 'flex',
    });
    const actual = await realSdk(response, true);
    const baseline = await realSdk(response, false);
    expect(actual.error).toBeUndefined();
    expect(actual.order.indexOf('response_done')).toBeLessThan(
      actual.order.indexOf('model:response.completed'),
    );
    expect(actual.order).toEqual(baseline.order);
    expect(actual.calls).toEqual(baseline.calls);
    expect(actual.ledger.toJSON().requests[0]).toMatchObject({
      usageSource: source,
      tokens: { input },
      returnedServiceTier: 'flex',
      returnedModel: 'gpt-6.1-sol',
    });
    if (source === 'provider_missing') expect(actual.sdkUsage.inputTokens).toBe(0);
  },
);

it.each(['failed', 'incomplete'] as const)(
  'retains raw usage before the real SDK throws for a %s terminal',
  async (status) => {
    const response = rawResponse({ status, usage: fullUsage, serviceTier: 'flex' });
    const actual = await realSdk(response, true);
    const baseline = await realSdk(response, false);
    expect(actual.error).toMatchObject({
      name: 'ModelBehaviorError',
      message: (baseline.error as Error).message,
    });
    expect(actual.calls).toEqual(baseline.calls);
    expect(actual.ledger.toJSON().requests[0]).toMatchObject({
      status,
      usageSource: 'provider',
      tokens: { input: 12, cacheRead: 4 },
    });
  },
);

it('defers a genuinely SDK-only response until closure and preserves events, error identity and early return', async () => {
  const ledger = new UsageLedger(defaults);
  const handle = ledger.begin();
  const first = { type: 'response_started' };
  const done = { type: 'response_done', response: { usage: { inputTokens: 7, outputTokens: 2 } } };
  async function* events() {
    yield first;
    yield done;
  }
  const stream = observeStream(events(), handle);
  expect((await stream.next()).value).toBe(first);
  expect((await stream.next()).value).toBe(done);
  // Projecting an open entry does not settle it; a later raw terminal must still win.
  expect(ledger.toJSON().requests[0]!.usageSource).toBe('sdk_normalized');
  await stream.next();
  expect(ledger.legacyTotals()).toEqual({ inputTokens: 7, outputTokens: 2 });
  const error = new Error('test connection');
  const interrupted = ledger.begin();
  async function* failing() {
    yield first;
    throw error;
  }
  const failed = observeStream(failing(), interrupted);
  await failed.next();
  await expect(failed.next()).rejects.toBe(error);
  expect(ledger.toJSON().requests[1]!.status).toBe('interrupted');
  let closed = false;
  async function* long() {
    try {
      yield first;
      yield done;
    } finally {
      closed = true;
    }
  }
  const early = observeStream(long(), ledger.begin());
  await early.next();
  await early.return(undefined);
  expect(closed).toBe(true);
  const later = new UsageLedger(defaults);
  const h = later.begin();
  h.deferSdkUsage({ inputTokens: 0, outputTokens: 0 });
  later.toJSON();
  h.fromOpenAIResponse(rawResponse({ usage: fullUsage }));
  expect(later.toJSON().requests[0]!.usageSource).toBe('provider');
});

it('records scripted model totals as unverified rather than provider-measured zero', async () => {
  const model = scriptedOpenAI([{ type: 'reply', text: 'Hi' }]);
  const ledger = new UsageLedger(defaults);
  const result = await new Runner({ tracingDisabled: true }).run(
    new Agent({ name: 'Scripted', model: observeOpenAIModel(model, ledger) }),
    'Hi',
    { stream: true },
  );
  for await (const _event of result) {
    /* consume */
  }
  await result.completed;
  expect(ledger.toJSON().requests[0]).toMatchObject({
    usageSource: 'sdk_normalized',
    usageCompleteness: 'unknown',
  });
});
