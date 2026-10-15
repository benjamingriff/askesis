import { z } from 'zod';
import { ApiError } from './api.js';
import { AgentConfigError } from './config.js';

const API_CODES = new Set([
  'VALIDATION_ERROR',
  'INVALID_BODY',
  'BODY_TOO_LARGE',
  'MACHINE_AUTH_REQUIRED',
  'AGENT_UNAVAILABLE',
  'API_ERROR',
  'API_UNREACHABLE',
  'LEASE_LOST',
  'CANCELLED',
  'STALE_CONTEXT',
  'NOT_FOUND',
  'OUTPUT_LIMIT',
]);
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export type WorkerLogDetails = {
  operation?: 'register' | 'claim' | 'heartbeat' | 'finish';
  phase?: 'startup' | 'running' | 'shutdown';
  attempt?: number;
  retryInMs?: number;
  failureCode?: string;
  errorKind?:
    'http' | 'network' | 'timeout' | 'aborted' | 'invalid_response' | 'configuration' | 'unknown';
  httpStatus?: number;
  apiCode?: string;
  requestId?: string;
  networkCode?: string;
  configFields?: string[];
  hint?: string;
};

/** Select diagnostics explicitly; never serialize arbitrary error messages, stacks or bodies. */
export function failureDetails(error: unknown): WorkerLogDetails {
  if (error instanceof AgentConfigError)
    return { errorKind: 'configuration', configFields: error.fields };
  if (error instanceof ApiError)
    return {
      errorKind: 'http',
      httpStatus: error.status,
      apiCode: API_CODES.has(error.code) ? error.code : 'API_ERROR',
      ...(error.requestId ? { requestId: error.requestId } : {}),
    };
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return { errorKind: 'invalid_response' };
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return { errorKind: 'timeout' };
    if (error.name === 'AbortError') return { errorKind: 'aborted' };
    const cause = error.cause;
    const causes = cause instanceof AggregateError ? cause.errors : [cause, error];
    for (const item of causes) {
      const code = item && typeof item === 'object' && 'code' in item ? item.code : undefined;
      if (typeof code === 'string' && NETWORK_CODES.has(code))
        return { errorKind: 'network', networkCode: code };
    }
    if (error instanceof TypeError) return { errorKind: 'network' };
  }
  return { errorKind: 'unknown' };
}

export function registrationDetails(error: unknown): WorkerLogDetails {
  const details = failureDetails(error);
  const hint =
    details.httpStatus === 400
      ? 'Registration rejected; check matching API/worker prompt versions and registration schema during rollout.'
      : details.httpStatus === 401 || details.httpStatus === 403
        ? 'Check the shared AGENT_BOOTSTRAP_TOKEN on the API and worker.'
        : details.httpStatus === 503
          ? 'Check API readiness and CHAT_EXECUTION_MODE=agent.'
          : details.errorKind === 'network' || details.errorKind === 'timeout'
            ? 'Check AGENT_API_URL, private DNS, API listening port and rollout readiness.'
            : 'Check API logs using requestId and confirm matching API/worker deployments.';
  return { ...details, hint };
}

type WorkerLogContext = {
  workerId?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  apiHost?: string;
};
export type WorkerReporter = (code: string, runId?: string, details?: WorkerLogDetails) => void;

export function createWorkerReporter(context: WorkerLogContext): WorkerReporter {
  return (code, runId, details) => {
    const level = code === 'failed' || code.includes('FAILED') ? 'error' : 'info';
    const line = JSON.stringify({
      time: new Date().toISOString(),
      service: 'askesis-agent',
      level,
      code,
      ...context,
      ...(runId ? { runId } : {}),
      ...details,
    });
    if (level === 'error') console.error(line);
    else console.log(line);
  };
}
