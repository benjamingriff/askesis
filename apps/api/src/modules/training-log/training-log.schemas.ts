import { z } from '@hono/zod-openapi';
import { Id } from '../plans/plan.common.js';
import { SESSION_TYPES } from '../workouts/session-types.js';
import { CalibrationInputSchema } from '../performance/performance.schemas.js';
export const REASONS = [
  'poor_sleep',
  'heavy_legs',
  'under_fuelled',
  'ill',
  'pain',
  'heat',
  'terrain',
  'stress',
  'time',
  'equipment',
  'other',
] as const;
export const AnswersSchema = z
  .object({
    intervals: z.enum(['on_target', 'faded', 'missed', 'stopped']).optional(),
    finish: z.enum(['strong', 'faded', 'struggled']).optional(),
    fuelled: z.enum(['yes', 'some', 'no']).optional(),
    weights: z.enum(['light', 'right', 'heavy']).optional(),
    weightsUsed: z.string().max(1000).optional(),
    hardestPart: z
      .enum(['run', 'cycle', 'swim', 'strength', 'row', 'ski_erg', 'transitions'])
      .optional(),
    painArea: z
      .enum(['foot', 'ankle', 'calf', 'knee', 'hip', 'back', 'shoulder', 'other'])
      .optional(),
    painSeverity: z.enum(['mild', 'changed_movement', 'stopped']).optional(),
    race: z.enum(['to_plan', 'faded', 'better']).optional(),
    result: CalibrationInputSchema.optional(),
  })
  .strict();
export const LogInputSchema = z
  .object({
    status: z.enum(['done', 'changed', 'skipped']),
    performedOn: z.iso.date().optional(),
    actualDurationSeconds: z.number().int().min(1).max(604800).nullable().optional(),
    actualDistanceMetres: z.number().positive().max(1000000).nullable().optional(),
    rpe: z.number().int().min(1).max(10).nullable().optional(),
    feel: z.number().int().min(1).max(5).nullable().optional(),
    reasons: z.array(z.enum(REASONS)).max(REASONS.length).optional(),
    answers: AnswersSchema.optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.status === 'skipped' &&
      (v.actualDurationSeconds != null || v.actualDistanceMetres != null || v.rpe != null)
    )
      c.addIssue({ code: 'custom', message: 'Skipped sessions cannot have actuals or effort.' });
  });
export const LogSchema = z
  .object({
    id: Id,
    planId: Id,
    lineageId: Id,
    loggedVersionId: Id,
    scheduledOn: z.iso.date(),
    title: z.string(),
    discipline: z.string(),
    sessionType: z.enum(SESSION_TYPES).nullable(),
    keySession: z.boolean(),
    plannedDurationSeconds: z.number().nullable(),
    plannedDistanceMetres: z.number().nullable(),
    plannedRpe: z.number().nullable(),
    status: z.enum(['done', 'changed', 'skipped']),
    performedOn: z.iso.date(),
    actualDurationSeconds: z.number().nullable(),
    actualDistanceMetres: z.number().nullable(),
    rpe: z.number().nullable(),
    feel: z.number().nullable(),
    reasons: z.array(z.enum(REASONS)),
    answers: AnswersSchema,
    answersSchemaVersion: z.number(),
    note: z.string().nullable(),
    source: z.enum(['manual', 'coach']),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkoutLog');
export const CheckInInputSchema = z
  .object({
    planId: Id,
    kind: z.enum(['ill', 'pain', 'run_down', 'busy']),
    startsOn: z.iso.date(),
    endsOn: z.iso.date().nullable(),
    details: z
      .object({
        symptoms: z.enum(['above_neck', 'below_neck', 'fever', 'chest_pain']).optional(),
        painArea: AnswersSchema.shape.painArea,
        painSeverity: AnswersSchema.shape.painSeverity,
        preference: z.enum(['easy', 'shorter', 'rest', 'coach']),
        returnStyle: z.enum(['gently', 'balanced', 'quickly']),
        note: z.string().trim().max(2000).optional(),
      })
      .strict(),
  })
  .strict()
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, 'End date cannot precede start date.');
export const CheckInSchema = CheckInInputSchema.safeExtend({
  id: Id,
  createdAt: z.string(),
}).openapi('AthleteCheckIn');
export const ReferenceInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workout_log'), logId: Id }).strict(),
  z.object({ type: z.literal('check_in'), checkInId: Id }).strict(),
]);
export const ReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workout_log'), logId: Id, snapshot: LogSchema }),
  z.object({ type: z.literal('check_in'), checkInId: Id, snapshot: CheckInSchema }),
]);
export const SummarySchema = z
  .object({
    due: z.number(),
    done: z.number(),
    changed: z.number(),
    skipped: z.number(),
    unlogged: z.number(),
    bySport: z.array(
      z.object({
        discipline: z.string(),
        plannedSeconds: z.number(),
        actualSeconds: z.number(),
        plannedMetres: z.number(),
        actualMetres: z.number(),
      }),
    ),
    load: z.number().nullable(),
    unknownLoadSessions: z.number(),
    harderKeySessions: z.number(),
    easierKeySessions: z.number(),
    recentKeySessions: z.number(),
    tiredSessions: z.number(),
    easyHighEffortSessions: z.number(),
  })
  .openapi('TrainingLogSummary');
export const TrainingLogSchema = z
  .object({
    today: z.iso.date(),
    logs: z.array(LogSchema),
    checkIns: z.array(CheckInSchema),
    summary: SummarySchema,
  })
  .openapi('TrainingLog');
export type WorkoutLog = z.infer<typeof LogSchema>;
export type LogInput = z.infer<typeof LogInputSchema>;
export type CheckInInput = z.infer<typeof CheckInInputSchema>;
export type ReferenceInput = z.infer<typeof ReferenceInputSchema>;
export type FeedbackReference = z.infer<typeof ReferenceSchema>;
