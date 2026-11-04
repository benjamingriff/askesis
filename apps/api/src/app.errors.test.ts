import * as Sentry from '@sentry/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './app.js';
import { ChatError } from './modules/chat/chat.core.js';
import { PlanError } from './modules/plans/plan.service.js';

const telemetry = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
  scope: { setTag: vi.fn(), setContext: vi.fn() },
}));

vi.mock('./logger.js', () => ({ logger: telemetry.logger }));
vi.mock('@sentry/node', () => ({
  withScope: vi.fn((callback: (scope: typeof telemetry.scope) => void) => {
    callback(telemetry.scope);
  }),
  captureException: telemetry.captureException,
}));

const privateSentinel = 'SYNTHETIC_PRIVATE_PLAN_SENTINEL';
const databaseError = Object.assign(new Error(privateSentinel), {
  name: 'DatabaseError',
  code: '23514',
  detail: `Failing row contains ${privateSentinel}`,
  stack: `DatabaseError: ${privateSentinel}\n    at synthetic-private-row`,
});
const ordinaryError = new Error('Synthetic ordinary failure');
const domainErrors = [
  new PlanError('PLAN_NOT_FOUND', 'Plan not found.', 404),
  new ChatError('RUN_ACTIVE', 'Stop the active chat run before changing this plan.', 409),
];

// These routes exist only when this isolated test module runs; production never imports it.
app.get('/test-errors/database', () => {
  throw databaseError;
});
app.get('/test-errors/ordinary', () => {
  throw ordinaryError;
});
for (const error of domainErrors) {
  app.get(`/test-errors/${error.code}`, () => {
    throw error;
  });
}

async function requestUnhandledError(path: string) {
  const requestId = 'error-boundary-test';
  const response = await app.request(path, { headers: { 'x-request-id': requestId } });

  expect(response.status).toBe(500);
  expect(response.headers.get('x-request-id')).toBe(requestId);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
  });
  expect(telemetry.logger.error).toHaveBeenCalledTimes(1);
  expect(telemetry.logger.error).toHaveBeenCalledWith(
    { error: expect.any(Object), requestId },
    'Unhandled request error',
  );
  expect(telemetry.logger.info).toHaveBeenCalledWith(
    expect.objectContaining({ requestId, method: 'GET', route: path, status: 500 }),
  );
  expect(Sentry.withScope).toHaveBeenCalledTimes(1);
  expect(telemetry.scope.setTag).toHaveBeenCalledWith('request_id', requestId);
  expect(telemetry.scope.setContext).toHaveBeenCalledWith('request', { method: 'GET', path });
  expect(telemetry.captureException).toHaveBeenCalledTimes(1);
}

describe('API error reporting boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sanitizes recognized database errors before Pino logging', async () => {
    await requestUnhandledError('/test-errors/database');

    const [record] = telemetry.logger.error.mock.calls[0]!;
    expect(record.error).toEqual({
      name: 'Error',
      message: 'Database operation failed.',
      stack: expect.any(String),
    });
    expect(record.error).not.toBe(databaseError);
    expect(record.error.message).not.toContain(privateSentinel);
    expect(record.error.stack).not.toContain(privateSentinel);
    expect(record.error).not.toHaveProperty('detail');
    expect(JSON.stringify(telemetry.logger.error.mock.calls)).not.toContain(privateSentinel);
  });

  it('sanitizes recognized database errors before Sentry capture', async () => {
    await requestUnhandledError('/test-errors/database');

    const [captured] = telemetry.captureException.mock.calls[0]!;
    expect(captured).toBeInstanceOf(Error);
    expect(captured).not.toBe(databaseError);
    expect(captured.message).toBe('Database operation failed.');
    expect(captured.stack).toEqual(expect.any(String));
    expect(captured.message).not.toContain(privateSentinel);
    expect(captured.stack).not.toContain(privateSentinel);
    expect(captured).not.toHaveProperty('detail');
    expect(JSON.stringify(telemetry.captureException.mock.calls)).not.toContain(privateSentinel);
  });

  it('retains ordinary error diagnostics in telemetry with a generic public response', async () => {
    await requestUnhandledError('/test-errors/ordinary');

    expect(telemetry.logger.error).toHaveBeenCalledWith(
      {
        error: {
          name: ordinaryError.name,
          message: ordinaryError.message,
          stack: ordinaryError.stack,
        },
        requestId: 'error-boundary-test',
      },
      'Unhandled request error',
    );
    expect(telemetry.captureException).toHaveBeenCalledWith(ordinaryError);
  });

  it.each(domainErrors)(
    'preserves domain error $code without unexpected telemetry',
    async (error) => {
      const path = `/test-errors/${error.code}`;
      const requestId = 'domain-error-test';
      const response = await app.request(path, { headers: { 'x-request-id': requestId } });

      expect(response.status).toBe(error.status);
      expect(response.headers.get('x-request-id')).toBe(requestId);
      await expect(response.json()).resolves.toEqual({
        error: { code: error.code, message: error.message, requestId },
      });
      expect(telemetry.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ requestId, method: 'GET', route: path, status: error.status }),
      );
      expect(telemetry.logger.error).not.toHaveBeenCalled();
      expect(Sentry.withScope).not.toHaveBeenCalled();
      expect(telemetry.captureException).not.toHaveBeenCalled();
      expect(telemetry.scope.setTag).not.toHaveBeenCalled();
      expect(telemetry.scope.setContext).not.toHaveBeenCalled();
    },
  );
});
