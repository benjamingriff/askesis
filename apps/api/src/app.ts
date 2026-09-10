import * as Sentry from '@sentry/node';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'kysely';
import { requireAuthentication } from './auth/middleware.js';
import type { AppEnvironment } from './auth/types.js';
import { getDatabase } from './database/client.js';
import { requestContext } from './http/middleware.js';
import { logger } from './logger.js';
import { registerWorkoutRoutes } from './modules/workouts/workout.routes.js';
import { registerPlanRoutes } from './modules/plans/plan.routes.js';
import { registerBriefRoutes } from './modules/plans/brief.routes.js';
import { PlanError } from './modules/plans/plan.service.js';

export const app = new OpenAPIHono<AppEnvironment>({
  defaultHook: (result, context) => {
    if (result.success) return;
    return context.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid.',
          requestId: context.get('requestId'),
        },
      },
      400,
    );
  },
});

app.use('*', requestContext);

app.onError((error, context) => {
  const requestId = context.get('requestId');
  if (error instanceof PlanError) {
    return context.json(
      { error: { code: error.code, message: error.message, requestId } },
      error.status,
    );
  }
  // PostgreSQL constraint errors can include the entire failing row in `detail`.
  // Never forward that payload (which may contain plan text) to logs or Sentry.
  const safeError =
    'code' in error && /^[0-9A-Z]{5}$/.test(String(error.code))
      ? new Error('Database operation failed.')
      : error;
  logger.error(
    {
      error: { name: safeError.name, message: safeError.message, stack: safeError.stack },
      requestId,
    },
    'Unhandled request error',
  );
  Sentry.withScope((scope) => {
    scope.setTag('request_id', requestId);
    scope.setContext('request', { method: context.req.method, path: context.req.path });
    Sentry.captureException(safeError);
  });
  return context.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId,
      },
    },
    500,
  );
});

app.notFound((context) =>
  context.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: context.get('requestId'),
      },
    },
    404,
  ),
);

app.get('/api/health', (context) => context.json({ status: 'ok' }));
app.get('/api/ready', async (context) => {
  const result = await sql<{ migrated: boolean }>`
    select exists (
      select 1
      from atlas_schema_revisions.atlas_schema_revisions
      where version = '20260909120000'
    ) as migrated
  `.execute(getDatabase());

  if (result.rows[0]?.migrated !== true) {
    return context.json(
      {
        error: {
          code: 'NOT_READY',
          message: 'The service is not ready.',
          requestId: context.get('requestId'),
        },
      },
      503,
    );
  }

  return context.json({ status: 'ready' });
});
app.use('/api/v1/*', requireAuthentication);

registerWorkoutRoutes(app);
registerPlanRoutes(app);
registerBriefRoutes(app);

app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Askesis API',
    version: '0.1.0',
    description: 'Domain API for structured training plans.',
  },
});

app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));
