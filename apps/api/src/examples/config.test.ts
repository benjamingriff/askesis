import { expect, it } from 'vitest';
import { configuredExampleEmail } from './config.js';

it('keeps every environment empty unless publication is explicitly enabled', () => {
  expect(configuredExampleEmail({ NODE_ENV: 'development' })).toBeNull();
  expect(
    configuredExampleEmail({ NODE_ENV: 'production', EXAMPLE_PLAN_EMAIL: 'someone@example.com' }),
  ).toBeNull();
  expect(
    configuredExampleEmail({
      NODE_ENV: 'production',
      RAILWAY_PROJECT_ID: 'production-project',
      RAILWAY_ENVIRONMENT_ID: 'production-environment',
      EXAMPLE_PLAN_EMAIL: 'owner@example.com',
    }),
  ).toBeNull();
});

it('requires an explicit owner when enabled, and supports disabling without an owner', () => {
  expect(
    configuredExampleEmail({
      EXAMPLE_PLAN_ENABLED: 'true',
      EXAMPLE_PLAN_EMAIL: ' Test@Example.com ',
    }),
  ).toBe('test@example.com');
  expect(configuredExampleEmail({ EXAMPLE_PLAN_ENABLED: 'false' })).toBeNull();
  expect(
    configuredExampleEmail({ EXAMPLE_PLAN_ENABLED: 'false', EXAMPLE_PLAN_EMAIL: 'invalid' }),
  ).toBeNull();
});

it('fails invalid enabled configuration without exposing its values', () => {
  expect(() => configuredExampleEmail({ EXAMPLE_PLAN_ENABLED: 'yes' })).toThrow(
    'must be true or false',
  );
  expect(() => configuredExampleEmail({ EXAMPLE_PLAN_ENABLED: 'true' })).toThrow(
    'valid example owner email',
  );
  expect(() =>
    configuredExampleEmail({ EXAMPLE_PLAN_ENABLED: 'true', EXAMPLE_PLAN_EMAIL: 'secret' }),
  ).toThrow('Provide a valid example owner email.');
});
