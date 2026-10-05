import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../auth/types.js';

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn() }));
vi.mock('../logger.js', () => ({ logger }));

const { requestContext } = await import('./middleware.js');

function createApp() {
  const app = new Hono<AppEnvironment>();
  app.use('*', requestContext);
  app.get('/api/ready', (c) => c.json({ ok: true }));
  app.post('/internal/agent/claim', (c) =>
    c.req.header('authorization') ? c.json({ claim: null }) : c.json({ code: 'UNAUTHORIZED' }, 401),
  );
  app.post('/internal/agent/runs/:runId/heartbeat', (c) => c.json({ status: 'running' }));
  return app;
}

describe('request logging', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs readiness probes and successful worker polls at debug level', async () => {
    const app = createApp();
    await app.request('/api/ready');
    await app.request('/internal/agent/claim', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('keeps failed worker polls and run activity at info level', async () => {
    const app = createApp();
    await app.request('/internal/agent/claim', { method: 'POST' });
    await app.request('/internal/agent/runs/run-1/heartbeat', { method: 'POST' });

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/internal/agent/claim', status: 401 }),
    );
  });
});
