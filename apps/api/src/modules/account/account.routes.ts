import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { AppEnvironment } from '../../auth/types.js';
import { getApiConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import { AccountExportSchema, AccountSchema } from './account.schemas.js';
import {
  cancelAccountDeletion,
  exportAccount,
  getAccount,
  requestAccountDeletion,
  scheduleImmediatePurge,
} from './account.service.js';

const errors = Object.fromEntries(
  [401, 409].map((status) => [
    status,
    {
      description: 'Request rejected.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  ]),
);
const response = (schema: typeof AccountSchema | typeof AccountExportSchema) => ({
  ...errors,
  200: { description: 'Successful response.', content: { 'application/json': { schema } } },
});

export function registerAccountRoutes(app: OpenAPIHono<AppEnvironment>): void {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/account',
      tags: ['Account'],
      responses: response(AccountSchema),
    }),
    async (c) => c.json(await getAccount(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/account/deletion',
      tags: ['Account'],
      description: 'Schedules the account for deletion after a grace period and stops coaching.',
      responses: response(AccountSchema),
    }),
    async (c) => c.json(await requestAccountDeletion(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/account/deletion',
      tags: ['Account'],
      description: 'Cancels a requested deletion during its grace period.',
      responses: response(AccountSchema),
    }),
    async (c) => c.json(await cancelAccountDeletion(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/account/export',
      tags: ['Account'],
      description: 'Every plan, conversation, log, check-in and calibration, as one JSON document.',
      responses: response(AccountExportSchema),
    }),
    async (c) => {
      const data = await exportAccount(c.get('athlete').id);
      c.header('Content-Disposition', 'attachment; filename="askesis-export.json"');
      c.header('Cache-Control', 'no-store');
      return c.json(data as Record<string, unknown>, 200);
    },
  );

  // Clerk deletes a user from its dashboard: purge their data now. Off without a signing secret.
  app.post('/api/webhooks/clerk', async (c) => {
    const signingSecret = getApiConfig().CLERK_WEBHOOK_SIGNING_SECRET;
    if (!signingSecret) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    let event;
    try {
      event = await verifyWebhook(c.req.raw, { signingSecret });
    } catch {
      return c.json({ error: { code: 'INVALID_SIGNATURE' } }, 400);
    }
    if (event.type === 'user.deleted' && event.data.id) {
      const scheduled = await scheduleImmediatePurge(event.data.id);
      if (scheduled) logger.info('Clerk user deleted; account purge scheduled.');
    }
    return c.json({ received: true }, 200);
  });
}
