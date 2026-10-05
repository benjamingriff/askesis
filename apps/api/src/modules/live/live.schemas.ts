import { z } from '@hono/zod-openapi';
import { Id } from '../plans/plan.schemas.js';

export const OutputItemSchema = z.object({
  itemId: z.string(),
  position: z.number().int(),
  content: z.string(),
  revision: z.number().int(),
  isFinal: z.boolean(),
  truncated: z.boolean(),
});
export const OutputSchema = z.object({
  runId: Id,
  status: z.string(),
  finalMessageId: Id.nullable(),
  items: z.array(OutputItemSchema),
  timings: z.record(z.string(), z.unknown()),
});
export const WorkoutChangeSchema = z.object({
  lineageId: Id,
  workoutId: Id.nullable(),
  title: z.string(),
  date: z.string(),
  previousDate: z.string().nullable(),
  change: z.enum(['added', 'changed', 'moved', 'removed']),
  prescriptionChanged: z.boolean(),
});
export const ChangeSummarySchema = z.object({
  workouts: z.array(WorkoutChangeSchema),
  assumptionsChanged: z.boolean(),
  paceGuidesChanged: z.boolean(),
  datesChanged: z.boolean(),
  counts: z
    .object({
      added: z.number().int(),
      changed: z.number().int(),
      moved: z.number().int(),
      removed: z.number().int(),
    })
    .optional(),
  omittedWorkouts: z.number().int().nonnegative().optional(),
});
export const DraftChangesSchema = ChangeSummarySchema.extend({
  versionId: Id,
  editNumber: z.number().int(),
  baselineId: Id.nullable(),
});
export const RunChangesSchema = z.object({
  summaries: z.array(ChangeSummarySchema),
  legacy: z.boolean(),
});
export const ProgressSchema = z
  .object({
    sequence: z.number().int().min(1).max(4000),
    items: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(200),
            position: z.number().int().min(0).max(100),
            content: z.string().max(32000),
            revision: z.number().int().positive(),
            truncated: z.boolean().default(false),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    activity: z
      .object({
        operationId: z.string().min(1).max(200),
        name: z.string().min(1).max(100),
        state: z.enum(['started', 'failed']),
      })
      .strict()
      .optional(),
    timings: z
      .record(
        z.string().max(100),
        z.union([
          z.number().finite().nonnegative().max(1e12),
          z.array(z.number().finite().nonnegative().max(1e12)).max(200),
        ]),
      )
      .optional(),
  })
  .strict();
export type Progress = z.infer<typeof ProgressSchema>;
export type ChangeSummary = z.infer<typeof ChangeSummarySchema>;
