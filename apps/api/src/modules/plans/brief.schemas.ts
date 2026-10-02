import { z } from '@hono/zod-openapi';
import { Id, FindingSchema } from './plan.common.js';
import { GenerationSchema } from './schedule-generation.js';

const Answer = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unanswered'), value: z.null() }).strict(),
  z.object({ status: z.literal('unknown'), value: z.null() }).strict(),
  z
    .object({ status: z.literal('known'), value: z.number().finite().nonnegative().max(1000000) })
    .strict(),
]);
export const BriefSchema = z
  .object({
    goal: z.string().trim().max(20000),
    unit: z.enum(['kilometres', 'miles']),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid timezone.'),
    weeklyDistance: Answer,
    currentRuns: Answer.refine(
      (answer) => answer.value === null || Number.isInteger(answer.value),
      'Run count must be a whole number.',
    ),
    longestRun: Answer,
    desiredRuns: z.number().int().min(1).max(14).nullable(),
    weekdays: z.array(z.enum(['available', 'preferred', 'unavailable'])).length(7),
    context: z.string().trim().max(20000),
  })
  .strict();
export type Brief = z.infer<typeof BriefSchema>;
export const BriefCommand = z.object({
  expectedDraftId: Id,
  expectedEditNumber: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export const SaveBriefSchema = BriefCommand.extend({ brief: BriefSchema }).strict();
export const PaceInputSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('race_result'),
      distanceMetres: z.number().min(1609.344).max(42195),
      durationSeconds: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ method: z.literal('threshold_pace'), secondsPerKilometre: z.number().positive() })
    .strict(),
]);
export const CalibrationCommand = BriefCommand.extend({
  input: PaceInputSchema,
  provenance: z.enum(['user_supplied', 'user_estimate', 'agent_estimate']).optional(),
  estimateBasis: z.string().trim().min(1).max(4000).optional(),
}).strict();
export const ConfirmBriefSchema = BriefCommand.extend({
  expectedHash: z.string(),
  acknowledgedWarningCodes: z.array(z.string()),
}).strict();
export const CalibrationSchema = z.object({
  id: Id,
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable(),
  method: z.enum(['race_result', 'threshold_pace']),
  distanceMetres: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  secondsPerKilometre: z.number().nullable(),
  calculatorVersion: z.string(),
  provenance: z.enum(['user_supplied', 'user_estimate', 'agent_estimate']),
  estimateBasis: z.string().nullable(),
  zones: z.array(
    z.object({ key: z.string(), fast: z.number(), target: z.number(), slow: z.number() }),
  ),
});
export const BriefStateSchema = z.object({
  versionId: Id,
  editNumber: z.number(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  readOnly: z.boolean(),
  brief: BriefSchema,
  confirmed: z.boolean(),
  hash: z.string(),
  scheduleReviewRequired: z.boolean(),
  findings: z.array(FindingSchema),
  coverage: z.array(z.object({ startDate: z.string(), endDate: z.string(), current: z.boolean() })),
  generations: z.array(GenerationSchema).optional(),
  calibrations: z.array(CalibrationSchema),
});
export type BriefState = z.infer<typeof BriefStateSchema>;
export const emptyBrief = (): Brief => ({
  goal: '',
  unit: 'kilometres',
  timezone: 'UTC',
  weeklyDistance: { status: 'unanswered', value: null },
  currentRuns: { status: 'unanswered', value: null },
  longestRun: { status: 'unanswered', value: null },
  desiredRuns: null,
  weekdays: [
    'available',
    'available',
    'available',
    'available',
    'available',
    'available',
    'available',
  ],
  context: '',
});
