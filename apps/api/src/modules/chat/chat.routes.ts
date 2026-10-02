import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { Id } from '../plans/plan.schemas.js';
import type { AppEnvironment } from '../../auth/types.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import {
  AcceptedSchema,
  ConversationDetailSchema,
  ConversationSchema,
  CreatedSchema,
  CreateConversationSchema,
  EventSchema,
  ListQuerySchema,
  MessageSchema,
  RunSchema,
  SendSchema,
} from './chat.schemas.js';
import {
  cancelRun,
  changeConversation,
  chatCapabilities,
  createConversation,
  getConversation,
  getRun,
  listConversations,
  listEvents,
  listMessages,
  openPlanConversation,
  sendMessage,
} from './chat.service.js';

const errors = Object.fromEntries(
  [400, 401, 404, 409, 503].map((status) => [
    status,
    { description: 'Request rejected.', content: { 'application/json': { schema: ErrorSchema } } },
  ]),
);
const response = <T extends z.ZodType>(schema: T) => ({
  description: 'Successful response.',
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const params = z.object({ conversationId: Id });
const runParams = z.object({ runId: Id });
const headers = z.object({ 'idempotency-key': z.string().min(1).max(200) });
const limit = z.coerce.number().int().min(1).max(100).default(50);
const state = z.object({ expectedStateVersion: z.number().int().positive() });

export function registerChatRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/chat-capabilities',
      tags: ['Chat'],
      responses: {
        ...errors,
        200: response(
          z.object({
            executionAvailable: z.boolean(),
            mode: z.enum(['unavailable', 'test', 'agent']),
          }),
        ),
      },
    }),
    async (c) => c.json(await chatCapabilities(), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/conversations',
      tags: ['Chat'],
      request: { query: ListQuerySchema },
      responses: {
        ...errors,
        200: response(
          z.object({
            conversations: z.array(ConversationSchema),
            nextCursor: z.string().nullable(),
          }),
        ),
      },
    }),
    async (c) => c.json(await listConversations(c.get('athlete').id, c.req.valid('query')), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/conversations',
      tags: ['Chat'],
      request: { headers, body: body(CreateConversationSchema) },
      responses: { ...errors, 201: response(CreatedSchema) },
    }),
    async (c) =>
      c.json(
        await createConversation(
          c.get('athlete').id,
          c.req.valid('json'),
          c.req.valid('header')['idempotency-key'],
        ),
        201,
      ),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/conversations/{conversationId}',
      tags: ['Chat'],
      request: { params },
      responses: { ...errors, 200: response(ConversationDetailSchema) },
    }),
    async (c) =>
      c.json(await getConversation(c.get('athlete').id, c.req.valid('param').conversationId), 200),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/v1/conversations/{conversationId}',
      tags: ['Chat'],
      request: { params, body: body(state.extend({ title: z.string().trim().min(1).max(120) })) },
      responses: { ...errors, 200: response(ConversationSchema) },
    }),
    async (c) =>
      c.json(
        await changeConversation(
          c.get('athlete').id,
          c.req.valid('param').conversationId,
          c.req.valid('json').expectedStateVersion,
          { title: c.req.valid('json').title },
        ),
        200,
      ),
  );
  for (const action of ['archive', 'unarchive'] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/api/v1/conversations/{conversationId}/${action}`,
        tags: ['Chat'],
        request: { params, body: body(state) },
        responses: { ...errors, 200: response(ConversationSchema) },
      }),
      async (c) =>
        c.json(
          await changeConversation(
            c.get('athlete').id,
            c.req.valid('param').conversationId,
            c.req.valid('json').expectedStateVersion,
            { archived: action === 'archive' },
          ),
          200,
        ),
    );
  }
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/conversations/open',
      tags: ['Chat'],
      request: { params: z.object({ planId: Id }) },
      responses: { ...errors, 200: response(ConversationSchema) },
    }),
    async (c) =>
      c.json(await openPlanConversation(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/conversations/{conversationId}/messages',
      tags: ['Chat'],
      request: {
        params,
        query: z.object({ beforeSequence: z.coerce.number().int().positive().optional(), limit }),
      },
      responses: {
        ...errors,
        200: response(
          z.object({ messages: z.array(MessageSchema), nextBeforeSequence: z.number().nullable() }),
        ),
      },
    }),
    async (c) =>
      c.json(
        await listMessages(
          c.get('athlete').id,
          c.req.valid('param').conversationId,
          c.req.valid('query').beforeSequence,
          c.req.valid('query').limit,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/conversations/{conversationId}/messages',
      tags: ['Chat'],
      request: { params, headers, body: body(SendSchema) },
      responses: { ...errors, 202: response(AcceptedSchema) },
    }),
    async (c) =>
      c.json(
        await sendMessage(
          c.get('athlete').id,
          c.req.valid('param').conversationId,
          c.req.valid('json'),
          c.req.valid('header')['idempotency-key'],
        ),
        202,
      ),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/agent-runs/{runId}',
      tags: ['Chat'],
      request: { params: runParams },
      responses: { ...errors, 200: response(RunSchema) },
    }),
    async (c) => c.json(await getRun(c.get('athlete').id, c.req.valid('param').runId), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/agent-runs/{runId}/cancel',
      tags: ['Chat'],
      request: { params: runParams },
      responses: { ...errors, 200: response(RunSchema) },
    }),
    async (c) => c.json(await cancelRun(c.get('athlete').id, c.req.valid('param').runId), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/agent-runs/{runId}/events',
      tags: ['Chat'],
      request: {
        params: runParams,
        query: z.object({ afterSequence: z.coerce.number().int().min(0).default(0), limit }),
      },
      responses: {
        ...errors,
        200: response(
          z.object({ events: z.array(EventSchema), nextAfterSequence: z.number().nullable() }),
        ),
      },
    }),
    async (c) =>
      c.json(
        await listEvents(
          c.get('athlete').id,
          c.req.valid('param').runId,
          c.req.valid('query').afterSequence,
          c.req.valid('query').limit,
        ),
        200,
      ),
  );
}
