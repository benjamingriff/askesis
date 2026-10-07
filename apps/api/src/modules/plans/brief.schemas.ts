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
export const ConfirmBriefSchema = BriefCommand.extend({
  expectedHash: z.string(),
  acknowledgedWarningCodes: z.array(z.string()),
}).strict();
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
});
export type BriefState = z.infer<typeof BriefStateSchema>;
export const emptyBrief = (): Brief => ({
  goal: '',
  unit: 'kilometres',
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
