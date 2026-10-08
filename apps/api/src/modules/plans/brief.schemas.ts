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
const Sessions = Answer.refine(
  (answer) => answer.value === null || Number.isInteger(answer.value),
  'Session count must be a whole number.',
);
const desiredSessions = z.number().int().min(1).max(14).nullable();
/** Running and swimming baselines are distances in metres. */
const DistanceBaseline = {
  currentSessions: Sessions,
  desiredSessions,
  weeklyDistance: Answer,
  longestDistance: Answer,
};
/** One sport's current training and desired frequency. Strength records sessions only. */
export const SportBaselineSchema = z
  .discriminatedUnion('sport', [
    z.object({ sport: z.literal('run'), ...DistanceBaseline }).strict(),
    z.object({ sport: z.literal('swim'), ...DistanceBaseline }).strict(),
    z
      .object({
        sport: z.literal('cycle'),
        currentSessions: Sessions,
        desiredSessions,
        /** Seconds. */
        weeklyDuration: Answer,
        /** Seconds. */
        longestDuration: Answer,
      })
      .strict(),
    z.object({ sport: z.literal('strength'), currentSessions: Sessions, desiredSessions }).strict(),
  ])
  .openapi('SportBaseline');
export type SportBaseline = z.infer<typeof SportBaselineSchema>;
export const BriefSchema = z
  .object({
    goal: z.string().trim().max(20000),
    unit: z.enum(['kilometres', 'miles']),
    /** Each sport the plan trains, at most once, in run, cycle, swim, strength order. */
    sports: z
      .array(SportBaselineSchema)
      .max(4)
      .refine(
        (sports) => new Set(sports.map((sport) => sport.sport)).size === sports.length,
        'List each sport once.',
      ),
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
const unanswered = { status: 'unanswered', value: null } as const;
/** A sport's baseline before any question is answered. */
export function emptySport(sport: SportBaseline['sport']): SportBaseline {
  const common = { currentSessions: unanswered, desiredSessions: null };
  if (sport === 'strength') return { sport, ...common };
  if (sport === 'cycle')
    return { sport, ...common, weeklyDuration: unanswered, longestDuration: unanswered };
  return { sport, ...common, weeklyDistance: unanswered, longestDistance: unanswered };
}
export const emptyBrief = (): Brief => ({
  goal: '',
  unit: 'kilometres',
  sports: [],
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
