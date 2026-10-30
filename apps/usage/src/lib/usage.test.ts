import { describe, expect, it } from 'vitest';
import {
  cacheHitRate,
  EMPTY_USAGE_FILTERS,
  sliceUsage,
  summarize,
  syntheticUsage,
  TOKEN_CLASSES,
} from './usage';

describe('synthetic usage', () => {
  const dataset = syntheticUsage();

  it('prices every run with a final ledger as the sum of its token classes', () => {
    for (const run of dataset.runs) {
      if (run.usd === null) continue;
      const total = TOKEN_CLASSES.reduce((sum, key) => sum + run.cost[key], 0);
      expect(run.usd).toBeCloseTo(total, 9);
      const { uncachedInput, cacheRead, cacheWrite, input } = run.tokens;
      expect(uncachedInput + cacheRead + cacheWrite).toBe(input);
    }
  });

  it('leaves runs without a ledger unpriced and out of the cache hit rate', () => {
    const missing = dataset.runs.filter((run) => run.ledger === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((run) => run.usd === null && run.requests.length === 0)).toBe(true);
    expect(summarize(missing).unpriced).toBe(missing.length);
    expect(cacheHitRate(missing)).toBeNull();
  });

  it('slices the selected range and the period before it', () => {
    const slice = sliceUsage(dataset, { ...EMPTY_USAGE_FILTERS, range: 7 });
    expect(slice.days).toHaveLength(7);
    expect(slice.runs.every((run) => slice.days.includes(run.day))).toBe(true);
    expect(slice.previous?.every((run) => !slice.days.includes(run.day))).toBe(true);
  });

  it('applies model filters and an athlete scope', () => {
    const [athlete] = dataset.athletes;
    const model = dataset.runs[0]?.model ?? '';
    const slice = sliceUsage(
      dataset,
      { ...EMPTY_USAGE_FILTERS, range: 90, hiddenModels: [model] },
      athlete?.id,
    );
    expect(slice.runs.every((run) => run.athleteId === athlete?.id && run.model !== model)).toBe(
      true,
    );
  });
});
