import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnvironment } from '../../auth/types.js';
import { Id } from '../plans/plan.common.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import { linkActivity, readActivityLinks, unlinkActivity } from './activity-link.service.js';
import {
  ActivityDetailSchema,
  ActivityLinkInputSchema,
  ActivityLinksSchema,
  ActivityListQuerySchema,
  ActivityListSchema,
  CompleteStravaConnectionSchema,
  IntegrationsStateSchema,
  ProviderActivityIdSchema,
  StartStravaConnectionSchema,
} from './activity.schemas.js';
import {
  completeStravaConnection,
  disconnectStrava,
  listStravaActivities,
  readIntegrations,
  readStravaActivity,
  startStravaConnection,
} from './integration.service.js';

const rejected = Object.fromEntries(
  [400, 401, 404, 409, 422, 502, 503].map((status) => [
    status,
    { description: 'Request rejected.', content: { 'application/json': { schema: ErrorSchema } } },
  ]),
);
const ok = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { description, content: { 'application/json': { schema } } },
  ...rejected,
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const integrations = ok(IntegrationsStateSchema, 'Connected activity providers.');
const links = ok(ActivityLinksSchema, 'The plan’s activity links.');
const workoutParams = z.object({ planId: Id, lineageId: Id });

/**
 * Activity connections. None of these routes are available to the coaching worker: Strava's
 * API terms forbid using its data in AI applications.
 */
export function registerActivityRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/integrations',
      tags: ['Activities'],
      responses: integrations,
    }),
    async (c) => c.json(await readIntegrations(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/integrations/strava/authorize',
      tags: ['Activities'],
      description: 'Start connecting Strava: returns the Strava consent page to open.',
      request: { body: body(StartStravaConnectionSchema) },
      responses: ok(z.object({ url: z.string().url() }), 'The Strava authorization address.'),
    }),
    (c) => c.json(startStravaConnection(c.get('athlete').id, c.req.valid('json').redirectUri), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/integrations/strava/connect',
      tags: ['Activities'],
      description: 'Finish connecting with the code Strava returned to the web callback.',
      request: { body: body(CompleteStravaConnectionSchema) },
      responses: integrations,
    }),
    async (c) =>
      c.json(await completeStravaConnection(c.get('athlete').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/integrations/strava',
      tags: ['Activities'],
      description: 'Revoke access at Strava and delete the connection and every activity link.',
      responses: integrations,
    }),
    async (c) => c.json(await disconnectStrava(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/integrations/strava/activities',
      tags: ['Activities'],
      description:
        'The athlete’s Strava activities in the week either side of a day, read live from Strava and not stored.',
      request: { query: ActivityListQuerySchema },
      responses: ok(ActivityListSchema, 'Recent activities.'),
    }),
    async (c) =>
      c.json(await listStravaActivities(c.get('athlete').id, c.req.valid('query').around), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/integrations/strava/activities/{activityId}',
      tags: ['Activities'],
      description: 'One Strava activity with its laps, read live from Strava and not stored.',
      request: { params: z.object({ activityId: ProviderActivityIdSchema }) },
      responses: ok(ActivityDetailSchema, 'The activity.'),
    }),
    async (c) =>
      c.json(await readStravaActivity(c.get('athlete').id, c.req.valid('param').activityId), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}/activity-links',
      tags: ['Activities'],
      request: { params: z.object({ planId: Id }) },
      responses: links,
    }),
    async (c) =>
      c.json(await readActivityLinks(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/plans/{planId}/workouts/{lineageId}/activity-link',
      tags: ['Activities'],
      description:
        'Link the athlete’s chosen activity to a workout, replacing any earlier link. Only the activity id is stored.',
      request: { params: workoutParams, body: body(ActivityLinkInputSchema) },
      responses: links,
    }),
    async (c) => {
      const p = c.req.valid('param');
      return c.json(
        await linkActivity(
          c.get('athlete').id,
          p.planId,
          p.lineageId,
          c.req.valid('json').activityId,
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/plans/{planId}/workouts/{lineageId}/activity-link',
      tags: ['Activities'],
      request: { params: workoutParams },
      responses: links,
    }),
    async (c) => {
      const p = c.req.valid('param');
      return c.json(await unlinkActivity(c.get('athlete').id, p.planId, p.lineageId), 200);
    },
  );
}
