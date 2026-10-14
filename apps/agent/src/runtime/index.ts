import type Anthropic from '@anthropic-ai/sdk';
import type { Model } from '@openai/agents';
import { modelProfile, type AgentConfig } from '../config.js';
import { AnthropicRuntime } from './anthropic.js';
import type { CoachingRuntime } from './core.js';
import { OpenAIRuntime } from './openai.js';

export {
  failureCode,
  ModelRefusalError,
  TurnLimitError,
  type CoachingRuntime,
  type RuntimeResult,
} from './core.js';
export { AnthropicRuntime } from './anthropic.js';
export { OpenAIRuntime } from './openai.js';

/** Test seams: a scripted model or client replaces the provider; credentials stay unused. */
export type RuntimeOverrides = { openai?: Model; anthropic?: Anthropic };

/** Selects the provider adapter from configuration; switching providers needs no code change. */
export function createRuntime(
  config: AgentConfig,
  overrides: RuntimeOverrides = {},
): CoachingRuntime {
  const limits = { maxTurns: config.AGENT_MAX_TURNS };
  switch (config.AGENT_PROVIDER) {
    case 'openai':
      return new OpenAIRuntime(
        modelProfile(config),
        limits,
        config.OPENAI_API_KEY,
        overrides.openai,
      );
    case 'anthropic':
      return new AnthropicRuntime(
        modelProfile(config),
        limits,
        config.ANTHROPIC_API_KEY,
        overrides.anthropic,
      );
  }
}
