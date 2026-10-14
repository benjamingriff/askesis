import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnvironment } from '../../auth/types.js';
import {
  DatabaseIdSchema,
  ErrorSchema,
  WorkoutListQuerySchema,
} from '../workouts/workout.schemas.js';
import { decideActivityLink, readAdherence, readWorkoutActual } from './adherence.service.js';
import {
  ActivityLinkDecisionSchema,
  AdherenceSchema,
  CompleteStravaConnectionSchema,
  IntegrationsStateSchema,
  StartStravaConnectionSchema,
  StravaSyncResultSchema,
  WorkoutActualSchema,
} from './activity.schemas.js';
import {
  completeStravaConnection,
  disconnectStrava,
  readIntegrations,
  startStravaConnection,
  syncStrava,
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
      method: 'post',
      path: '/api/v1/integrations/strava/sync',
      tags: ['Activities'],
      description:
        'Refresh activities from a week before the earliest active plan. Strava data is a seven-day cache, so each sync re-reads the window and drops anything deleted on Strava.',
      responses: ok(StravaSyncResultSchema, 'What changed.'),
    }),
    async (c) => c.json(await syncStrava(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/v1/integrations/strava',
      tags: ['Activities'],
      description: 'Revoke access at Strava and delete every activity and link decision from it.',
      responses: integrations,
    }),
    async (c) => c.json(await disconnectStrava(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/adherence',
      tags: ['Activities'],
      description:
        'Planned versus actual for one plan version: each workout’s outcome, extra activities and weekly totals.',
      request: { query: WorkoutListQuerySchema },
      responses: ok(AdherenceSchema, 'Plan adherence.'),
    }),
    async (c) =>
      c.json(await readAdherence(c.get('athlete').id, c.req.valid('query').planVersionId), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/workouts/{workoutId}/actual',
      tags: ['Activities'],
      description:
        'The activities linked to a workout, rep-by-rep effort checks and other candidates.',
      request: { params: z.object({ workoutId: DatabaseIdSchema }) },
      responses: ok(WorkoutActualSchema, 'What happened for this workout.'),
    }),
    async (c) =>
      c.json(await readWorkoutActual(c.get('athlete').id, c.req.valid('param').workoutId), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/workouts/{workoutId}/activity-links',
      tags: ['Activities'],
      description: 'Link an activity to this workout, or reject a suggested match.',
      request: {
        params: z.object({ workoutId: DatabaseIdSchema }),
        body: body(ActivityLinkDecisionSchema),
      },
      responses: ok(WorkoutActualSchema, 'The workout’s updated actuals.'),
    }),
    async (c) =>
      c.json(
        await decideActivityLink(
          c.get('athlete').id,
          c.req.valid('param').workoutId,
          c.req.valid('json'),
        ),
        200,
      ),
  );
}
