import type { ModelRequestUsage } from '@askesis/agent/usage';
import {
  PRICE_TABLE,
  PRICING_VERSION,
  SNAPSHOT_PATTERNS,
  type PriceEntry,
  type PriceRates,
} from './pricing-table.js';
import type { AttributedRequest, LedgerRecord } from './usage-report.js';

export type UnpricedReason =
  | 'scripted'
  | 'usage_unverified'
  | 'usage_partial'
  | 'model_unpriced'
  | 'tier_unknown'
  | 'tier_unpriced'
  | 'speed_unpriced'
  | 'geo_unpriced'
  | 'tokens_unknown'
  | 'cache_write_ttl_unknown';
export type RequestCost = {
  pricingVersion: string;
  usd: number | null;
  unpricedReason: UnpricedReason | null;
  lookup: {
    model: string | null;
    modelBasis: 'returned' | 'returned_alias' | 'returned_snapshot' | 'requested' | null;
    tier: string | null;
    tierBasis: 'returned' | 'requested' | null;
    longContext: boolean | null;
  };
  entry: { id: string; source: string; retrievedOn: string } | null;
  rates: PriceRates | null;
  pricedTokens: {
    uncachedInput: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite5m: number | null;
    cacheWrite1h: number | null;
    output: number;
  } | null;
};
export type CostTotal = {
  knownUsd: number;
  usd: number | null;
  pricedRequests: number;
  unpricedRequests: number;
  missingLedgers: number;
  omittedRequests: number;
  scripted: boolean;
  complete: boolean;
  pricingVersions: string[];
};
export function estimateRequestCost(
  r: ModelRequestUsage,
  table: PriceEntry[] = PRICE_TABLE,
  opts = { scripted: false },
): RequestCost {
  const cost: RequestCost = {
    pricingVersion: PRICING_VERSION,
    usd: null,
    unpricedReason: null,
    lookup: {
      model: r.returnedModel ?? r.requestedModel,
      modelBasis: null,
      tier: r.returnedServiceTier ?? r.settings.requestedServiceTier,
      tierBasis:
        r.returnedServiceTier !== null
          ? 'returned'
          : r.settings.requestedServiceTier !== null
            ? 'requested'
            : null,
      longContext: null,
    },
    entry: null,
    rates: null,
    pricedTokens: null,
  };
  const fail = (reason: UnpricedReason): RequestCost => ({ ...cost, unpricedReason: reason });
  if (opts.scripted) return fail('scripted');
  if (r.usageSource !== 'provider') return fail('usage_unverified');
  if (r.usageCompleteness === 'partial') return fail('usage_partial');
  if (r.usageCompleteness !== 'final') return fail('usage_unverified');
  const candidates = table.filter((e) => e.provider === r.provider);
  const name = r.returnedModel ?? r.requestedModel;
  let models = candidates.filter((e) => e.model === name);
  if (models.length) cost.lookup.modelBasis = r.returnedModel ? 'returned' : 'requested';
  else {
    models = candidates.filter((e) => e.aliases.includes(name));
    if (models.length) cost.lookup.modelBasis = r.returnedModel ? 'returned_alias' : 'requested';
    else if (r.returnedModel) {
      models = candidates.filter((e) => SNAPSHOT_PATTERNS[r.provider]?.(e.model).test(name));
      if (models.length) cost.lookup.modelBasis = 'returned_snapshot';
    }
  }
  if (!models.length) return fail('model_unpriced');
  const tier = cost.lookup.tier;
  if (tier === null) return fail('tier_unknown');
  const normalized = r.provider === 'openai' && tier === 'fast' ? 'priority' : tier;
  cost.lookup.tier = normalized;
  const entry = models.find((e) => e.tier === normalized);
  if (!entry) return fail('tier_unpriced');
  cost.entry = { id: entry.id, source: entry.source, retrievedOn: entry.retrievedOn };
  if (r.provider === 'anthropic' && r.speed === 'fast') return fail('speed_unpriced');
  if (r.provider === 'anthropic' && r.inferenceGeo !== null && r.inferenceGeo !== 'global')
    return fail('geo_unpriced');
  const t = r.tokens;
  if (
    t.uncachedInput === null ||
    t.cacheRead === null ||
    t.cacheWrite === null ||
    t.output === null ||
    (entry.longContext && t.input === null)
  )
    return fail('tokens_unknown');
  if (
    r.provider === 'anthropic' &&
    t.cacheWrite > 0 &&
    (t.cacheWrite5m === null ||
      t.cacheWrite1h === null ||
      t.cacheWrite5m + t.cacheWrite1h !== t.cacheWrite)
  )
    return fail('cache_write_ttl_unknown');
  cost.lookup.longContext = !!entry.longContext && t.input! > entry.longContext.inputTokensAbove;
  const rates = cost.lookup.longContext ? entry.longContext!.rates : entry.rates;
  cost.rates = { ...rates };
  cost.pricedTokens = {
    uncachedInput: t.uncachedInput,
    cacheRead: t.cacheRead,
    cacheWrite: t.cacheWrite,
    cacheWrite5m: t.cacheWrite5m,
    cacheWrite1h: t.cacheWrite1h,
    output: t.output,
  };
  const write =
    r.provider === 'openai'
      ? t.cacheWrite * (rates.cacheWritePerMTok ?? rates.inputPerMTok)
      : (t.cacheWrite5m ?? 0) * (rates.cacheWrite5mPerMTok ?? 0) +
        (t.cacheWrite1h ?? 0) * (rates.cacheWrite1hPerMTok ?? 0);
  cost.usd =
    (t.uncachedInput * rates.inputPerMTok +
      t.cacheRead * rates.cacheReadPerMTok +
      write +
      t.output * rates.outputPerMTok) /
    1e6;
  return cost;
}
/** Sums persisted decisions. Never invokes the estimator, including when table versions differ. */
export function sumCosts(ledgers: LedgerRecord[], requests: AttributedRequest[]): CostTotal {
  const ids = new Set(ledgers.map((l) => l.ledgerId));
  const selected = requests.filter((r) => ids.has(r.ledgerId));
  const priced = selected.filter((r) => r.cost.usd !== null);
  const knownUsd = priced.reduce((s, r) => s + r.cost.usd!, 0);
  const missingLedgers = ledgers.filter(
    (l) => l.coverage === 'missing' || l.coverage === 'historical',
  ).length;
  const omittedRequests = ledgers.reduce((s, l) => s + l.omittedRequests, 0);
  // Scripted ledgers add no expenditure; they must not hide measured regrades or coverage gaps.
  const scripted =
    (ledgers.some((l) => l.coverage === 'scripted') ||
      selected.some((r) => r.cost.unpricedReason === 'scripted')) &&
    ledgers.every((l) => l.coverage === 'scripted' || l.coverage === 'not_started') &&
    selected.every((r) => r.cost.unpricedReason === 'scripted');
  const complete =
    !scripted && selected.length === priced.length && !missingLedgers && !omittedRequests;
  return {
    knownUsd,
    usd: complete ? knownUsd : null,
    pricedRequests: priced.length,
    unpricedRequests: selected.length - priced.length,
    missingLedgers,
    omittedRequests,
    scripted,
    complete,
    pricingVersions: [...new Set(selected.map((r) => r.cost.pricingVersion))].sort(),
  };
}
export function renderCost(cost: CostTotal) {
  if (cost.scripted) return 'not applicable (scripted)';
  if (cost.complete) return `$${cost.knownUsd.toFixed(6)} (estimate)`;
  const coverage = `${cost.pricedRequests} of ${cost.pricedRequests + cost.unpricedRequests} recorded requests priced; ${cost.missingLedgers} ledgers without detailed usage; ${cost.omittedRequests} requests omitted`;
  return cost.pricedRequests
    ? `at least $${cost.knownUsd.toFixed(6)} (incomplete: ${coverage})`
    : `unknown (${coverage})`;
}
export const pricingSnapshot = () => ({
  version: PRICING_VERSION,
  sources: [
    ...new Map(
      PRICE_TABLE.map((e) => [e.source, { url: e.source, retrievedOn: e.retrievedOn }]),
    ).values(),
  ],
});
