import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentApi, ApiError } from './api.js';
import { parseAgentConfig } from './config.js';
import { createWorkerReporter, failureDetails, registrationDetails } from './logger.js';

afterEach(() => vi.restoreAllMocks());

it('correlates a registration rejection with the API request and explains the rollout check', async () => {
  const requestId = '00000000-0000-4000-8000-000000000001';
  const api = new AgentApi(
    'http://localhost',
    async () =>
      new Response(
        JSON.stringify({
          error: { code: 'VALIDATION_ERROR', message: 'private body' },
        }),
        { status: 400, headers: { 'x-request-id': requestId } },
      ),
  );
  const error = await api.register('private-token', {}).catch((error: unknown) => error);
  expect(registrationDetails(error)).toEqual({
    errorKind: 'http',
    httpStatus: 400,
    apiCode: 'VALIDATION_ERROR',
    requestId,
    hint: expect.stringContaining('matching API/worker prompt versions'),
  });
  expect(JSON.stringify(registrationDetails(error))).not.toContain('private');
});

it('keeps unknown API codes, malformed request IDs and private response data out of diagnostics', async () => {
  const api = new AgentApi(
    'http://localhost',
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'private-code',
            message: 'private body',
            data: { token: 'private-token' },
          },
        }),
        { status: 401, headers: { 'x-request-id': 'private-request-id' } },
      ),
  );
  const error = await api.register('private-token', {}).catch((error: unknown) => error);
  const details = registrationDetails(error);
  expect(details).toEqual({
    errorKind: 'http',
    httpStatus: 401,
    apiCode: 'API_ERROR',
    hint: expect.stringContaining('AGENT_BOOTSTRAP_TOKEN'),
  });
  expect(JSON.stringify(details)).not.toContain('private');
});

it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])(
  'identifies %s without logging the underlying hostname, message or stack',
  (code) => {
    const cause = Object.assign(new Error('private-host'), { code, token: 'private-token' });
    const error = new TypeError('private-message', { cause: new AggregateError([cause]) });
    expect(failureDetails(error)).toEqual({ errorKind: 'network', networkCode: code });
    expect(registrationDetails(error).hint).toContain('private DNS');
  },
);

it('distinguishes timeouts, malformed responses and unknown failures without raw exceptions', () => {
  expect(failureDetails(new DOMException('private', 'TimeoutError'))).toEqual({
    errorKind: 'timeout',
  });
  const result = z.object({ registered: z.boolean() }).safeParse({ registered: 'private' });
  expect(failureDetails(result.error)).toEqual({ errorKind: 'invalid_response' });
  expect(failureDetails(new SyntaxError('private-body'))).toEqual({
    errorKind: 'invalid_response',
  });
  expect(failureDetails(new Error('private', { cause: { code: 'private-code' } }))).toEqual({
    errorKind: 'unknown',
  });
});

it('reports invalid configuration field names without their values', () => {
  let error: unknown;
  try {
    parseAgentConfig({
      AGENT_PROVIDER: 'private-invalid-provider',
      AGENT_BOOTSTRAP_TOKEN: 'private',
    });
  } catch (caught) {
    error = caught;
  }
  expect(failureDetails(error)).toEqual({
    errorKind: 'configuration',
    configFields: ['AGENT_PROVIDER'],
  });
  expect(JSON.stringify(failureDetails(error))).not.toContain('private');
});

it('writes structured lifecycle and failure records with severity and worker identity', () => {
  const info = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = createWorkerReporter({
    workerId: 'worker-1',
    provider: 'openai',
    model: 'test-model',
    promptVersion: 'coach-v1',
    apiHost: 'api:3000',
  });
  report('REGISTRATION_FAILED', undefined, {
    operation: 'register',
    phase: 'startup',
    attempt: 2,
    retryInMs: 5000,
    ...registrationDetails(new ApiError('VALIDATION_ERROR', 400)),
  });
  expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({
    time: expect.any(String),
    service: 'askesis-agent',
    level: 'error',
    code: 'REGISTRATION_FAILED',
    workerId: 'worker-1',
    promptVersion: 'coach-v1',
    apiHost: 'api:3000',
    attempt: 2,
    retryInMs: 5000,
    httpStatus: 400,
    apiCode: 'VALIDATION_ERROR',
  });
  report('WORKER_READY');
  expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
    level: 'info',
    code: 'WORKER_READY',
    workerId: 'worker-1',
  });
  report('failed', 'run-1', { failureCode: 'PROVIDER_ERROR' });
  expect(JSON.parse(String(errors.mock.lastCall?.[0]))).toMatchObject({
    level: 'error',
    runId: 'run-1',
    failureCode: 'PROVIDER_ERROR',
  });
});
