/** USD per million tokens; a frozen list-price snapshot, not billing data. */
export type PriceRates = {
  inputPerMTok: number;
  cacheReadPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok?: number;
  cacheWrite5mPerMTok?: number;
  cacheWrite1hPerMTok?: number;
};
export type PriceEntry = {
  id: string;
  provider: 'openai' | 'anthropic';
  model: string;
  aliases: string[];
  tier: 'default' | 'flex' | 'priority' | 'standard';
  rates: PriceRates;
  longContext?: { inputTokensAbove: number; rates: PriceRates };
  source: string;
  retrievedOn: string;
};

export const PRICING_VERSION = 'pricing-2026-10-20';
// The official gpt-6.1-sol model page lists only the undated name (checked 2026-10-20).
// Do not infer prices for unfamiliar variants or dated names from a shared prefix.
export const SNAPSHOT_PATTERNS: Partial<Record<'openai' | 'anthropic', (model: string) => RegExp>> =
  {};

const retrievedOn = '2026-10-20';
const openaiSource = 'https://developers.openai.com/api/docs/pricing';
const anthropicSource = 'https://platform.claude.com/docs/en/about-claude/pricing';

export const PRICE_TABLE: PriceEntry[] = [
  {
    id: 'openai/gpt-6.1-sol/default',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    aliases: [],
    tier: 'default',
    rates: { inputPerMTok: 2, cacheReadPerMTok: 0.1, cacheWritePerMTok: 2.5, outputPerMTok: 10 },
    longContext: {
      inputTokensAbove: 272000,
      rates: { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 15 },
    },
    source: openaiSource,
    retrievedOn,
  },
  {
    id: 'openai/gpt-6.1-sol/flex',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    aliases: [],
    tier: 'flex',
    rates: { inputPerMTok: 1, cacheReadPerMTok: 0.05, cacheWritePerMTok: 1.25, outputPerMTok: 5 },
    longContext: {
      inputTokensAbove: 272000,
      rates: { inputPerMTok: 2, cacheReadPerMTok: 0.1, cacheWritePerMTok: 2.5, outputPerMTok: 7.5 },
    },
    source: openaiSource,
    retrievedOn,
  },
  {
    id: 'openai/gpt-6.1-sol/priority',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    aliases: [],
    tier: 'priority',
    rates: { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 },
    longContext: {
      inputTokensAbove: 272000,
      rates: { inputPerMTok: 8, cacheReadPerMTok: 0.4, cacheWritePerMTok: 10, outputPerMTok: 30 },
    },
    source: openaiSource,
    retrievedOn,
  },
  ...[
    { model: 'claude-opus-5-5', input: 4, read: 0.2, write5m: 5, write1h: 8, output: 20 },
    { model: 'claude-sonnet-5-5', input: 2, read: 0.1, write5m: 2.5, write1h: 4, output: 10 },
    { model: 'claude-fable-5-1', input: 10, read: 0.25, write5m: 12.5, write1h: 20, output: 50 },
  ].map(({ model, input, read, write5m, write1h, output }): PriceEntry => ({
    id: `anthropic/${model}/standard`,
    provider: 'anthropic',
    model,
    aliases: [],
    tier: 'standard',
    rates: {
      inputPerMTok: input,
      cacheReadPerMTok: read,
      cacheWrite5mPerMTok: write5m,
      cacheWrite1hPerMTok: write1h,
      outputPerMTok: output,
    },
    source: anthropicSource,
    retrievedOn,
  })),
];
