// Usage and estimated spend, shaped to what production will record: one
// `agent_runs` row per coach run (owner, plan, status, model, prompt version)
// carrying the per-request `usage` ledger from #94 (uncached input, cache
// reads/writes, output and reasoning tokens). Prices follow the bench pricing
// table (`pricing-2026-10-20`). Until an API exposes those rows, the dashboard
// renders a seeded synthetic population with the same shape.

export const TOKEN_CLASSES = ['uncachedInput', 'cacheRead', 'cacheWrite', 'output'] as const;
export type TokenClass = (typeof TOKEN_CLASSES)[number];

export const TOKEN_CLASS_LABEL: Record<TokenClass, string> = {
  uncachedInput: 'Uncached input',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  output: 'Output',
};

// Validated with the dataviz palette checker on #000 and #fff, in this order. Skips
// the first two model slots so token types never read as a coach model.
export const TOKEN_CLASS_COLOR: Record<TokenClass, string> = {
  uncachedInput: '#9085e9',
  cacheRead: '#199e70',
  cacheWrite: '#c98500',
  output: '#d55181',
};

export type RunKind = 'chat' | 'generation';
export type RunStatus = 'completed' | 'failed' | 'cancelled';
export type LedgerState = 'final' | 'partial' | 'missing';

export const KIND_LABEL: Record<RunKind, string> = {
  chat: 'Coach chat',
  generation: 'Plan generation',
};

