import { z } from 'zod';
export const PROMPT_VERSION = 'multisport-coach-v1';
const schema = z.object({
  AGENT_API_URL: z.string().url().default('http://localhost:3000'),
  AGENT_BOOTSTRAP_TOKEN: z.string().min(32).max(200),
  AGENT_PROVIDER: z.literal('openai').default('openai'),
  AGENT_MODEL: z.string().min(1).max(200).default('gpt-6.1-sol'),
  AGENT_REASONING: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  OPENAI_API_KEY: z.string().min(1),
  AGENT_MAX_TURNS: z.coerce.number().int().min(1).max(40).default(40),
  AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16000).default(12000),
  AGENT_POLL_MS: z.coerce.number().int().min(100).max(30000).default(1000),
});
export type AgentConfig = z.infer<typeof schema>;
export function parseAgentConfig(environment: NodeJS.ProcessEnv): AgentConfig {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new Error(
      `Invalid agent environment configuration: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
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
