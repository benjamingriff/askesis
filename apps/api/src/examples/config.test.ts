import { expect, it } from 'vitest';
import { configuredExampleEmail, hostedExampleTarget } from './config.js';

it('keeps local, unrelated hosted and new-install accounts empty unless explicitly enabled', () => {
  expect(configuredExampleEmail({ NODE_ENV: 'development' })).toBeNull();
  expect(
    configuredExampleEmail({ NODE_ENV: 'production', EXAMPLE_PLAN_EMAIL: 'someone@example.com' }),
  ).toBeNull();
  expect(
    configuredExampleEmail({
      NODE_ENV: 'production',
      RAILWAY_PROJECT_ID: 'another-project',
      RAILWAY_ENVIRONMENT_ID: hostedExampleTarget.environmentId,
    }),
  ).toBeNull();
});

it('selects the requested owner only for the exact existing hosted environment', () => {
  const environment = {
    NODE_ENV: 'production',
    RAILWAY_PROJECT_ID: hostedExampleTarget.projectId,
    RAILWAY_ENVIRONMENT_ID: hostedExampleTarget.environmentId,
  };
  expect(configuredExampleEmail(environment)).toBe('drjamin1990@gmail.com');
  expect(configuredExampleEmail({ ...environment, EXAMPLE_PLAN_ENABLED: 'false' })).toBeNull();
  expect(configuredExampleEmail({ ...environment, RAILWAY_ENVIRONMENT_ID: 'preview' })).toBeNull();
  expect(
    configuredExampleEmail({
      EXAMPLE_PLAN_ENABLED: 'true',
      EXAMPLE_PLAN_EMAIL: ' Test@Example.com ',
    }),
  ).toBe('test@example.com');
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