export interface Tokens {
  input: number;
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export type ClassCost = Record<TokenClass, number>;

export interface UsageRequest {
  sequence: number;
  model: string;
  tier: string;
  tokens: Tokens;
  cost: ClassCost;
  usd: number;
  /** The same request with every cache read billed as uncached input. */
  uncachedUsd: number;
}

export interface UsageRun {
  id: string;
  athleteId: string;
  planName: string;
  createdAt: number;
  day: string;
  kind: RunKind;
  status: RunStatus;
  failureCode: string | null;
  provider: 'openai' | 'anthropic';
  model: string;
  reasoning: string;
  promptVersion: string;
  durationMs: number;
  ledger: LedgerState;
  requests: UsageRequest[];
  tokens: Tokens;
  cost: ClassCost;
  /** Null when the run has no final ledger, so its cost cannot be estimated. */
  usd: number | null;
  uncachedUsd: number | null;
}

export interface Athlete {
  id: string;
  name: string;
  joinedDay: string;
  timezone: string;
}

export interface Annotation {
  day: string;
  label: string;
}

export interface UsageDataset {
  athletes: Athlete[];
  runs: UsageRun[];
  days: string[];
  annotations: Annotation[];
  pricingVersion: string;
}

interface Rates {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export const PRICING_VERSION = 'pricing-2026-10-20';
const RATES: Record<string, Rates> = {
  'gpt-6.1-sol': { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
  'claude-sonnet-5-5': { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
  'claude-opus-5-5': { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 },
};

const DAY_MS = 86_400_000;

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function emptyTokens(): Tokens {
  return { input: 0, uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
}

export function emptyCost(): ClassCost {
  return { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

function price(model: string, tokens: Tokens): { cost: ClassCost; usd: number; uncached: number } {
  const rate = RATES[model] ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const cost: ClassCost = {
    uncachedInput: (tokens.uncachedInput * rate.input) / 1e6,
    cacheRead: (tokens.cacheRead * rate.cacheRead) / 1e6,
    cacheWrite: (tokens.cacheWrite * rate.cacheWrite) / 1e6,
    output: (tokens.output * rate.output) / 1e6,
  };
  const usd = cost.uncachedInput + cost.cacheRead + cost.cacheWrite + cost.output;
  const uncached = usd - cost.cacheRead + (tokens.cacheRead * rate.input) / 1e6;
  return { cost, usd, uncached };
}

// ---------- Aggregation ----------

export interface Summary {
  runs: number;
  requests: number;
  tokens: Tokens;
  cost: ClassCost;
  usd: number;
  uncachedUsd: number;
  unpriced: number;
  athletes: number;
}

export function summarize(runs: UsageRun[]): Summary {
  const tokens = emptyTokens();
  const cost = emptyCost();
  let usd = 0;
  let uncachedUsd = 0;
  let requests = 0;
  let unpriced = 0;
  const athletes = new Set<string>();
  for (const run of runs) {
    athletes.add(run.athleteId);
    requests += run.requests.length;
    for (const key of Object.keys(tokens) as (keyof Tokens)[]) tokens[key] += run.tokens[key];
    if (run.usd === null) {
      unpriced += 1;
      continue;
    }
    for (const key of TOKEN_CLASSES) cost[key] += run.cost[key];
    usd += run.usd;
    uncachedUsd += run.uncachedUsd ?? run.usd;
  }
  return {
    runs: runs.length,
    requests,
    tokens,
    cost,
    usd,
    uncachedUsd,
    unpriced,
    athletes: athletes.size,
  };
}

/** Cache reads as a share of input, counting only runs with a ledger. */
export function cacheHitRate(runs: UsageRun[]): number | null {
  let read = 0;
  let input = 0;
  for (const run of runs) {
    if (run.ledger === 'missing') continue;
    read += run.tokens.cacheRead;
    input += run.tokens.input;
  }
  return input === 0 ? null : read / input;
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

export function daysBetween(end: string, count: number): string[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => dayKey(last - (count - 1 - index) * DAY_MS));
}

export function formatUsd(value: number | null, precise = false): string {
  if (value === null) return '—';
  if (value === 0) return '$0';
  if (precise || Math.abs(value) < 1) {
    return `$${value.toFixed(value < 0.01 ? 4 : value < 1 ? 3 : 2)}`;
  }
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

export function formatAxisUsd(value: number): string {
  if (value === 0) return '$0';
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  if (value >= 1) return `$${Number(value.toFixed(2))}`;
  return `$${Number(value.toFixed(3))}`;
}

// ---------- Synthetic population ----------

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Amara',
  'Ben',
  'Chloe',
  'Dev',
  'Elif',
  'Finn',
  'Grace',
  'Hiro',
  'Isla',
  'Jonah',
  'Kemi',
  'Liam',
  'Maya',
  'Niall',
  'Orla',
  'Priya',
  'Quinn',
  'Rosa',
  'Sam',
  'Tariq',
  'Uma',
  'Viktor',
  'Wren',
  'Xavi',
  'Yara',
  'Zane',
  'Aoife',
  'Bruno',
  'Cara',
  'Dmitri',
  'Esme',
  'Felix',
  'Gwen',
  'Hamza',
  'Ines',
  'Jude',
  'Kai',
  'Lena',
  'Mateo',
  'Nora',
  'Owen',
  'Pia',
  'Rhys',
  'Saoirse',
  'Theo',
  'Vera',
];
const LAST = 'ABCDEFGHJKLMNOPRSTVWY';
const ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Berlin', 'America/New_York'];
const PLANS = [
  'Cardiff Half Marathon',
  'Spring 10k block',
  'Olympic triathlon',
  'Hyrox Manchester',
  'Base building',
  'London Marathon',
  'Sub-20 5k',
  'Strength & run',
];

let cached: UsageDataset | null = null;

/** Deterministic: the same population every load, anchored to today's date. */
export function syntheticUsage(): UsageDataset {
  if (cached) return cached;
  const random = mulberry32(0xa5c3);
  const gaussian = () => {
    const u = Math.max(1e-9, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;

  const WINDOW = 90;
  const today = Date.parse(`${dayKey(Date.now())}T00:00:00Z`);
  const days = daysBetween(dayKey(today), WINDOW);
  const dayAt = (offset: number) => dayKey(today - offset * DAY_MS);
  const PROMPT_V2 = 21; // days ago
  const SONNET_TRIAL = 12;
  const LEDGER_ROLLOUT = 70;

  const athletes: Athlete[] = [];
  const runs: UsageRun[] = [];
  let runCounter = 0;

  for (let index = 0; index < FIRST.length; index += 1) {
    const id = `ath_${(index * 7919 + 1031).toString(36).padStart(5, '0')}`;
    const established = random() < 0.4;
    const joinOffset = established ? WINDOW + Math.floor(random() * 60) : Math.floor(random() * 84);
    const churnOffset = random() < 0.15 ? Math.floor(random() * Math.min(joinOffset, 60)) : -1;
    const heavy = index % 15 === 3;
    const activity = Math.exp(gaussian() * 0.7) * (heavy ? 4.5 : 1) * 0.42;
    const trial = index % 5 === 1;
    const planName = pick(PLANS);
    athletes.push({
      id,
      name: `${FIRST[index]} ${LAST[(index * 5) % LAST.length]}.`,
      joinedDay: dayAt(joinOffset),
      timezone: pick(ZONES),
    });

    let history = established ? 18 + Math.floor(random() * 40) : 0;
    for (let offset = Math.min(joinOffset, WINDOW - 1); offset >= 0; offset -= 1) {
      if (churnOffset >= 0 && offset < churnOffset) break;
      const dayStart = today - offset * DAY_MS;
      const weekday = new Date(dayStart).getUTCDay();
      const weekend = weekday === 0 || weekday === 6 ? 1.35 : 1;
      const replan = offset === joinOffset || (joinOffset - offset) % 28 === 0;
      const chats = poisson(random, activity * weekend);
      const kinds: RunKind[] = [
        ...(replan ? (['generation'] as const) : []),
        ...Array.from({ length: chats }, () => 'chat' as const),
        ...(random() < activity * 0.04 ? (['generation'] as const) : []),
      ];
      for (const kind of kinds) {
        runCounter += 1;
        const createdAt = dayStart + Math.floor((6 + random() * 16) * 3_600_000);
        const v2 = offset < PROMPT_V2;
        const anthropic = trial && offset < SONNET_TRIAL;
        const model = anthropic ? 'claude-sonnet-5-5' : 'gpt-6.1-sol';
        const promptVersion = v2 ? 'coach-v2' : 'coach-v1';
        const prefix = v2 ? 8600 : 7800;
        const baseHit = anthropic ? 0.86 : v2 ? 0.79 : 0.41;
        const count =
          kind === 'generation'
            ? 9 + Math.floor(random() * 14)
            : 1 + Math.floor(random() * 3 + random() * 3);
        const contextBase = Math.min(70_000, 1400 + history * 420);
        const roll = random();
        const status: RunStatus = roll < 0.035 ? 'failed' : roll < 0.05 ? 'cancelled' : 'completed';
        const failureCode =
          status === 'failed' ? pick(['provider_error', 'deadline_exceeded', 'lease_lost']) : null;
        const performed = status === 'completed' ? count : Math.max(1, Math.floor(count / 2));
        const requests: UsageRequest[] = [];
        for (let sequence = 1; sequence <= performed; sequence += 1) {
          const input = Math.round(
            (prefix + contextBase + (sequence - 1) * (kind === 'generation' ? 3400 : 1500)) *
              (0.9 + random() * 0.2),
          );
          const hit =
            sequence === 1
              ? baseHit * (0.35 + random() * 0.4)
              : Math.min(0.96, baseHit + 0.08 + gaussian() * 0.04);
          const cacheRead = Math.round(input * Math.max(0, hit));
          const cacheWrite = anthropic ? Math.round((input - cacheRead) * 0.85) : 0;
          const uncachedInput = input - cacheRead - cacheWrite;
          const output = Math.round(
            (kind === 'generation' ? 900 + random() * 2600 : 220 + random() * 900) *
              (sequence === performed ? 1.4 : 1),
          );
          const tokens: Tokens = {
            input,
            uncachedInput,
            cacheRead,
            cacheWrite,
            output,
            reasoning: Math.round(output * (0.3 + random() * 0.25)),
          };
          const priced = price(model, tokens);
          requests.push({
            sequence,
            model,
            tier: anthropic ? 'standard' : 'default',
            tokens,
            cost: priced.cost,
            usd: priced.usd,
            uncachedUsd: priced.uncached,
          });
        }
        history += kind === 'chat' ? 2 : 1;
        const ledgerRoll = random();
        const ledger: LedgerState =
          offset > LEDGER_ROLLOUT || ledgerRoll < 0.012
            ? 'missing'
            : ledgerRoll < 0.02
              ? 'partial'
              : 'final';
        const tokens = emptyTokens();
        const cost = emptyCost();
        let usd = 0;
        let uncachedUsd = 0;
        for (const request of requests) {
          for (const key of Object.keys(tokens) as (keyof Tokens)[]) {
            tokens[key] += request.tokens[key];
          }
          for (const key of TOKEN_CLASSES) cost[key] += request.cost[key];
          usd += request.usd;
          uncachedUsd += request.uncachedUsd;
        }
        if (ledger === 'missing') {
          // Old workers only filled `input_tokens`/`output_tokens`.
          const totals = emptyTokens();
          totals.input = tokens.input;
          totals.output = tokens.output;
          runs.push(
            run(
              id,
              planName,
              createdAt,
              kind,
              status,
              failureCode,
              model,
              promptVersion,
              ledger,
              [],
              totals,
              emptyCost(),
              null,
              null,
              performed,
            ),
          );
          continue;
        }
        runs.push(
          run(
            id,
            planName,
            createdAt,
            kind,
            status,
            failureCode,
            model,
            promptVersion,
            ledger,
            requests,
            tokens,
            cost,
            ledger === 'final' ? usd : null,
            ledger === 'final' ? uncachedUsd : null,
            performed,
          ),
        );
      }
    }
  }

  function run(
    athleteId: string,
    planName: string,
    createdAt: number,
    kind: RunKind,
    status: RunStatus,
    failureCode: string | null,
    model: string,
    promptVersion: string,
    ledger: LedgerState,
    requests: UsageRequest[],
    tokens: Tokens,
    cost: ClassCost,
    usd: number | null,
    uncachedUsd: number | null,
    performed: number,
  ): UsageRun {
    return {
      id: `run_${runCounter.toString(36).padStart(6, '0')}`,
      athleteId,
      planName,
      createdAt,
      day: dayKey(createdAt),
      kind,
      status,
      failureCode,
      provider: model.startsWith('claude') ? 'anthropic' : 'openai',
      model,
      reasoning: model.startsWith('claude') ? 'high' : 'medium',
      promptVersion,
      durationMs: Math.round(performed * (2600 + random() * 4200)),
      ledger,
      requests,
      tokens,
      cost,
      usd,
      uncachedUsd,
    };
  }

  runs.sort((a, b) => a.createdAt - b.createdAt);
  cached = {
    athletes,
    runs,
    days,
    annotations: [
      { day: dayAt(LEDGER_ROLLOUT), label: 'Usage ledger rollout' },
      { day: dayAt(PROMPT_V2), label: 'coach-v2' },
      { day: dayAt(SONNET_TRIAL), label: 'Sonnet trial (20%)' },
    ],
    pricingVersion: PRICING_VERSION,
  };
  return cached;
}

function poisson(random: () => number, mean: number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= random();
  } while (p > limit && k < 30);
  return k - 1;
}

// ---------- Filters ----------

export type UsageRange = 7 | 30 | 90;

export interface UsageFilters {
  range: UsageRange;
  hiddenModels: string[];
  hiddenKinds: RunKind[];
  hiddenStatuses: RunStatus[];
  search: string;
}

export const EMPTY_USAGE_FILTERS: UsageFilters = {
  range: 30,
  hiddenModels: [],
  hiddenKinds: [],
  hiddenStatuses: [],
  search: '',
};

export function isUsageFiltered(filters: UsageFilters): boolean {
  return (
    filters.hiddenModels.length + filters.hiddenKinds.length + filters.hiddenStatuses.length > 0 ||
    filters.search.trim() !== ''
  );
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export interface UsageSlice {
  days: string[];
  runs: UsageRun[];
  /** The preceding period of the same length, or null when the data does not reach it. */
  previous: UsageRun[] | null;
}

export function sliceUsage(
  dataset: UsageDataset,
  filters: UsageFilters,
  athleteId: string | null = null,
): UsageSlice {
  const days = dataset.days.slice(-filters.range);
  const previousDays =
    dataset.days.length >= filters.range * 2
      ? new Set(dataset.days.slice(-filters.range * 2, -filters.range))
      : null;
  const current = new Set(days);
  const query = filters.search.trim().toLowerCase();
  const names = new Map(dataset.athletes.map((athlete) => [athlete.id, athlete.name]));
  const keep = (run: UsageRun) =>
    (athleteId === null || run.athleteId === athleteId) &&
    !filters.hiddenModels.includes(run.model) &&
    !filters.hiddenKinds.includes(run.kind) &&
    !filters.hiddenStatuses.includes(run.status) &&
    (athleteId !== null ||
      query === '' ||
      (names.get(run.athleteId) ?? '').toLowerCase().includes(query) ||
      run.planName.toLowerCase().includes(query));
  const runs: UsageRun[] = [];
  const previous: UsageRun[] = [];
  for (const run of dataset.runs) {
    if (!keep(run)) continue;
    if (current.has(run.day)) runs.push(run);
    else if (previousDays?.has(run.day)) previous.push(run);
  }
  return { days, runs, previous: previousDays ? previous : null };
}
