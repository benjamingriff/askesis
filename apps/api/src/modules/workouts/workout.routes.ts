import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnvironment } from '../../auth/types.js';
import { getWorkoutDetail, listWorkouts } from './workout.repository.js';
import {
  DatabaseIdSchema,
  ErrorSchema,
  WorkoutDetailSchema,
  WorkoutListQuerySchema,
  WorkoutListSchema,
} from './workout.schemas.js';

const listWorkoutsRoute = createRoute({
  method: 'get',
  path: '/api/v1/workouts',
  request: {
    query: WorkoutListQuerySchema,
  },
  responses: {
    200: {
      description: 'Scheduled workouts in chronological order.',
      content: {
        'application/json': {
          schema: WorkoutListSchema,
        },
      },
    },
    401: {
      description: 'Authentication is required.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
  tags: ['Workouts'],
});

const getWorkoutRoute = createRoute({
  method: 'get',
  path: '/api/v1/workouts/{workoutId}',
  request: {
    params: z.object({ workoutId: DatabaseIdSchema }),
  },
  responses: {
    200: {
      description: 'A workout and its nested prescription tree.',
      content: { 'application/json': { schema: WorkoutDetailSchema } },
    },
    404: {
      description: 'Workout not found.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Authentication is required.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
  tags: ['Workouts'],
});

export function registerWorkoutRoutes(app: OpenAPIHono<AppEnvironment>): void {
  app.openapi(listWorkoutsRoute, async (context) => {
    const { planId } = context.req.valid('query');
    const workouts = await listWorkouts(context.get('athlete').id, planId);
    return context.json({ workouts }, 200);
  });

  app.openapi(getWorkoutRoute, async (context) => {
    const { workoutId } = context.req.valid('param');
    const detail = await getWorkoutDetail(context.get('athlete').id, workoutId);
    if (detail === null) {
      return context.json(
        {
          error: {
            code: 'WORKOUT_NOT_FOUND',
            message: 'Workout not found.',
            requestId: context.get('requestId'),
          },
        },
        404,
      );
    }
    return context.json(detail, 200);
  });
}
