import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnvironment } from '../../auth/types.js';
import { ErrorSchema } from '../workouts/workout.schemas.js';
import { Id } from '../plans/plan.common.js';
import {
  CalibrationPreviewResultSchema,
  PerformanceStateSchema,
  PreviewCalibrationSchema,
  RecordCalibrationSchema,
  RetractCalibrationSchema,
} from './performance.schemas.js';
import {
  getPerformance,
  previewCalibrationFor,
  recordCalibration,
  retractCalibration,
} from './performance.service.js';

const rejected = Object.fromEntries(
  [400, 401, 404, 409, 422].map((status) => [
    status,
    { description: 'Request rejected.', content: { 'application/json': { schema: ErrorSchema } } },
  ]),
);
const state = {
  200: {
    description: 'The athlete’s calibration timeline and the entries in effect today.',
    content: { 'application/json': { schema: PerformanceStateSchema } },
  },
  ...rejected,
};
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});

export function registerPerformanceRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/v1/performance',
      tags: ['Performance'],
      responses: state,
    }),
    async (c) => c.json(await getPerformance(c.get('athlete').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/performance/calibrations',
      tags: ['Performance'],
      description:
        'Record a race result, power test or swim test. Zones change from today in the athlete’s timezone for every plan; earlier days keep theirs.',
      request: { body: body(RecordCalibrationSchema) },
      responses: state,
    }),
    async (c) => c.json(await recordCalibration(c.get('athlete').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/performance/calibrations/preview',
      tags: ['Performance'],
      description: 'Calculate zones for an input without recording it.',
      request: { body: body(PreviewCalibrationSchema) },
      responses: {
        200: {
          description: 'Calculated zones beside the entry in effect today.',
          content: { 'application/json': { schema: CalibrationPreviewResultSchema } },
        },
        ...rejected,
      },
    }),
    async (c) => c.json(await previewCalibrationFor(c.get('athlete').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/performance/calibrations/{calibrationId}/retract',
      tags: ['Performance'],
      description: 'Withdraw a mistaken entry. The previous entry applies again.',
      request: {
        params: z.object({ calibrationId: Id }),
        body: body(RetractCalibrationSchema),
      },
      responses: state,
    }),
    async (c) =>
      c.json(
        await retractCalibration(
          c.get('athlete').id,
          c.req.valid('param').calibrationId,
          c.req.valid('json').idempotencyKey,
        ),
        200,
      ),
  );
}
