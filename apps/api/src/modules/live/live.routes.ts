import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import type { AppEnvironment } from '../../auth/types.js';
import { ChatError } from '../chat/chat.core.js';
import { Id } from '../plans/plan.schemas.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import { DraftChangesSchema, OutputSchema, TurnSchema } from './live.schemas.js';
import {
  bootstrap,
  conversationRuns,
  draftChanges,
  getOutput,
  getTurn,
  liveEvents,
} from './live.service.js';
const errors = Object.fromEntries(
  [400, 401, 404, 409].map((code) => [
    code,
    { description: 'Rejected.', content: { 'application/json': { schema: ErrorSchema } } },
  ]),
);
const response = <T extends z.ZodType>(schema: T) => ({
  description: 'Success.',
  content: { 'application/json': { schema } },
});
/** Connections end before a bearer token expires; the client reconnects with a fresh one. */
const CONNECTION_MS = 45000;
const POLL_MS = 750;
const HEARTBEAT_MS = 15000;
const cursor = z
  .string()
  .regex(/^\d{1,18}$/)
  .default('0');
export function registerLiveRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/live/bootstrap',
      tags: ['Live'],
      responses: { ...errors, 200: response(z.object({ cursor: z.string() })) },
    }),
    async (c) => c.json(await bootstrap(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/conversations/{conversationId}/runs',
      tags: ['Chat'],
      request: {
        params: z.object({ conversationId: Id }),
        query: z.object({
          beforeSequence: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
      responses: {
        ...errors,
        200: response(
          z.object({ runs: z.array(TurnSchema), nextBeforeSequence: z.number().nullable() }),
        ),
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      return c.json(
        await conversationRuns(
          c.get('athlete').id,
          c.req.valid('param').conversationId,
          query.beforeSequence,
          query.limit,
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/agent-runs/{runId}/output',
      tags: ['Chat'],
      request: { params: z.object({ runId: Id }) },
      responses: { ...errors, 200: response(OutputSchema) },
    }),
    async (c) =>
      c.json(
        OutputSchema.parse(await getOutput(c.get('athlete').id, c.req.valid('param').runId)),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/agent-runs/{runId}/turn',
      tags: ['Chat'],
      request: { params: z.object({ runId: Id }) },
      responses: { ...errors, 200: response(TurnSchema) },
    }),
    async (c) => c.json(await getTurn(c.get('athlete').id, c.req.valid('param').runId), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}/draft/changes',
      tags: ['Plans'],
      request: { params: z.object({ planId: Id }) },
      responses: { ...errors, 200: response(DraftChangesSchema) },
    }),
    async (c) => c.json(await draftChanges(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/live/events',
      tags: ['Live'],
      request: { query: z.object({ cursor }) },
      responses: {
        ...errors,
        200: {
          description: 'Owner-scoped SSE notifications. Reconnect with a fresh bearer token.',
          content: { 'text/event-stream': { schema: z.string() } },
        },
      },
    }),
    async (c) => {
      const value = c.req.header('last-event-id') ?? c.req.valid('query').cursor;
      if (!cursor.safeParse(value).success)
        throw new ChatError('INVALID_CURSOR', 'Invalid live cursor.', 400);
      const owner = c.get('athlete').id;
      c.header('Cache-Control', 'no-store');
      c.header('X-Accel-Buffering', 'no');
      const response = streamSSE(
        c,
        async (stream) => {
          let current = value;
          const end = Date.now() + CONNECTION_MS;
          let quietSince = Date.now();
          while (!stream.aborted && Date.now() < end) {
            const page = await liveEvents(owner, current);
            if (page.reset || page.events.length) quietSince = Date.now();
            if (page.reset)
              await stream.writeSSE({
                event: 'reset',
                id: page.cursor,
                data: JSON.stringify({ cursor: page.cursor }),
              });
            for (const event of page.events)
              await stream.writeSSE({
                event: event.type,
                id: event.id,
                data: JSON.stringify(event.metadata),
              });
            current = page.cursor;
            if (page.events.length) continue;
            // Proxies close idle streams; a periodic heartbeat keeps this one open.
            if (Date.now() - quietSince >= HEARTBEAT_MS) {
              await stream.writeSSE({ event: 'heartbeat', data: '{}' });
              quietSince = Date.now();
            }
            await stream.sleep(POLL_MS);
          }
        },
        async () => {},
      );
      // streamSSE supplies no-cache by default; private replay must not be stored.
      response.headers.set('Cache-Control', 'no-store');
      return response;
    },
  );
}
