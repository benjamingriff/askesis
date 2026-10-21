import { expect, it } from 'vitest';
import { PRICE_TABLE, PRICING_VERSION, SNAPSHOT_PATTERNS } from './pricing-table.js';

it('keeps rate entries identifiable and attributable to a dated official source', () => {
  expect(new Set(PRICE_TABLE.map((entry) => entry.id)).size).toBe(PRICE_TABLE.length);
  expect(PRICING_VERSION).toMatch(/^pricing-\d{4}-\d{2}-\d{2}$/);
  for (const entry of PRICE_TABLE) {
    expect(['developers.openai.com', 'platform.claude.com']).toContain(
      new URL(entry.source).hostname,
    );
    expect(entry.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const value of Object.values(entry.rates)) expect(value).toBeGreaterThanOrEqual(0);
    const pattern = SNAPSHOT_PATTERNS[entry.provider]?.(entry.model);
    if (pattern) {
      expect(pattern.source.startsWith('^')).toBe(true);
      expect(pattern.source.endsWith('$')).toBe(true);
    }
  }
});
