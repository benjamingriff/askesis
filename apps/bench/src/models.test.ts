import OpenAI from 'openai';
import {
  Agent,
  Runner,
  OpenAIProvider,
  OpenAIResponsesModel,
  withTrace,
  type ModelRequest,
} from '@openai/agents';
import { describe, expect, it } from 'vitest';
import {
  EvaluationModels,
  ObservedResponsesModel,
  evaluatorLedger,
  criteria,
  ReviewValidationError,
} from './models.js';

const usage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
  output_tokens: 10,
  output_tokens_details: { reasoning_tokens: 3 },
};
const raw = (status = 'completed', counts: unknown = usage) => ({
  object: 'response',
  id: 'resp-test',
  model: 'gpt-6.1-sol',
  service_tier: 'default',
  status,
  output: [
    {
      type: 'message',
      role: 'assistant',
      id: 'msg-test',
      status: 'completed',
      content: [{ type: 'output_text', text: 'hello', annotations: [] }],
    },
  ],
  ...(counts !== undefined ? { usage: counts } : {}),
});
const getResponse = (model: OpenAIResponsesModel, request: ModelRequest) =>
  withTrace('test', () => model.getResponse(request));
const request = {
  input: 'hello',
  systemInstructions: 'test',
  modelSettings: { store: false, reasoning: { effort: 'low' }, maxTokens: 1800 },
  tools: [],
  handoffs: [],
  outputType: 'text',
  tracing: false,
} as ModelRequest;
function fake(response: unknown, failure?: Error) {
  const calls: unknown[] = [];
  const client = {
    responses: {
      create: async (...args: unknown[]) => {
        calls.push(args);
        if (failure) throw failure;
        return response;
      },
    },
  } as unknown as OpenAI;
  return { client, calls };
}
describe('real evaluator SDK raw observation', () => {
  for (const status of ['completed', 'incomplete', 'failed']) {
    for (const counts of [
      usage,
      null,
      {
        input_tokens: 0,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
      },
    ]) {
      it(`${status}: retains ${counts === null ? 'missing' : counts.input_tokens === 0 ? 'zero' : 'provider'} usage without changing requests or errors`, async () => {
        const response = raw(status, counts);
        const observed = fake(response);
        const baseline = fake(response);
        const ledger = evaluatorLedger('gpt-6.1-sol', 'simulator');
        const model = new ObservedResponsesModel(observed.client, 'gpt-6.1-sol', ledger);
        const plain = new OpenAIResponsesModel(baseline.client, 'gpt-6.1-sol');
        const [a, b] = await Promise.allSettled([
          getResponse(model, request),
          getResponse(plain, request),
        ]);
        expect(observed.calls).toEqual(baseline.calls);
        expect(a.status).toBe(b.status);
        if (a.status === 'rejected' && b.status === 'rejected') {
          expect(a.reason.constructor).toBe(b.reason.constructor);
          expect(a.reason.message).toBe(b.reason.message);
        }
        expect(ledger.toJSON().requests).toHaveLength(1);
        expect(ledger.toJSON().requests[0]).toMatchObject({
          status,
          returnedModel: 'gpt-6.1-sol',
          returnedServiceTier: 'default',
          usageSource: counts === null ? 'provider_missing' : 'provider',
          usageCompleteness: counts === null ? 'unknown' : 'final',
          tokens: {
            input: counts?.input_tokens ?? null,
            cacheRead: counts?.input_tokens_details.cached_tokens ?? null,
            output: counts?.output_tokens ?? null,
          },
        });
      });
    }
  }
  it('rethrows an identical transport error and records no response', async () => {
    const failure = new Error('secret provider details');
    const { client } = fake(undefined, failure);
    const ledger = evaluatorLedger('gpt-6.1-sol', 'reviewer');
    await expect(
      getResponse(new ObservedResponsesModel(client, 'gpt-6.1-sol', ledger), request),
    ).rejects.toBe(failure);
    expect(ledger.toJSON().requests[0]).toMatchObject({
      status: 'error_without_response',
      usageSource: 'none',
      tokens: { input: null },
    });
    expect(JSON.stringify(ledger)).not.toContain('secret');
  });
  it('passes the same abort signal to the client and preserves its error', async () => {
    const controller = new AbortController();
    const failure = new DOMException('cancelled', 'AbortError');
    const calls: unknown[] = [];
    const client = {
      responses: {
        create: async (_body: unknown, options: { signal: AbortSignal }) => {
          calls.push(options.signal);
          controller.abort();
          throw failure;
        },
      },
    } as unknown as OpenAI;
    const ledger = evaluatorLedger('gpt-6.1-sol', 'reviewer');
    await expect(
      getResponse(new ObservedResponsesModel(client, 'gpt-6.1-sol', ledger), {
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toBe(failure);
    expect(calls).toEqual([controller.signal]);
    expect(ledger.toJSON().requests[0]!.usageSource).toBe('none');
  });
  it('uses equivalent OpenAI client defaults to the previous provider construction', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key', useResponses: true });
    const model = await provider.getModel('gpt-6.1-sol');
    const client = (model as unknown as { _client: OpenAI })._client;
    const explicit = new OpenAI({ apiKey: 'test-key' });
    for (const key of ['baseURL', 'organization', 'project', 'maxRetries', 'timeout'] as const)
      expect(explicit[key]).toEqual(client[key]);
  });
  it('runs the real Runner with unchanged reviewer settings and retains rejected output usage', async () => {
    const review = {
      verdict: 'acceptable',
      summary: 'test',
      criteria: criteria.map((criterion) => ({
        criterion,
        result: 'pass',
        explanation: 'test',
        evidence: ['plan:missing'],
      })),
    };
    const response = raw();
    response.output[0]!.content[0]!.text = JSON.stringify(review);
    const { client, calls } = fake(response);
    const models = new EvaluationModels('test', 'gpt-6.1-sol', client);
    const ledger = evaluatorLedger(models.model, 'reviewer');
    let failure: unknown;
    try {
      await models.review(
        {
          plan: null,
          messages: [],
          performance: {
            timezone: 'UTC',
            today: '2026-10-20',
            current: [],
            entries: [],
            usedByPlans: [],
          },
        },
        [],
        new AbortController().signal,
        ledger,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ReviewValidationError);
    expect((failure as ReviewValidationError).usage).toEqual({
      inputTokens: 100,
      outputTokens: 10,
    });
    expect((calls[0] as unknown[])[0]).toMatchObject({
      model: 'gpt-6.1-sol',
      store: false,
      reasoning: { effort: 'medium' },
      max_output_tokens: 7000,
    });
    expect(ledger.toJSON().requests[0]!.tokens.reasoning).toBe(3);
    // Baseline goes through OpenAIProvider's string-model path, just as production did before.
    const baseline = fake(response);
    const runner = new Runner({
      modelProvider: new OpenAIProvider({ openAIClient: baseline.client, useResponses: true }),
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
    const observedAgent = new Agent({
      name: 'test',
      model: new ObservedResponsesModel(
        client,
        'gpt-6.1-sol',
        evaluatorLedger('gpt-6.1-sol', 'simulator'),
      ),
      modelSettings: request.modelSettings,
    });
    const baselineAgent = new Agent({
      name: 'test',
      model: 'gpt-6.1-sol',
      modelSettings: request.modelSettings,
    });
    await runner.run(observedAgent, 'hello', { maxTurns: 1 });
    await runner.run(baselineAgent, 'hello', { maxTurns: 1 });
    expect((calls.at(-1) as unknown[])[0]).toEqual((baseline.calls[0] as unknown[])[0]);
  });
});
