import { z } from 'zod';
import { Id } from '../plans/plan.schemas.js';
import {
  ReplaceSchema,
  ScheduleSchema,
  TOOL_DESCRIPTIONS,
  ToolSchemas,
} from '../agent/agent.schemas.js';

/**
 * The coach's tools for an athlete's own agent. A run binds the coach to one plan and tracks a
 * generation horizon; here every plan tool names its plan and every plan write names the draft
 * edit it builds on, so a stale agent cannot overwrite the athlete's or the coach's changes.
 */
const plan = { planId: Id };
const write = {
  planId: Id,
  /** The draft's current editNumber, from list_plans, read_plan_context or the previous write. */
  expectedEditNumber: z.number().int().positive(),
};
export const McpToolSchemas = {
  list_plans: z.object({}).strict(),
  read_plan_context: z.object(plan).strict(),
  read_schedule: ToolSchemas.read_schedule.extend(plan).strict(),
  create_plan_draft: ToolSchemas.create_plan_draft,
  update_plan_brief: ToolSchemas.update_plan_brief.extend(write).strict(),
  apply_schedule_changes: ScheduleSchema.omit({ generation: true }).extend(write).strict(),
  replace_schedule_range: ReplaceSchema.omit({ generation: true }).extend(write).strict(),
  validate_plan: z.object(plan).strict(),
  read_training_log: ToolSchemas.read_training_log,
  record_workout_log: ToolSchemas.record_workout_log,
  read_performance: ToolSchemas.read_performance,
  preview_performance: ToolSchemas.preview_performance,
  record_performance: ToolSchemas.record_performance,
  retract_performance: ToolSchemas.retract_performance,
} as const;
export type McpToolName = keyof typeof McpToolSchemas;
export const MCP_PLAN_WRITES: McpToolName[] = [
  'update_plan_brief',
  'apply_schedule_changes',
  'replace_schedule_range',
];

const editing =
  ' Pass the draft’s current editNumber as expectedEditNumber; the result returns the new editNumber for the next write. STALE_CONTEXT means someone else changed the draft: read it again before retrying.';
/** The coach has no explicit horizon to declare here; coverage alone records finished chunks. */
const withoutGeneration = (text: string) =>
  text.replace(/Set generation to the whole intended horizon[^.]*\. /, '');

export const MCP_TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  list_plans:
    'List the athlete’s unarchived plans with their draft and locked versions, editNumbers and dates, plus today’s date in the athlete’s timezone. Start here to find a planId.',
  read_plan_context:
    'Read one plan’s assumptions (brief), dates, version state and editNumber, plus today’s date in the athlete’s timezone.',
  read_schedule:
    TOOL_DESCRIPTIONS.read_schedule +
    ' Narrow the dates for long plans; very large reads are refused.',
  create_plan_draft:
    'Create one new plan draft for the athlete after they clearly ask for a new plan. Returns its planId and editNumber. Never locks.',
  update_plan_brief: TOOL_DESCRIPTIONS.update_plan_brief + editing,
  apply_schedule_changes: withoutGeneration(TOOL_DESCRIPTIONS.apply_schedule_changes) + editing,
  replace_schedule_range: withoutGeneration(TOOL_DESCRIPTIONS.replace_schedule_range) + editing,
  validate_plan: TOOL_DESCRIPTIONS.validate_plan,
  read_training_log: TOOL_DESCRIPTIONS.read_training_log,
  record_workout_log: TOOL_DESCRIPTIONS.record_workout_log,
  read_performance: TOOL_DESCRIPTIONS.read_performance,
  preview_performance: TOOL_DESCRIPTIONS.preview_performance,
  record_performance: TOOL_DESCRIPTIONS.record_performance,
  retract_performance: TOOL_DESCRIPTIONS.retract_performance,
};
