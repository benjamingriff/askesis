import {
  readUsageLedger,
  type UsageRole,
  type ModelRequestUsage,
  type UsageLedgerJson,
} from '@askesis/agent/usage';
import {
  estimateRequestCost,
  sumCosts,
  pricingSnapshot,
  renderCost,
  type RequestCost,
  type CostTotal,
} from './pricing.js';

export type Phase = 'run' | 'regrade' | 'calibration';
export type LedgerCoverage = 'recorded' | 'not_started' | 'missing' | 'historical' | 'scripted';
export type LedgerRecord = {
  ledgerId: string;
  role: UsageRole;
  phase: Phase;
  coverage: LedgerCoverage;
  outcome: 'succeeded' | 'rejected_output' | 'failed' | 'cancelled' | 'timed_out' | 'unknown';
  recordedRequests: number;
  omittedRequests: number;
  legacy: { inputTokens: number | null; outputTokens: number | null } | null;
  legacyEntries?: number;
  coachRunId?: string;
  coachRunStatus?: string;
  interaction?: number;
  voiceAttempt?: number;
  fixtureId?: string;
  repetition?: number;
  regradedAt?: string;
};
export type AttributedRequest = ModelRequestUsage & {
  ledgerId: string;
  role: UsageRole;
  phase: Phase;
  cost: RequestCost;
};
export const tokenKeys = [
  'input',
  'uncachedInput',
  'cacheRead',
  'cacheWrite',
  'output',
  'reasoning',
] as const;
export type UsageSummary = {
  ledgers: {
    total: number;
    recorded: number;
    notStarted: number;
    scripted: number;
    missing: number;
    historical: number;
    truncated: number;
  };
  requests: { recorded: number; omitted: number; total: number | null };
  partialRequests: number;
  tokens: Record<
    (typeof tokenKeys)[number],
    { known: number; unknownRequests: number; complete: boolean }
  >;
  cacheHitRatio: {
    value: number | null;
    coveredRequests: number;
    recordedRequests: number;
    complete: boolean;
  };
  legacyTotals: { ledgers: number; inputTokens: number | null; outputTokens: number | null } | null;
  complete: boolean;
};
export function summarizeUsage(
  ledgers: LedgerRecord[],
  requests: AttributedRequest[],
): UsageSummary {
  const ids = new Set(ledgers.map((l) => l.ledgerId));
  const selected = requests.filter((r) => ids.has(r.ledgerId));
  const inventory = {
    total: ledgers.length,
    recorded: 0,
    notStarted: 0,
    scripted: 0,
    missing: 0,
    historical: 0,
    truncated: 0,
  };
  for (const l of ledgers) {
    if (l.coverage === 'not_started') inventory.notStarted++;
    else inventory[l.coverage]++;
    if (l.omittedRequests) inventory.truncated++;
  }
  const omitted = ledgers.reduce((s, l) => s + l.omittedRequests, 0);
  const partialRequests = selected.filter((r) => r.usageCompleteness === 'partial').length;
  const gaps = inventory.missing + inventory.historical + omitted;
  const tokens = Object.fromEntries(
    tokenKeys.map((key) => {
      const known = selected.filter((r) => r.usageSource === 'provider' && r.tokens[key] !== null);
      const unknownRequests = selected.length - known.length;
      return [
        key,
        {
          known: known.reduce((s, r) => s + r.tokens[key]!, 0),
          unknownRequests,
          complete:
            !unknownRequests &&
            !gaps &&
            !partialRequests &&
            selected.every((r) => r.usageCompleteness === 'final'),
        },
      ];
    }),
  ) as UsageSummary['tokens'];
  const covered = selected.filter(
    (r) => r.usageSource === 'provider' && r.tokens.input !== null && r.tokens.cacheRead !== null,
  );
  const input = covered.reduce((s, r) => s + r.tokens.input!, 0);
  const cacheHitRatio = {
    value: input > 0 ? covered.reduce((s, r) => s + r.tokens.cacheRead!, 0) / input : null,
    coveredRequests: covered.length,
    recordedRequests: selected.length,
    complete:
      covered.length === selected.length &&
      !gaps &&
      !partialRequests &&
      selected.every((r) => r.usageCompleteness === 'final'),
  };
  const legacy = ledgers.filter((l) => l.coverage === 'historical' || l.coverage === 'missing');
  const sumLegacy = (key: 'inputTokens' | 'outputTokens') => {
    const values = legacy.flatMap((l) =>
      l.legacy?.[key] === null || l.legacy?.[key] === undefined ? [] : [l.legacy[key]!],
    );
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return {
    ledgers: inventory,
    requests: {
      recorded: selected.length,
      omitted,
      total: inventory.missing + inventory.historical ? null : selected.length + omitted,
    },
    partialRequests,
    tokens,
    cacheHitRatio,
    legacyTotals: legacy.length
      ? {
          ledgers: legacy.length,
          inputTokens: sumLegacy('inputTokens'),
          outputTokens: sumLegacy('outputTokens'),
        }
      : null,
    complete: tokenKeys.every((k) => tokens[k].complete) && cacheHitRatio.complete,
  };
}
export function ledgerRecord(
  meta: Pick<LedgerRecord, 'ledgerId' | 'role' | 'phase'> & Partial<LedgerRecord>,
  ledger: UsageLedgerJson | null,
  scripted = false,
): LedgerRecord {
  return {
    coverage: scripted ? 'scripted' : ledger ? 'recorded' : 'missing',
    outcome: 'unknown',
    recordedRequests: scripted ? 0 : (ledger?.requests.length ?? 0),
    omittedRequests: scripted ? 0 : (ledger?.omittedRequests ?? 0),
    legacy: null,
    ...meta,
  };
}
export function attributeRequests(
  record: LedgerRecord,
  ledger: UsageLedgerJson | null,
): AttributedRequest[] {
  if (record.coverage !== 'recorded' || !ledger) return [];
  return ledger.requests.map((r) => ({
    ...r,
    ledgerId: record.ledgerId,
    role: record.role,
    phase: record.phase,
    cost: estimateRequestCost(r),
  }));
}
export function legacyPair(value: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return typeof v.inputTokens === 'number' &&
    Number.isFinite(v.inputTokens) &&
    v.inputTokens >= 0 &&
    typeof v.outputTokens === 'number' &&
    Number.isFinite(v.outputTokens) &&
    v.outputTokens >= 0
    ? { inputTokens: v.inputTokens, outputTokens: v.outputTokens }
    : null;
}
export function coachRecords(
  runs: {
    id: string;
    status?: string;
    started_at?: unknown;
    usage?: unknown;
    input_tokens: number | null;
    output_tokens: number | null;
  }[],
  scripted = false,
  historical = false,
  legacy: unknown[] = [],
) {
  const ledgers: LedgerRecord[] = [];
  const requests: AttributedRequest[] = [];
  for (const run of runs) {
    const ledger = readUsageLedger(run.usage);
    const old = legacy.find(
      (v) => !!v && typeof v === 'object' && 'runId' in v && v.runId === run.id,
    );
    const source =
      old && typeof old === 'object'
        ? (old as { inputTokens?: number | null; outputTokens?: number | null })
        : { inputTokens: run.input_tokens, outputTokens: run.output_tokens };
    const record = ledgerRecord(
      {
        ledgerId: `coach:${run.id}`,
        role: 'coach',
        phase: 'run',
        coachRunId: run.id,
        ...(run.status ? { coachRunStatus: run.status } : {}),
        coverage: scripted
          ? 'scripted'
          : run.started_at === null
            ? 'not_started'
            : ledger
              ? 'recorded'
              : historical
                ? 'historical'
                : 'missing',
        outcome:
          run.status === 'completed'
            ? 'succeeded'
            : run.status === 'cancelled'
              ? 'cancelled'
              : run.status === 'failed'
                ? 'failed'
                : 'unknown',
      },
      ledger,
      scripted,
    );
    if (record.coverage !== 'recorded') {
      record.recordedRequests = 0;
      record.omittedRequests = 0;
    }
    if (record.coverage === 'missing' || record.coverage === 'historical')
      record.legacy = {
        inputTokens: source.inputTokens ?? null,
        outputTokens: source.outputTokens ?? null,
      };
    ledgers.push(record);
    requests.push(...attributeRequests(record, ledger));
  }
  return { ledgers, requests };
}
export type RegradeUsage = {
  regradedAt: string;
  status: 'completed' | 'rejected_output' | 'failed' | 'historical';
  reviewerModel: string | null;
  pricing: ReturnType<typeof pricingSnapshot> | null;
  ledgers: LedgerRecord[];
  requests: AttributedRequest[];
  summary: UsageSummary;
  costEstimate: CostTotal;
  reviewFile?: string;
};
export function scopeSummaries(ledgers: LedgerRecord[], requests: AttributedRequest[]) {
  const select = (predicate: (l: LedgerRecord) => boolean) => ledgers.filter(predicate);
  const run = select((l) => l.phase === 'run');
  const coach = run.filter((l) => l.role === 'coach');
  const evaluator = run.filter((l) => l.role !== 'coach');
  const roles = ['coach', 'simulator', 'voice', 'reviewer'] as const;
  return {
    summary: {
      byRole: Object.fromEntries(
        roles.map((role) => [
          role,
          summarizeUsage(
            run.filter((l) => l.role === role),
            requests,
          ),
        ]),
      ) as Record<UsageRole, UsageSummary>,
      coach: summarizeUsage(coach, requests),
      evaluatorOverhead: summarizeUsage(evaluator, requests),
      combined: summarizeUsage(run, requests),
    },
    costEstimate: {
      label: 'estimate' as const,
      currency: 'USD' as const,
      byRole: Object.fromEntries(
        roles.map((role) => [
          role,
          sumCosts(
            run.filter((l) => l.role === role),
            requests,
          ),
        ]),
      ) as Record<UsageRole, CostTotal>,
      coach: sumCosts(coach, requests),
      evaluatorOverhead: sumCosts(evaluator, requests),
      combined: sumCosts(run, requests),
    },
  };
}
export function buildMetrics(
  ledgers: LedgerRecord[],
  requests: AttributedRequest[],
  regrades: RegradeUsage[] = [],
) {
  const allLedgers = [...ledgers, ...regrades.flatMap((r) => r.ledgers)];
  const allRequests = [...requests, ...regrades.flatMap((r) => r.requests)];
  return {
    usageSchemaVersion: 2 as const,
    historical: false,
    pricing: pricingSnapshot(),
    ledgers,
    requests,
    ...scopeSummaries(ledgers, requests),
    regrades,
    combinedIncludingRegrades: {
      summary: summarizeUsage(allLedgers, allRequests),
      costEstimate: sumCosts(allLedgers, allRequests),
    },
  };
}
export type UsageMetrics = ReturnType<typeof buildMetrics> & {
  historicalBasis?: 'absent' | 'unreadable' | 'legacy';
};
export function usageMarkdown(metrics: UsageMetrics) {
  const lines = [
    '## Usage and estimated cost',
    '',
    '| Scope | Requests | Input | Cache read | Cache write | Output | Reasoning | Cache reads / input | Cost (USD estimate) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const row = (name: string, s: UsageSummary, c: CostTotal) => {
    const ratio = s.cacheHitRatio;
    const count = (key: (typeof tokenKeys)[number]) =>
      `${s.tokens[key].known}${s.tokens[key].complete ? '' : ' known (incomplete)'}`;
    lines.push(
      `| ${name} | ${s.requests.total ?? 'unknown'} (${s.requests.recorded} recorded; ${s.partialRequests} partial) | ${count('input')} | ${count('cacheRead')} | ${count('cacheWrite')} | ${count('output')} | ${count('reasoning')} | ${ratio.value === null ? 'unknown' : `${(ratio.value * 100).toFixed(1)}%`}${ratio.complete ? '' : ' (incomplete)'} | ${renderCost(c)} |`,
    );
  };
  for (const role of ['coach', 'simulator', 'voice', 'reviewer'] as const)
    row(role, metrics.summary.byRole[role], metrics.costEstimate.byRole[role]);
  row(
    'Evaluator overhead',
    metrics.summary.evaluatorOverhead,
    metrics.costEstimate.evaluatorOverhead,
  );
  row('Combined original run', metrics.summary.combined, metrics.costEstimate.combined);
  for (const r of metrics.regrades) row(`Regrade ${r.regradedAt}`, r.summary, r.costEstimate);
  row(
    'Combined including regrades',
    metrics.combinedIncludingRegrades.summary,
    metrics.combinedIncludingRegrades.costEstimate,
  );
  const legacy = metrics.summary.combined.legacyTotals;
  if (legacy)
    lines.push(
      '',
      `Historical/missing-ledger legacy totals (separate from detailed tokens): ${legacy.inputTokens ?? 'unknown'} input; ${legacy.outputTokens ?? 'unknown'} output across ${legacy.ledgers} ledgers.`,
    );
  const reasons = [
    ...new Set(
      [...metrics.requests, ...metrics.regrades.flatMap((r) => r.requests)].flatMap((r) =>
        r.cost.unpricedReason ? [r.cost.unpricedReason] : [],
      ),
    ),
  ];
  if (reasons.length) lines.push('', `Unpriced reasons: ${reasons.join(', ')}.`);
  lines.push(
    '',
    'Cache hit ratio is cached-read input / total input over covered provider requests. Unknown values stay distinct from zero; partial usage and missing, historical or truncated ledgers make coverage incomplete. Costs use persisted list-price decisions, not invoices.',
    '',
  );
  return lines.join('\n');
}
