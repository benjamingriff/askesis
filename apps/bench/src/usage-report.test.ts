import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluatorLedger } from './models.js';
import { Artifacts } from './artifacts.js';
import { sumCosts, renderCost } from './pricing.js';
import { PRICE_TABLE } from './pricing-table.js';
import {
  attributeRequests,
  buildMetrics,
  coachRecords,
  ledgerRecord,
  summarizeUsage,
  usageMarkdown,
} from './usage-report.js';
function measured(tier = 'default', model = 'gpt-6.1-sol', input = 100) {
  const ledger = evaluatorLedger('gpt-6.1-sol', 'reviewer');
  ledger.begin().fromOpenAIResponse({
    model,
    service_tier: tier,
    status: 'completed',
    usage: {
      input_tokens: input,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 25 },
    },
  });
  const saved = ledger.toJSON();
  const record = ledgerRecord(
    { ledgerId: `run:${tier}:${model}:${input}`, role: 'coach', phase: 'run' },
    saved,
  );
  return { record, requests: attributeRequests(record, saved) };
}
describe('inventory driven summaries', () => {
  it('keeps a missing coach ledger unknown, with separate legacy totals', () => {
    const { record, requests } = measured();
    const missing = ledgerRecord(
      {
        ledgerId: 'coach:missing',
        role: 'coach',
        phase: 'run',
        coverage: 'missing',
        legacy: { inputTokens: 1000, outputTokens: 200 },
      },
      null,
    );
    const summary = summarizeUsage([record, missing], requests);
    expect(summary).toMatchObject({
      complete: false,
      requests: { recorded: 1, total: null },
      legacyTotals: { ledgers: 1, inputTokens: 1000, outputTokens: 200 },
      tokens: { input: { known: 100, complete: false } },
      cacheHitRatio: { value: 0.2, complete: false },
    });
    expect(sumCosts([record, missing], requests)).toMatchObject({
      usd: null,
      knownUsd: requests[0]!.cost.usd,
      complete: false,
      missingLedgers: 1,
    });
    expect(renderCost(sumCosts([record, missing], requests))).toContain('at least');
  });
  it('does not invent counts when every started coach ledger is missing', () => {
    const coach = coachRecords([
      { id: 'run1', started_at: 'yesterday', usage: null, input_tokens: null, output_tokens: null },
    ]);
    expect(summarizeUsage(coach.ledgers, coach.requests)).toMatchObject({
      requests: { total: null, recorded: 0 },
      legacyTotals: { inputTokens: null },
      complete: false,
    });
    expect(sumCosts(coach.ledgers, coach.requests).usd).toBeNull();
  });
  it('treats explicit not-started and v2 empty inventory as complete zero', () => {
    const coach = coachRecords([
      { id: 'run1', started_at: null, usage: null, input_tokens: null, output_tokens: null },
    ]);
    expect(summarizeUsage(coach.ledgers, []).complete).toBe(true);
    expect(sumCosts(coach.ledgers, []).usd).toBe(0);
    expect(buildMetrics([], []).summary.byRole.voice.requests.total).toBe(0);
  });
  it('counts omitted requests while marking truncated totals incomplete', () => {
    const { record, requests } = measured();
    record.omittedRequests = 3;
    expect(summarizeUsage([record], requests)).toMatchObject({
      complete: false,
      requests: { recorded: 1, omitted: 3, total: 4 },
      ledgers: { truncated: 1 },
    });
    expect(sumCosts([record], requests)).toMatchObject({ usd: null, omittedRequests: 3 });
  });
  it('shows partial provider counts while withholding complete coverage and pricing', () => {
    const ledger = evaluatorLedger('gpt-6.1-sol', 'reviewer');
    ledger.begin().interrupted({
      anthropicUsage: {
        input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
        output_tokens: 5,
      },
    });
    const record = ledgerRecord(
      { ledgerId: 'partial', role: 'coach', phase: 'run' },
      ledger.toJSON(),
    );
    const requests = attributeRequests(record, ledger.toJSON());
    expect(summarizeUsage([record], requests)).toMatchObject({
      partialRequests: 1,
      complete: false,
      tokens: { input: { known: 130, complete: false }, output: { known: 5 } },
      cacheHitRatio: { value: 20 / 130, complete: false },
    });
    expect(requests[0]!.cost.unpricedReason).toBe('usage_partial');
  });
  it('uses cached-read input / total input across covered requests only, not writes', () => {
    const a = measured();
    const b = measured('flex', 'gpt-6.1-sol', 300);
    const all = [...a.requests, ...b.requests];
    expect(summarizeUsage([a.record, b.record], all).cacheHitRatio.value).toBe(40 / 400);
    b.requests[0]!.usageSource = 'sdk_normalized';
    const summary = summarizeUsage([a.record, b.record], all);
    expect(summary.cacheHitRatio).toMatchObject({
      value: 0.2,
      coveredRequests: 1,
      complete: false,
    });
    expect(summary.tokens.input).toMatchObject({ known: 100, unknownRequests: 1 });
  });
  it('exports scripted coach entries as zero actual provider requests and no cost estimate', () => {
    const raw = evaluatorLedger('scripted', 'reviewer');
    raw.begin().fromSdkUsage({ inputTokens: 0, outputTokens: 0 });
    const coach = coachRecords(
      [{ id: 'run', started_at: 'now', usage: raw.toJSON(), input_tokens: 0, output_tokens: 0 }],
      true,
    );
    expect(coach.ledgers[0]).toMatchObject({ coverage: 'scripted', recordedRequests: 0 });
    expect(coach.requests).toEqual([]);
    expect(summarizeUsage(coach.ledgers, []).complete).toBe(true);
    expect(renderCost(sumCosts(coach.ledgers, []))).toBe('not applicable (scripted)');
  });
  it('round trips real artifact costs and never consults changed prices when summing/rendering', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'bench-usage-'));
    try {
      const items = [
        measured(),
        measured('flex', 'gpt-6.1-sol', 272001),
        measured('default', 'unpriced'),
      ];
      const metrics = buildMetrics(
        items.map((i) => i.record),
        items.flatMap((i) => i.requests),
      );
      await new Artifacts(directory).json('metrics.json', metrics);
      const stored = JSON.parse(
        await readFile(resolve(directory, 'metrics.json'), 'utf8'),
      ) as typeof metrics;
      expect(stored.requests.map((r) => r.cost)).toEqual(metrics.requests.map((r) => r.cost));
      const previous = PRICE_TABLE[0]!.rates.inputPerMTok;
      try {
        PRICE_TABLE[0]!.rates.inputPerMTok = 9000;
        expect(sumCosts(stored.ledgers, stored.requests)).toEqual(stored.costEstimate.combined);
        expect(usageMarkdown(stored)).toContain('at least');
        expect(stored.requests[0]!.cost.rates!.inputPerMTok).toBe(2);
      } finally {
        PRICE_TABLE[0]!.rates.inputPerMTok = previous;
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it('lists all persisted pricing versions without changing their decisions', () => {
  const a = measured();
  const b = measured('flex');
  a.requests[0]!.cost.pricingVersion = 'historical-price-version';
  expect(sumCosts([a.record, b.record], [...a.requests, ...b.requests]).pricingVersions).toEqual(
    ['historical-price-version', b.requests[0]!.cost.pricingVersion].sort(),
  );
});
