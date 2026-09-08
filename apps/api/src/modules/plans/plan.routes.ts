import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnvironment } from '../../auth/types.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import {
  CommandSchema,
  CreateSchema,
  DraftPatchSchema,
  PlanParams,
  PlanSchema,
  PreviewSchema,
  PlanListQuery,
  RenameSchema,
  StateCommandSchema,
  RevisionParams,
  RevisionSchema,
  RevisionDetailSchema,
  RestorePreviewSchema,
  RestoreCommandSchema,
} from './plan.schemas.js';
import {
  createPlan,
  discardDraft,
  editDraft,
  getPlan,
  listPlans,
  lockPlan,
  previewLock,
  unlockPlan,
  renamePlan,
  organizePlan,
  listRevisions,
  getRevision,
  previewRestore,
  restoreRevision,
} from './plan.service.js';

const errors = Object.fromEntries(
  [400, 401, 404, 409, 422].map((status) => [
    status,
    {
      description: 'Request rejected.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  ]),
);
const response = <T extends z.ZodType>(schema: T) => ({
  ...errors,
  200: {
    description: 'Successful response.',
    content: { 'application/json': { schema } },
  },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const headers = z.object({ 'idempotency-key': z.string().min(1).max(200) });

export function registerPlanRoutes(app: OpenAPIHono<AppEnvironment>): void {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}/revisions',
      tags: ['Plans'],
      request: { params: PlanParams },
      responses: response(z.object({ revisions: z.array(RevisionSchema) })),
    }),
    async (c) =>
      c.json(
        { revisions: await listRevisions(c.get('athlete').id, c.req.valid('param').planId) },
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}/revisions/{revisionId}',
      tags: ['Plans'],
      request: { params: RevisionParams },
      responses: response(RevisionDetailSchema),
    }),
    async (c) => {
      const { planId, revisionId } = c.req.valid('param');
      return c.json(await getRevision(c.get('athlete').id, planId, revisionId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/revisions/{revisionId}/restore-preview',
      tags: ['Plans'],
      request: { params: RevisionParams },
      responses: response(RestorePreviewSchema),
    }),
    async (c) => {
      const { planId, revisionId } = c.req.valid('param');
      return c.json(await previewRestore(c.get('athlete').id, planId, revisionId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/revisions/{revisionId}/restore',
      tags: ['Plans'],
      request: { params: RevisionParams, headers, body: body(RestoreCommandSchema) },
      responses: response(PlanSchema),
    }),
    async (c) => {
      const { planId, revisionId } = c.req.valid('param');
      return c.json(
        await restoreRevision(
          c.get('athlete').id,
          planId,
          revisionId,
          c.req.valid('json'),
          c.req.valid('header')['idempotency-key'],
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/v1/plans/{planId}',
      tags: ['Plans'],
      request: { params: PlanParams, body: body(RenameSchema) },
      responses: response(PlanSchema),
    }),
    async (c) => {
      const input = c.req.valid('json');
      return c.json(
        await renamePlan(
          c.get('athlete').id,
          c.req.valid('param').planId,
          input.displayName,
          input.expectedStateVersion,
        ),
        200,
      );
    },
  );
  for (const action of ['activate', 'deactivate', 'archive', 'unarchive'] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/api/v1/plans/{planId}/${action}`,
        tags: ['Plans'],
        request: { params: PlanParams, body: body(StateCommandSchema) },
        responses: response(PlanSchema),
      }),
      async (c) =>
        c.json(
          await organizePlan(
            c.get('athlete').id,
            c.req.valid('param').planId,
            action,
            c.req.valid('json').expectedStateVersion,
          ),
          200,
        ),
    );
  }
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans',
      tags: ['Plans'],
      request: { query: PlanListQuery },
      responses: response(z.object({ plans: z.array(PlanSchema) })),
    }),
    async (c) =>
      c.json({ plans: await listPlans(c.get('athlete').id, c.req.valid('query').collection) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans',
      tags: ['Plans'],
      request: { headers, body: body(CreateSchema) },
      responses: response(PlanSchema),
    }),
    async (c) =>
      c.json(
        await createPlan(
          c.get('athlete').id,
          c.req.valid('json').displayName,
          c.req.valid('header')['idempotency-key'],
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}',
      tags: ['Plans'],
      request: { params: PlanParams },
      responses: response(PlanSchema),
    }),
    async (c) => c.json(await getPlan(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/v1/plans/{planId}/draft',
      tags: ['Plans'],
      request: { params: PlanParams, body: body(DraftPatchSchema) },
      responses: response(PlanSchema),
    }),
    async (c) =>
      c.json(
        await editDraft(c.get('athlete').id, c.req.valid('param').planId, c.req.valid('json')),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/validate',
      tags: ['Plans'],
      request: { params: PlanParams },
      responses: response(PreviewSchema),
    }),
    async (c) => c.json(await previewLock(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/unlock',
      tags: ['Plans'],
      request: { params: PlanParams, body: body(CommandSchema) },
      responses: response(PlanSchema),
    }),
    async (c) =>
      c.json(
        await unlockPlan(
          c.get('athlete').id,
          c.req.valid('param').planId,
          c.req.valid('json').expectedStateVersion,
        ),
        200,
      ),
  );
  for (const [command, handler] of [
    ['lock', lockPlan],
    ['discard', discardDraft],
  ] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/api/v1/plans/{planId}/${command}`,
        tags: ['Plans'],
        request: { params: PlanParams, headers, body: body(CommandSchema) },
        responses: response(PlanSchema),
      }),
      async (c) =>
        c.json(
          await handler(
            c.get('athlete').id,
            c.req.valid('param').planId,
            c.req.valid('json'),
            c.req.valid('header')['idempotency-key'],
          ),
          200,
        ),
    );
  }
}
