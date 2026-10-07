import { describe, expect, it } from 'vitest';
import { verificationConfig } from './verification-config.js';

const local = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://askesis:askesis@127.0.0.1:55999/askesis',
  CLERK_SECRET_KEY: 'sk_test_local',
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_local',
  LOCAL_WEB_URL: 'http://localhost:5999',
  CLERK_AUTHORIZED_PARTIES: 'http://127.0.0.1:5999, http://localhost:5999',
};

describe('local verification boundaries', () => {
  it('accepts a development instance and the authorized local browser origin', () => {
    expect(verificationConfig(local).webOrigin).toBe('http://localhost:5999');
  });

  it('accepts the sslmode option emitted by local setup', () => {
    expect(
      verificationConfig({ ...local, DATABASE_URL: `${local.DATABASE_URL}?sslmode=disable` })
        .webOrigin,
    ).toBe('http://localhost:5999');
  });

  it.each([
    'host=remote.example',
    'hostaddr=203.0.113.10',
    'user=another_user',
    'port=5433',
    'database=another_database',
    'db=another_database',
    'password=secret',
    '%68ost=remote.example',
    '%75ser=another_user',
    'sslmode=disable&host=localhost&host=remote.example',
  ])('refuses driver query overrides before opening a connection: %s', (query) => {
    expect(() =>
      verificationConfig({ ...local, DATABASE_URL: `${local.DATABASE_URL}?${query}` }),
    ).toThrow('DATABASE_URL supports only the sslmode query parameter.');
  });

  it.each([
    { NODE_ENV: 'production' },
    { RAILWAY_ENVIRONMENT_ID: 'deployment' },
    { RAILWAY_PROJECT_ID: 'project' },
    { CLERK_SECRET_KEY: 'sk_live_secret' },
    { VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_public' },
    { CLERK_SECRET_KEY: 'sk_test_replace_me' },
    { DATABASE_URL: 'postgres://askesis:secret@production.example/askesis' },
    { DATABASE_URL: 'postgres://askesis:secret@localhost/another_database' },
    { DATABASE_URL: 'postgres://another_user:secret@localhost/askesis' },
    { LOCAL_WEB_URL: 'http://localhost.example.com:5999' },
    { LOCAL_WEB_URL: 'http://localhost:5999/?redirect=https://example.com' },
    { LOCAL_WEB_URL: 'http://secret@localhost:5999' },
    { CLERK_AUTHORIZED_PARTIES: 'http://localhost:8080' },
  ])('refuses unsafe configuration without printing its values: %j', (override) => {
    expect(() => verificationConfig({ ...local, ...override })).toThrow();
    try {
      verificationConfig({ ...local, ...override });
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });
});
