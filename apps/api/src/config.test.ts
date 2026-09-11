import { describe, expect, it } from 'vitest';
import { parseApiConfig } from './config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:password@localhost:5432/askesis_test',
  CLERK_SECRET_KEY: 'secret-value',
  CLERK_PUBLISHABLE_KEY: 'publishable-value',
};

describe('parseApiConfig', () => {
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

  it('reports invalid field names without exposing values', () => {
    expect(() =>
      parseApiConfig({ ...validEnvironment, DATABASE_URL: 'not-a-database-url' }),
    ).toThrow('Invalid API environment configuration: DATABASE_URL');
  });
});
