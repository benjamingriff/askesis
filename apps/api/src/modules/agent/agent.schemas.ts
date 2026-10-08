import { z } from 'zod';
import { BriefSchema } from '../plans/brief.schemas.js';
import { Id } from '../plans/plan.schemas.js';
import { STEP_DISCIPLINES, WORKOUT_DISCIPLINES } from '../plans/disciplines.js';
import { BLOCK_PHASES, RACE_PRIORITIES } from '../plans/periodization.js';
import { ZONE_KEYS } from '../performance/run-pace.calculator.js';
import { POWER_ZONE_KEYS } from '../performance/cycle-power.calculator.js';
import { SWIM_ZONE_KEYS } from '../performance/swim-pace.calculator.js';
import {
  PaceInputSchema,
  PerformanceSystemSchema,
  PowerInputSchema,
  ProvenanceSchema,
  SwimInputSchema,
} from '../performance/performance.schemas.js';
export const PROMPT_VERSION = 'multisport-coach-v3';

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
  z
    .object({
      type: z.literal('repetitions'),
      value: z.number().int().positive().max(1000),
      unit: z.literal('repetitions'),
    })
    .strict(),
  z.object({ type: z.literal('open') }).strict(),
]);
/** Zone keys across systems; the step's sport chooses the system and its valid keys. */
const zoneKey = z.enum([...new Set([...ZONE_KEYS, ...POWER_ZONE_KEYS, ...SWIM_ZONE_KEYS])] as [
  string,
  ...string[],
]);
const target = z.discriminatedUnion('type', [
  z.object({ type: z.literal('zone'), key: zoneKey }).strict(),
  z
    .object({ type: z.literal('pace'), secondsPerKilometre: z.number().positive().max(3600) })
    .strict(),
  z
    .object({ type: z.literal('swim_pace'), secondsPer100Metres: z.number().positive().max(600) })
    .strict(),
  z.object({ type: z.literal('power'), watts: z.number().positive().max(2500) }).strict(),
  z.object({ type: z.literal('rpe'), value: z.number().min(1).max(10) }).strict(),
  z.object({ type: z.literal('rir'), value: z.number().int().min(0).max(10) }).strict(),
  z.object({ type: z.literal('load'), kilograms: z.number().positive().max(500) }).strict(),
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
    /** An effort's sport; null inherits the workout's. Containers use null. */
    discipline: z.enum(STEP_DISCIPLINES).nullable().optional(),
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
    discipline: z.enum(WORKOUT_DISCIPLINES),
    title: text,
    description: z.string().max(20000).nullable(),
    purpose: text.nullable(),
    priority: z.enum(['low', 'medium', 'high']),
    /** Races only: A goal race, B tune-up, C raced as training. Null for other workouts. */
    racePriority: z.enum(RACE_PRIORITIES).nullable(),
    estimatedDurationSeconds: z.number().int().positive().max(86400).nullable(),
    estimatedDistanceMetres: z.number().positive().max(300000).nullable(),
    tags: z.array(z.string().trim().min(1).max(100)).max(20),
    steps: z.array(StepSchema).min(1).max(100),
  })
  .strict();
export const CoverageSchema = z.object({ startDate: date, endDate: date }).strict();
export const ScheduleSchema = z
  .object({
    blocks: z.array(dated.extend({ phase: z.enum(BLOCK_PHASES) }).strict()).max(20),
    weeks: z
      .array(dated.extend({ blockKey: ref, weekNumber: position, cutback: z.boolean() }).strict())
      .max(52),
    workouts: z.array(WorkoutInputSchema).max(100),
    deleteWorkoutIds: z.array(Id).max(100),
    deleteWeekIds: z.array(Id).max(52),
    deleteBlockIds: z.array(Id).max(20),
    generation: CoverageSchema.nullable(),
    coverage: CoverageSchema.nullable(),
  })
  .strict();
