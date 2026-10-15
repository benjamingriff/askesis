import { z } from 'zod';
export const PROMPT_VERSION = 'training-feedback-coach-v1';
export const PROVIDERS = ['openai', 'anthropic'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Reasoning = (typeof REASONING_LEVELS)[number];
/**
 * Claude models verified with the runtime's request shape: adaptive thinking, effort levels and
 * progress updates between tool calls. Other Claude models reject parts of that shape.
 */
export const ANTHROPIC_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5-1',
] as const;
export const DEFAULT_MODELS = { openai: 'gpt-6.1-sol', anthropic: 'claude-opus-5-5' } as const;

/**
 * What one coaching run executes with. The worker builds it from its environment today; a run
 * could carry a user-selected profile later without changing the runtimes.
 */
export type ModelProfile = {
  provider: Provider;
  model: string;
  reasoning: Reasoning;
  maxOutputTokens: number;
};

const shared = {
  AGENT_API_URL: z.string().url().default('http://localhost:3000'),
  AGENT_BOOTSTRAP_TOKEN: z.string().min(32).max(200),
  AGENT_REASONING: z.enum(REASONING_LEVELS).default('medium'),
  AGENT_MAX_TURNS: z.coerce.number().int().min(1).max(40).default(40),
  AGENT_POLL_MS: z.coerce.number().int().min(100).max(30000).default(1000),
};
const schema = z.discriminatedUnion('AGENT_PROVIDER', [
  z.object({
    ...shared,
    AGENT_PROVIDER: z.literal('openai'),
    AGENT_MODEL: z.string().min(1).max(200).default(DEFAULT_MODELS.openai),
    OPENAI_API_KEY: z.string().min(1),
    AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16000).default(12000),
  }),
  z.object({
    ...shared,
    AGENT_PROVIDER: z.literal('anthropic'),
    AGENT_MODEL: z.enum(ANTHROPIC_MODELS).default(DEFAULT_MODELS.anthropic),
    ANTHROPIC_API_KEY: z.string().min(1),
    // Claude's thinking counts toward this per-response limit, so it needs more headroom.
    AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(128000).default(32000),
  }),
]);
export type AgentConfig = z.infer<typeof schema>;
export function parseAgentConfig(environment: NodeJS.ProcessEnv): AgentConfig {
  // Compose passes unset optional settings as empty strings; treat them as unset.
  const defined = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse({ AGENT_PROVIDER: 'openai', ...defined });
  if (!result.success)
    throw new Error(
      `Invalid agent environment configuration: ${result.error.issues.map((i) => i.path.join('.') || 'AGENT_PROVIDER').join(', ')}`,
    );
  const url = new URL(result.data.AGENT_API_URL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol)
  )
    throw new Error('Invalid agent environment configuration: AGENT_API_URL');
  return result.data;
}
export function modelProfile(config: AgentConfig): ModelProfile {
  return {
    provider: config.AGENT_PROVIDER,
    model: config.AGENT_MODEL,
    reasoning: config.AGENT_REASONING,
    maxOutputTokens: config.AGENT_MAX_OUTPUT_TOKENS,
  };
}
