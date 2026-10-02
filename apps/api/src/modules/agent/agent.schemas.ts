import { z } from 'zod';
import { BriefSchema, PaceInputSchema } from '../plans/brief.schemas.js';
import { Id } from '../plans/plan.schemas.js';
export const PROMPT_VERSION = 'running-coach-v2';

export const RegisterSchema = z
  .object({
    id: Id,
    provider: z.literal('openai'),
    model: z.string().min(1).max(200),
    reasoning: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    promptVersion: z.literal(PROMPT_VERSION),
    ready: z.boolean(),
  })
  .strict();
export const ClaimSchema = z.object({ workerId: Id }).strict();
export const ToolRequestSchema = z
  .object({
    operationId: z.string().min(1).max(200),
    name: z.string().min(1).max(100),
    expectedVersionId: Id.nullable(),
    expectedEditNumber: z.number().int().positive().nullable(),
    input: z.unknown(),
  })
  .strict();
const date = z.iso.date();
const text = z.string().trim().min(1).max(4000);
const position = z.number().int().min(1).max(100000);
const ref = z.string().min(1).max(100);
const dated = z.object({
  key: ref,
  id: Id.optional(),
  title: text,
  description: z.string().max(20000).nullable(),
  startDate: date,
  endDate: date,
  position,
});
const completion = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('duration'),
      value: z.number().positive().max(86400),
      unit: z.literal('seconds'),
    })
    .strict(),
  z
    .object({
      type: z.literal('distance'),
      value: z.number().positive().max(200000),
      unit: z.literal('metres'),
    })
    .strict(),
  z.object({ type: z.literal('open') }).strict(),
]);
const target = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('zone'),
      key: z.enum(['easy', 'marathon', 'threshold', 'interval', 'repetition']),
    })
    .strict(),
  z
    .object({ type: z.literal('pace'), secondsPerKilometre: z.number().positive().max(3600) })
    .strict(),
  z.object({ type: z.literal('rpe'), value: z.number().min(1).max(10) }).strict(),
  z.object({ type: z.literal('instruction'), text }).strict(),
]);
export const StepSchema = z
  .object({
    parentIndex: z.number().int().nonnegative().nullable(),
    kind: z.enum(['sequence', 'repeat', 'effort']),
    repeatCount: z.number().int().min(1).max(1000).nullable(),
    role: z
      .enum(['warmup', 'work', 'recovery', 'cooldown', 'transition', 'main', 'other'])
      .nullable(),
    label: text.nullable(),
    instructions: z.string().max(4000).nullable(),
    completion: completion.nullable(),
    targets: z.array(target).max(5),
  })
  .strict();
export const WorkoutInputSchema = z
  .object({
    key: ref,
    id: Id.optional(),
    weekKey: ref,
    date,
    position,
    title: text,
    description: z.string().max(20000).nullable(),
    purpose: text.nullable(),
    priority: z.enum(['low', 'medium', 'high']),
    estimatedDurationSeconds: z.number().int().positive().max(86400).nullable(),
    estimatedDistanceMetres: z.number().positive().max(200000).nullable(),
    tags: z.array(z.string().trim().min(1).max(100)).max(20),
    steps: z.array(StepSchema).min(1).max(100),
  })
  .strict();
export const CoverageSchema = z.object({ startDate: date, endDate: date }).strict();
export const ScheduleSchema = z
  .object({
    blocks: z.array(dated.strict()).max(20),
    weeks: z.array(dated.extend({ blockKey: ref, weekNumber: position }).strict()).max(52),
    workouts: z.array(WorkoutInputSchema).max(100),
    deleteWorkoutIds: z.array(Id).max(100),
    deleteWeekIds: z.array(Id).max(52),
    deleteBlockIds: z.array(Id).max(20),
    generation: CoverageSchema.nullable(),
    coverage: CoverageSchema.nullable(),
  })
  .strict();
export const ReplaceSchema = ScheduleSchema.extend({ range: CoverageSchema }).strict();
export const ToolSchemas = {
  read_plan_context: z.object({}).strict(),
  read_schedule: z.object({ startDate: date.nullable(), endDate: date.nullable() }).strict(),
  create_plan_draft: z
    .object({
      displayName: z.string().trim().min(1).max(200),
      startDate: date.nullable(),
      endDate: date.nullable(),
    })
    .strict(),
  update_plan_brief: z
    .object({
      brief: BriefSchema,
      startDate: date.nullable(),
      endDate: date.nullable(),
      description: z.string().max(20000).nullable(),
    })
    .strict(),
  set_fitness_calibration: z
    .object({
      input: PaceInputSchema,
      provenance: z.enum(['user_supplied', 'user_estimate', 'agent_estimate']),
      estimateBasis: z.string().trim().min(1).max(4000),
    })
    .strict(),
  apply_schedule_changes: ScheduleSchema,
  replace_schedule_range: ReplaceSchema,
  validate_plan: z.object({}).strict(),
} as const;
export type ToolName = keyof typeof ToolSchemas;
const descriptions: Record<ToolName, string> = {
  read_plan_context:
    'Read current plan assumptions, dates, calibration and explicit prescribed coverage. Does not retarget a stale execution.',
  read_schedule:
    'Read blocks, weeks and complete running prescriptions in this plan. Dates can narrow workout results; null reads all.',
  create_plan_draft:
    'Create and bind one new plan to a standalone conversation only after the user expresses intent to create a plan. Never locks.',
  update_plan_brief:
    'Save current planning assumptions and dates. Missing facts stay unanswered; unknown means user says they do not know. Distances are metres. Weekdays Monday through Sunday.',
  set_fitness_calibration:
    'Calculate running pace zones from a race result or estimated threshold pace. Persist estimate provenance and reasoning. Never treat age alone as measured evidence.',
  apply_schedule_changes:
    'Atomically add/update/delete dated blocks, weeks and full workout trees. Set generation to the whole intended horizon on the first schedule batch of this run; subsequent batches may repeat it or use null. Local keys reference new parents; existing UUIDs may be parent keys. Steps are ordered, first root parentIndex null, later parentIndex points to an earlier container. Efforts need a completion and containers need children. Coverage asserts fully prescribed dates, including rest days; use null for unfinished chunks.',
  replace_schedule_range:
    'Atomically replace workouts only inside the explicit range, preserving all content outside it. Set generation to the whole intended horizon on the first schedule batch of this run; subsequent batches may repeat it or use null. Existing parents may be referenced by UUID. New blocks/weeks must fit inside the range. Never declare coverage for an unfinished chunk.',
  validate_plan:
    'Check draft structure and human review requirements; returns findings and current hashes. Does not confirm or lock.',
};
export function toolDefinitions() {
  return Object.entries(ToolSchemas).map(([name, schema]) => ({
    name,
    description: descriptions[name as ToolName],
    parameters: z.toJSONSchema(schema, { unrepresentable: 'any' }),
  }));
}
