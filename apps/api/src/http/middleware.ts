import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../auth/types.js';
import { logger } from '../logger.js';

const validRequestId = /^[A-Za-z0-9._:-]{1,128}$/;
const probePaths = new Set(['/api/health', '/api/ready']);
// The idle worker registers every 15 seconds and polls for work every second.
const workerPollPaths = new Set(['/internal/agent/register', '/internal/agent/claim']);

function isRoutine(path: string, status: number) {
  return probePaths.has(path) || (workerPollPaths.has(path) && status < 400);
}

export const requestContext: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const supplied = context.req.header('x-request-id');
  const requestId =
    supplied !== undefined && validRequestId.test(supplied) ? supplied : randomUUID();
  const startedAt = performance.now();

  context.set('requestId', requestId);
  context.header('x-request-id', requestId);

  try {
    await next();
  } finally {
    const athlete = context.get('athlete');
    const details = {
      requestId,
      method: context.req.method,
      route: context.req.path,
      status: context.res.status,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      athleteId: athlete?.id,
    };
    if (isRoutine(details.route, details.status)) {
      logger.debug(details);
    } else {
      logger.info(details);
    }
  }
};