export const ReplaceSchema = ScheduleSchema.extend({ range: CoverageSchema }).strict();
/** Each system's input; the service checks that the input matches its system. */
const performanceInput = z.union([PaceInputSchema, PowerInputSchema, SwimInputSchema]);
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
  read_performance: z.object({}).strict(),
  preview_performance: z
    .object({ system: PerformanceSystemSchema, input: performanceInput })
    .strict(),
  record_performance: z
    .object({
      system: PerformanceSystemSchema,
      input: performanceInput,
      provenance: ProvenanceSchema,
      estimateBasis: z.string().trim().min(1).max(4000),
      observedOn: date.nullable(),
    })
    .strict(),
  retract_performance: z.object({ calibrationId: Id }).strict(),
  apply_schedule_changes: ScheduleSchema,
  replace_schedule_range: ReplaceSchema,
  validate_plan: z.object({}).strict(),
} as const;
export type ToolName = keyof typeof ToolSchemas;
const descriptions: Record<ToolName, string> = {
  read_plan_context:
    'Read current plan assumptions, dates, calibration and explicit prescribed coverage. Does not retarget a stale execution.',
  read_schedule:
    'Read blocks, weeks and complete workout prescriptions in this plan. Dates can narrow workout results; null reads all.',
  create_plan_draft:
    'Create and bind one new plan to a standalone conversation only after the user expresses intent to create a plan. Never locks.',
  update_plan_brief:
    'Save current planning assumptions and dates. List each sport the plan trains once in sports, with its baseline: run and swim volumes are metres, cycle volumes are seconds, strength records sessions only. Missing facts stay unanswered; unknown means user says they do not know. Weekdays Monday through Sunday.',
  read_performance:
    "Read the athlete's calibration timeline: the entry in effect today for each system and recent history. Works with or without a plan.",
  preview_performance:
    'Calculate the zones an input would produce, beside the current entry, without saving anything. Use it to compare a reported result with current fitness.',
  record_performance:
    "Record a result or estimate on the athlete's timeline: run_pace takes a race result or threshold pace, cycle_power an FTP, 20-minute test or ramp test, swim_pace a 400/200 CSS test or CSS pace per 100 m. Zones change from today for every plan; earlier days keep theirs. observedOn is the race or test date (null if unknown). Describe the evidence in estimateBasis. Never treat age alone as measured evidence.",
  retract_performance:
    'Withdraw a mistaken entry the user asks to undo; the previous entry applies again. Never retract to hide an inconvenient result.',
  apply_schedule_changes:
    'Atomically add/update/delete dated blocks, weeks and full workout trees. Every block names its training phase (base, build, peak, taper or recovery); phases may repeat. Mark deliberately lighter weeks cutback. Give each race a racePriority (A goal race, B tune-up, C raced as training); other workouts use null. Set generation to the whole intended horizon on the first schedule batch of this run; subsequent batches may repeat it or use null. Local keys reference new parents; existing UUIDs may be parent keys. Steps are ordered, first root parentIndex null, later parentIndex points to an earlier container. Efforts need a completion and containers need children. Every workout names its discipline; each effort inherits it or names its own (required in mixed workouts). Give every run, ride and swim effort a zone target for its sport; pace, swim_pace and power targets only refine it. Strength efforts use reps with rir or rpe and an optional suggested load in kilograms; ergs use rpe. Coverage asserts fully prescribed dates, including rest days; use null for unfinished chunks.',
  replace_schedule_range:
    'Atomically replace workouts only inside the explicit range, preserving all content outside it. Set generation to the whole intended horizon on the first schedule batch of this run; subsequent batches may repeat it or use null. Existing parents may be referenced by UUID. New blocks/weeks must fit inside the range; each new block names its phase and each new week whether it is a cutback. Races carry a racePriority. Every workout names its discipline; mixed workouts name each effort’s. Give every run, ride and swim effort a zone target for its sport. Never declare coverage for an unfinished chunk.',
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
