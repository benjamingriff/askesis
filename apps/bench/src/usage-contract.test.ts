import { expect, it } from 'vitest';
import { UsageLedgerSchema } from '@askesis/api/benchmark';
import { UsageLedger, readUsageLedger } from '@askesis/agent/usage';
import { evaluatorLedger } from './models.js';
it('parses provider, missing, failure and zero evaluator ledgers through the real exported API schema', () => {
  const ledger = evaluatorLedger('gpt-6.1-sol', 'reviewer');
  ledger.begin().fromOpenAIResponse({
    model: 'gpt-6.1-sol',
    status: 'completed',
    service_tier: 'default',
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2, hidden_text: 'SECRET' },
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: 2 },
      authorization: 'SECRET',
      thinking: 'SECRET',
    },
  });
  ledger.begin().fromOpenAIResponse({ status: 'failed' });
  ledger
    .begin()
    .fromOpenAIResponse({ status: 'completed', usage: { input_tokens: 0, output_tokens: 0 } });
  ledger.begin().noResponse();
  expect(UsageLedgerSchema.parse(ledger.toJSON())).toEqual(ledger.toJSON());
  expect(readUsageLedger(ledger.toJSON())).toEqual(ledger.toJSON());
  expect(JSON.stringify(ledger)).not.toContain('SECRET');
});
it('parses interrupted Anthropic partial usage, safe detail counts and request defaults', () => {
  const ledger = new UsageLedger({
    provider: 'anthropic',
    requestedModel: 'claude-opus-5-5',
    settings: {
      reasoningEffort: 'high',
      maxOutputTokens: 5000,
      requestedServiceTier: null,
      cacheControl: 'anthropic_ephemeral_auto',
    },
  });
  ledger.begin().interrupted({
    anthropicUsage: {
      input_tokens: 10,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
      output_tokens: 4,
      output_tokens_details: { thinking_tokens: 1 },
    },
  });
  expect(UsageLedgerSchema.parse(ledger.toJSON())).toEqual(ledger.toJSON());
  expect(ledger.toJSON().requests[0]!.usageCompleteness).toBe('partial');
});
