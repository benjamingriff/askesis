import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as string[], seed: vi.fn() }));
vi.mock('../instrument.js', () => ({}));
vi.mock('../database/client.js', () => ({
  closeDatabase: vi.fn(async () => {
    state.calls.push('close');
  }),
}));
vi.mock('../examples/command.js', () => ({ seedExampleAccount: state.seed }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  state.seed.mockReset();
  state.calls.length = 0;
  process.exitCode = 0;
});

it('publishes before the enabled production listener starts', async () => {
  vi.resetModules();
  vi.doMock('../server.js', () => {
    state.calls.push('serve');
    return {};
  });
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EXAMPLE_PLAN_ENABLED', 'true');
  vi.stubEnv('EXAMPLE_PLAN_EMAIL', 'owner@example.com');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  state.seed.mockImplementation(async (email) => {
    state.calls.push(`seed:${email}`);
    return { status: 'created' };
  });
  await import('./start.js');
  expect(state.calls).toEqual(['seed:owner@example.com', 'serve']);
});

it('leaves an ordinary startup empty when publication is disabled', async () => {
  vi.resetModules();
  vi.doMock('../server.js', () => {
    state.calls.push('serve');
    return {};
  });
  vi.stubEnv('EXAMPLE_PLAN_ENABLED', 'false');
  await import('./start.js');
  expect(state.seed).not.toHaveBeenCalled();
  expect(state.calls).toEqual(['serve']);
});

it('fails before serving and redacts Clerk/SQL failure details', async () => {
  vi.resetModules();
  vi.doMock('../server.js', () => {
    state.calls.push('serve');
    return {};
  });
  vi.stubEnv('EXAMPLE_PLAN_ENABLED', 'true');
  vi.stubEnv('EXAMPLE_PLAN_EMAIL', 'owner@example.com');
  state.seed.mockRejectedValue(new Error('secret SQL or Clerk payload'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('./start.js');
  expect(state.calls).toEqual(['close']);
  expect(process.exitCode).toBe(1);
  expect(log.mock.calls.flat().join(' ')).not.toContain('secret');
});
