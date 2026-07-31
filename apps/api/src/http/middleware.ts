import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../auth/types.js';
import { logger } from '../logger.js';

const validRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

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
    if (context.req.path === '/api/health' || context.req.path === '/api/ready') {
      logger.debug(details);
    } else {
      logger.info(details);
    }
  }
};
