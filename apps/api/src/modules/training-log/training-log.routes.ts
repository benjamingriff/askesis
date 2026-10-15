import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnvironment } from '../../auth/types.js';
import { getDatabase } from '../../database/client.js';
import { Id } from '../plans/plan.common.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import {
  TrainingLogSchema,
  LogSchema,
  LogInputSchema,
  CheckInInputSchema,
  CheckInSchema,
} from './training-log.schemas.js';
import {
  readTrainingLog,
  saveLogRows,
  clearLogRows,
  logCommand,
  createCheckInRows,
} from './training-log.service.js';
const response = <T extends z.ZodType>(schema: T) => ({
  description: 'Success.',
  content: { 'application/json': { schema } },
});
const errors = Object.fromEntries(
  [400, 401, 404, 409, 422].map((n) => [
    n,
    { description: 'Rejected.', content: { 'application/json': { schema: ErrorSchema } } },
  ]),
);
const params = z.object({ planId: Id, lineageId: Id });
const headers = z.object({ 'idempotency-key': z.string().min(1).max(200).optional() });
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const ClearedSchema = z.object({ cleared: z.boolean() });
export function registerTrainingLogRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/training-log',
      tags: ['Training log'],
      request: {
        query: z.object({
          planId: Id.optional(),
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
        }),
      },
      responses: { 200: response(TrainingLogSchema), ...errors },
    }),
    async (c) =>
      c.json(await readTrainingLog(getDatabase(), c.get('athlete').id, c.req.valid('query')), 200),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/plans/{planId}/workouts/{lineageId}/log',
      tags: ['Training log'],
      request: { params, headers, body: body(LogInputSchema) },
      responses: { 200: response(LogSchema), ...errors },
    }),
    async (c) => {
      const p = c.req.valid('param'),
        input = c.req.valid('json'),
        owner = c.get('athlete').id;
      return c.json(
        await logCommand(
          owner,
          'log.put',
          c.req.valid('header')['idempotency-key'],
          { ...p, input },
          LogSchema,
          (db) => saveLogRows(db, owner, p.planId, p.lineageId, input),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/plans/{planId}/workouts/{lineageId}/log',
      tags: ['Training log'],
      request: { params, headers },
      responses: { 200: response(ClearedSchema), ...errors },
    }),
    async (c) => {
      const p = c.req.valid('param'),
        owner = c.get('athlete').id;
      return c.json(
        await logCommand(
          owner,
          'log.clear',
          c.req.valid('header')['idempotency-key'],
          p,
          ClearedSchema,
          (db) => clearLogRows(db, owner, p.planId, p.lineageId),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/check-ins',
      tags: ['Training log'],
      request: { headers, body: body(CheckInInputSchema) },
      responses: { 200: response(CheckInSchema), ...errors },
    }),
    async (c) => {
      const input = c.req.valid('json'),
        owner = c.get('athlete').id;
      return c.json(
        await logCommand(
          owner,
          'check-in.create',
          c.req.valid('header')['idempotency-key'],
          input,
          CheckInSchema,
          (db) => createCheckInRows(db, owner, input),
        ),
        200,
      );
    },
  );
}
