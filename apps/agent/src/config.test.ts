import { expect, it } from 'vitest';
import { modelProfile, parseAgentConfig } from './config.js';

const token = 'test-bootstrap-token-32-characters';

it('keeps runtime config separate from database and human-auth credentials, and validates the exact model default', () => {
  const parsed = parseAgentConfig({
    OPENAI_API_KEY: 'test',
    AGENT_BOOTSTRAP_TOKEN: token,
    DATABASE_URL: 'private',
    CLERK_SECRET_KEY: 'private',
  });
  expect(parsed.AGENT_PROVIDER).toBe('openai');
  expect(parsed.AGENT_MODEL).toBe('gpt-6.1-sol');
  expect(parsed).not.toHaveProperty('DATABASE_URL');
  expect(parsed).not.toHaveProperty('CLERK_SECRET_KEY');
  expect(() =>
    parseAgentConfig({ OPENAI_API_KEY: 'secret-only', AGENT_BOOTSTRAP_TOKEN: 'short' }),
  ).toThrow('AGENT_BOOTSTRAP_TOKEN');
});

it('selects Claude through configuration with its own credential, model and output defaults', () => {
  const parsed = parseAgentConfig({
    AGENT_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: 'test',
    AGENT_BOOTSTRAP_TOKEN: token,
    AGENT_REASONING: 'high',
  });
  expect(modelProfile(parsed)).toEqual({
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    reasoning: 'high',
    maxOutputTokens: 32000,
  });
  expect(parsed).not.toHaveProperty('OPENAI_API_KEY');
  expect(
    parseAgentConfig({
      AGENT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test',
      AGENT_BOOTSTRAP_TOKEN: token,
      AGENT_MODEL: 'claude-sonnet-5-5',
      AGENT_MAX_OUTPUT_TOKENS: '64000',
    }),
  ).toMatchObject({ AGENT_MODEL: 'claude-sonnet-5-5', AGENT_MAX_OUTPUT_TOKENS: 64000 });
});

it.each([
  [{ AGENT_PROVIDER: 'anthropic', OPENAI_API_KEY: 'wrong-provider-key' }, 'ANTHROPIC_API_KEY'],
  [{ AGENT_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'wrong-provider-key' }, 'OPENAI_API_KEY'],
  [
    { AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AGENT_MODEL: 'gpt-6.1-sol' },
    'AGENT_MODEL',
  ],
  [
    { AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'k', AGENT_MAX_OUTPUT_TOKENS: '32000' },
    'AGENT_MAX_OUTPUT_TOKENS',
  ],
  [{ AGENT_PROVIDER: 'gemini', OPENAI_API_KEY: 'k' }, 'AGENT_PROVIDER'],
])('rejects mismatched provider settings %#', (settings, field) => {
  expect(() => parseAgentConfig({ ...settings, AGENT_BOOTSTRAP_TOKEN: token })).toThrow(field);
});

it('treats empty Compose placeholders as unset so each provider keeps its own default model', () => {
  expect(
    parseAgentConfig({
      AGENT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test',
      OPENAI_API_KEY: '',
      AGENT_MODEL: '',
      AGENT_BOOTSTRAP_TOKEN: token,
    }).AGENT_MODEL,
  ).toBe('claude-opus-5-5');
});
