import { createRoute, type z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnvironment } from '../../auth/types.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import { PlanParams, Id } from './plan.schemas.js';
import {
  BriefStateSchema,
  SaveBriefSchema,
  ConfirmBriefSchema,
  CalibrationCommand,
  BriefCommand,
} from './brief.schemas.js';
import {
  getBrief,
  saveBrief,
  confirmBrief,
  addCalibration,
  useCalibration,
} from './brief.service.js';

const responses = {
  200: {
    description: 'Brief and calibration state.',
    content: { 'application/json': { schema: BriefStateSchema } },
  },
  ...Object.fromEntries(
    [400, 401, 404, 409, 422].map((status) => [
      status,
      {
        description: 'Request rejected.',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    ]),
  ),
};
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
export function registerBriefRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}/draft/brief',
      tags: ['Brief'],
      request: { params: PlanParams },
      responses,
    }),
    async (c) => c.json(await getBrief(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}/revisions/{revisionId}/brief',
      tags: ['Brief'],
      request: { params: PlanParams.extend({ revisionId: Id }) },
      responses,
    }),
    async (c) =>
      c.json(
        await getBrief(
          c.get('athlete').id,
          c.req.valid('param').planId,
          c.req.valid('param').revisionId,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/v1/plans/{planId}/draft/brief',
      tags: ['Brief'],
      request: { params: PlanParams, body: body(SaveBriefSchema) },
      responses,
    }),
    async (c) =>
      c.json(
        await saveBrief(c.get('athlete').id, c.req.valid('param').planId, c.req.valid('json')),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/draft/brief/validate',
      tags: ['Brief'],
      request: { params: PlanParams },
      responses,
    }),
    async (c) => c.json(await getBrief(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/draft/brief/confirm',
      tags: ['Brief'],
      request: { params: PlanParams, body: body(ConfirmBriefSchema) },
      responses,
    }),
    async (c) =>
      c.json(
        await confirmBrief(c.get('athlete').id, c.req.valid('param').planId, c.req.valid('json')),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/plans/{planId}/draft/calibrations',
      tags: ['Brief'],
      request: { params: PlanParams },
      responses,
    }),
    async (c) => c.json(await getBrief(c.get('athlete').id, c.req.valid('param').planId), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/draft/calibrations',
      tags: ['Brief'],
      request: { params: PlanParams, body: body(CalibrationCommand) },
      responses,
    }),
    async (c) =>
      c.json(
        await addCalibration(c.get('athlete').id, c.req.valid('param').planId, c.req.valid('json')),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/plans/{planId}/draft/calibrations/{calibrationId}/use-again',
      tags: ['Brief'],
      request: { params: PlanParams.extend({ calibrationId: Id }), body: body(BriefCommand) },
      responses,
    }),
    async (c) =>
      c.json(
        await useCalibration(
          c.get('athlete').id,
          c.req.valid('param').planId,
          c.req.valid('json'),
          c.req.valid('param').calibrationId,
        ),
        200,
      ),
  );
}
