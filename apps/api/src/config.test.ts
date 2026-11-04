import { describe, expect, it } from 'vitest';
import { parseApiConfig } from './config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:password@localhost:5432/askesis_test',
  CLERK_SECRET_KEY: 'secret-value',
  CLERK_PUBLISHABLE_KEY: 'publishable-value',
};

describe('parseApiConfig', () => {
  it('defaults the coach to enabled independently of execution mode', () => {
    expect(parseApiConfig(validEnvironment).IN_APP_COACH).toBe('enabled');
    for (const mode of ['unavailable', 'test', 'agent']) {
      const config = parseApiConfig({
        ...validEnvironment,
        IN_APP_COACH: 'hidden',
        CHAT_EXECUTION_MODE: mode,
        AGENT_BOOTSTRAP_TOKEN: 'x'.repeat(32),
      });
      expect(config.IN_APP_COACH).toBe('hidden');
      expect(config.CHAT_EXECUTION_MODE).toBe(mode);
    }
    expect(() => parseApiConfig({ ...validEnvironment, IN_APP_COACH: 'invalid' })).toThrow(
      'IN_APP_COACH',
    );
  });
  it('keeps chat unavailable by default and rejects the test executor in production', () => {
    expect(parseApiConfig(validEnvironment).CHAT_EXECUTION_MODE).toBe('unavailable');
    expect(
      parseApiConfig({ ...validEnvironment, CHAT_EXECUTION_MODE: 'test' }).CHAT_EXECUTION_MODE,
    ).toBe('test');
    expect(() =>
      parseApiConfig({ ...validEnvironment, NODE_ENV: 'production', CHAT_EXECUTION_MODE: 'test' }),
    ).toThrow('forbidden in production');
  });
  it('parses authorized parties and defaults', () => {
    const config = parseApiConfig({
      ...validEnvironment,
      CLERK_AUTHORIZED_PARTIES: 'http://localhost:8080, http://localhost:5173',
    });

    expect(config.PORT).toBe(3000);
    expect(config.clerkAuthorizedParties).toEqual([
      'http://localhost:8080',
      'http://localhost:5173',
    ]);
  });

  it('leaves Strava unconfigured by default and requires HTTPS providers in production', () => {
    const config = parseApiConfig({ ...validEnvironment, STRAVA_CLIENT_ID: '' });
    expect(config.STRAVA_CLIENT_ID).toBeUndefined();
    expect(config.STRAVA_API_BASE_URL).toBe('https://www.strava.com/api/v3');
    expect(() =>
      parseApiConfig({ ...validEnvironment, INTEGRATION_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow('INTEGRATION_ENCRYPTION_KEY');
    expect(() =>
      parseApiConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        STRAVA_API_BASE_URL: 'http://localhost:4010/api/v3',
      }),
    ).toThrow('STRAVA_API_BASE_URL');
  });

  it('reports invalid field names without exposing values', () => {
    expect(() =>
      parseApiConfig({ ...validEnvironment, DATABASE_URL: 'not-a-database-url' }),
    ).toThrow('Invalid API environment configuration: DATABASE_URL');
  });
});
