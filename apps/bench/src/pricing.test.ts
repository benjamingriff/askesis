import { describe, expect, it } from 'vitest';
import { UsageLedger, type ModelRequestUsage } from '@askesis/agent/usage';
import { evaluatorLedger } from './models.js';
import { estimateRequestCost } from './pricing.js';
import { PRICE_TABLE } from './pricing-table.js';
function openai(input = 100, tier: string | null = 'default') {
  const l = evaluatorLedger('gpt-6.1-sol', 'reviewer');
  l.begin().fromOpenAIResponse({
    model: 'gpt-6.1-sol',
    service_tier: tier,
    status: 'completed',
    usage: {
      input_tokens: input,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 25 },
    },
  });
  return l.toJSON().requests[0]!;
}
function anthropic() {
  const l = new UsageLedger({
    provider: 'anthropic',
    requestedModel: 'claude-opus-5-5',
    settings: {
      reasoningEffort: 'high',
      maxOutputTokens: 5000,
      requestedServiceTier: null,
      cacheControl: 'anthropic_ephemeral_auto',
    },
  });
  l.begin().fromAnthropicMessage({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 30,
      cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
      output_tokens: 40,
      output_tokens_details: { thinking_tokens: 25 },
      service_tier: 'standard',
    },
  });
  return l.toJSON().requests[0]!;
}
describe('per-request applied pricing', () => {
  it('charges uncached input, read, write and inclusive output once', () => {
    const cost = estimateRequestCost(openai());
    expect(cost.usd).toBeCloseTo((70 * 2 + 20 * 0.1 + 10 * 2.5 + 40 * 10) / 1e6, 12);
    expect(cost).toMatchObject({
      entry: { id: 'openai/gpt-6.1-sol/default', source: PRICE_TABLE[0]!.source },
      lookup: { modelBasis: 'returned', tierBasis: 'returned', longContext: false },
      rates: PRICE_TABLE[0]!.rates,
      pricedTokens: { uncachedInput: 70, output: 40 },
    });
  });
  it('uses each request input for the strict long-context threshold', () => {
    expect(estimateRequestCost(openai(272000)).lookup.longContext).toBe(false);
    const long = estimateRequestCost(openai(272001));
    expect(long.lookup.longContext).toBe(true);
    expect(long.rates!.inputPerMTok).toBe(4);
    expect(long.usd).toBeCloseTo(((272001 - 30) * 4 + 20 * 0.2 + 10 * 5 + 40 * 15) / 1e6, 12);
  });
  for (const [tier, multiplier] of [
    ['default', 1],
    ['flex', 0.5],
    ['priority', 2],
    ['fast', 2],
  ] as const)
    it(`prices ${tier}`, () =>
      expect(estimateRequestCost(openai(100, tier)).usd).toBeCloseTo(
        estimateRequestCost(openai()).usd! * multiplier,
        12,
      ));
  it('keeps missing, auto and unsupported tiers unpriced', () => {
    expect(estimateRequestCost(openai(100, null)).unpricedReason).toBe('tier_unknown');
    for (const tier of ['auto', 'scale', 'ultrafast', 'batch'])
      expect(estimateRequestCost(openai(100, tier)).unpricedReason).toBe('tier_unpriced');
    const r = openai(100, null);
    r.settings.requestedServiceTier = 'flex';
    expect(estimateRequestCost(r).lookup).toMatchObject({ tier: 'flex', tierBasis: 'requested' });
  });
  it('uses exact aliases, never guesses variants or falls back from an unknown returned model', () => {
    const r = openai();
    const table = structuredClone(PRICE_TABLE);
    table[0]!.aliases.push('verified-alias');
    r.returnedModel = 'verified-alias';
    expect(estimateRequestCost(r, table).lookup.modelBasis).toBe('returned_alias');
    for (const model of [
      'gpt-6.1-sol-mini',
      'gpt-6.1-sol-latest',
      'gpt-6.1-sol-2026-09-01',
      'gpt-6.1-sol-2026-09-01-preview',
      'unknown',
    ]) {
      r.returnedModel = model;
      expect(estimateRequestCost(r).unpricedReason).toBe('model_unpriced');
    }
    r.returnedModel = null;
    expect(estimateRequestCost(r).lookup.modelBasis).toBe('requested');
  });
  it('prices Anthropic input excluding cache and charges split writes without adding thinking again', () => {
    const r = anthropic();
    expect(r.tokens.input).toBe(150);
    expect(estimateRequestCost(r).usd).toBeCloseTo(
      (100 * 4 + 20 * 0.2 + 10 * 5 + 20 * 8 + 40 * 20) / 1e6,
      12,
    );
    r.tokens.reasoning = 0;
    expect(estimateRequestCost(r).usd).toBe(estimateRequestCost(anthropic()).usd);
  });
  it('refuses unknown cache-write TTLs and unsupported modifiers', () => {
    const r = anthropic();
    r.tokens.cacheWrite5m = null;
    expect(estimateRequestCost(r).unpricedReason).toBe('cache_write_ttl_unknown');
    r.tokens.cacheWrite = 0;
    expect(estimateRequestCost(r).usd).not.toBeNull();
    r.speed = 'fast';
    expect(estimateRequestCost(r).unpricedReason).toBe('speed_unpriced');
    r.speed = null;
    r.inferenceGeo = 'us';
    expect(estimateRequestCost(r).unpricedReason).toBe('geo_unpriced');
  });
  it('preserves explicit zero and refuses partial/unknown or unverified usage', () => {
    const r = openai();
    for (const k of Object.keys(r.tokens) as (keyof ModelRequestUsage['tokens'])[]) r.tokens[k] = 0;
    expect(estimateRequestCost(r).usd).toBe(0);
    r.tokens.cacheWrite = null;
    expect(estimateRequestCost(r).unpricedReason).toBe('tokens_unknown');
    r.usageCompleteness = 'partial';
    expect(estimateRequestCost(r).unpricedReason).toBe('usage_partial');
    for (const source of ['none', 'sdk_normalized', 'provider_missing'] as const) {
      r.usageSource = source;
      expect(estimateRequestCost(r).unpricedReason).toBe('usage_unverified');
    }
    expect(estimateRequestCost(r, PRICE_TABLE, { scripted: true }).unpricedReason).toBe('scripted');
  });
});
