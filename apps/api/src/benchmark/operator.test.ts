import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetApiConfigForTests } from '../config.js';
import { assertBenchmarkDatabase } from './operator.js';

const database =
  'postgres://askesis_bench:askesis_bench@127.0.0.1:57500/askesis_bench?sslmode=disable';
afterEach(() => {
  vi.unstubAllEnvs();
  resetApiConfigForTests();
});
function configure(url = database) {
  vi.stubEnv('BENCH_LOCAL_ENABLED', '1');
  vi.stubEnv('BENCH_DATABASE_PORT', '57500');
  vi.stubEnv('DATABASE_URL', url);
  resetApiConfigForTests();
}
describe('benchmark database boundary', () => {
  it('allows only the explicitly enabled generated local benchmark connection', () => {
    configure();
    expect(() => assertBenchmarkDatabase()).not.toThrow();
    vi.stubEnv('BENCH_LOCAL_ENABLED', '');
    expect(() => assertBenchmarkDatabase()).toThrow('dedicated local');
  });
  it.each([
    'postgres://production:password@database.example.com/production',
    'postgres://askesis:askesis@127.0.0.1:57500/askesis',
    database.replace('127.0.0.1', 'localhost'),
    database.replace('57500', '57501'),
  ])('rejects another connection before a fixture can access SQL: %s', (url) => {
    configure(url);
    expect(() => assertBenchmarkDatabase()).toThrow('dedicated local');
  });
  it('refuses production execution even with a matching local connection', () => {
    configure();
    vi.stubEnv('NODE_ENV', 'production');
    resetApiConfigForTests();
    expect(() => assertBenchmarkDatabase()).toThrow('dedicated local');
  });
});
