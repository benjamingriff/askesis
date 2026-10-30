import type { Transaction } from 'kysely';
import type { z } from 'zod';
import { getDatabase } from '../../database/client.js';
import type { DB } from '../../database/generated.js';
import { localDate } from '../athletes/timezone.js';
import { assertAccountOpen, ChatError } from '../chat/chat.core.js';
import { performanceTool, readSchedule } from '../agent/agent.service.js';
import { writeSchedule } from '../agent/agent.schedule.js';
import { readBrief, recordDraftChange, saveBriefRows } from '../plans/brief.service.js';
import { createPlanRows, detail, PlanError, preview } from '../plans/plan.service.js';
import { readTrainingLog, saveLogRows } from '../training-log/training-log.service.js';
import { McpToolSchemas, type McpToolName } from './mcp.tools.js';

type Tx = Transaction<DB>;
type Input<Name extends McpToolName> = z.infer<(typeof McpToolSchemas)[Name]>;
/** Responses beyond this would flood a chat client's context; ask for a narrower read. */
const MAX_RESULT_CHARACTERS = 500000;

async function today(db: Tx, owner: string) {
  const athlete = await db
    .selectFrom('athletes')
    .select('timezone')
    .where('id', '=', owner)
    .executeTakeFirstOrThrow();
  return { today: localDate(athlete.timezone), timezone: athlete.timezone };
}
/** The plan's current version for reading: its draft when one exists, else its locked revision. */
async function current(db: Tx, owner: string, planId: string) {
  const plan = await detail(db, owner, planId);
  if (plan.archived) throw new PlanError('PLAN_ARCHIVED', 'This plan is archived.', 409);
  const version = plan.draft ?? plan.locked;
  if (!version) throw new PlanError('DRAFT_NOT_FOUND', 'This plan has no version.', 404);
  return { plan, version };
}
/**
 * Locks the plan, then its draft (the order human and coach writers use), and checks the agent
 * is building on the latest edit of the same draft: edit numbers restart in a new draft.
 */
async function draft(
  db: Tx,
  owner: string,
  input: { planId: string; expectedDraftId: string; expectedEditNumber: number },
) {
  await db
    .selectFrom('plans')
    .select('id')
    .where('id', '=', input.planId)
    .where('owner_id', '=', owner)
    .forUpdate()
    .executeTakeFirst();
  const { plan, version } = await current(db, owner, input.planId);
  if (version.state !== 'draft')
    throw new PlanError(
      'DRAFT_REQUIRED',
      'The plan is locked. Ask the athlete to unlock it in Askesis before editing.',
    );
  const row = await db
    .selectFrom('plan_versions')
    .select('edit_number')
    .where('id', '=', version.id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (version.id !== input.expectedDraftId || row.edit_number !== input.expectedEditNumber)
    throw new ChatError(
      'STALE_CONTEXT',
      `The current draft is ${version.id} at edit ${row.edit_number}. Read it again before changing it.`,
    );
  return { plan, versionId: version.id };
}
/** What the next write must name: the draft and its edit after this one. */
async function nextEdit(db: Tx, versionId: string) {
  const row = await db
    .selectFrom('plan_versions')
    .select('edit_number')
    .where('id', '=', versionId)
    .executeTakeFirstOrThrow();
  return { draftId: versionId, editNumber: row.edit_number };
}

async function run(db: Tx, owner: string, name: McpToolName, raw: unknown): Promise<unknown> {
  switch (name) {
    case 'list_plans': {
      const plans = await db
        .selectFrom('plans')
        .select('id')
        .where('owner_id', '=', owner)
        .where('archived_at', 'is', null)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute();
      return {
        ...(await today(db, owner)),
        plans: await Promise.all(plans.map((p) => detail(db, owner, p.id))),
      };
    }
    case 'read_plan_context': {
      const input = raw as Input<'read_plan_context'>;
      const { plan, version } = await current(db, owner, input.planId);
      return {
        ...(await today(db, owner)),
        plan,
        draftId: plan.draft?.id ?? null,
        editNumber: plan.draft?.editNumber ?? null,
        brief: await readBrief(db, version.id, version.state === 'locked'),
      };
    }
    case 'read_schedule': {
      const { planId, ...range } = raw as Input<'read_schedule'>;
      const { version } = await current(db, owner, planId);
      return readSchedule(db, version.id, range);
    }
    case 'create_plan_draft': {
      const input = raw as Input<'create_plan_draft'>;
      if (input.startDate && input.endDate && input.endDate < input.startDate)
        throw new PlanError('INVALID_PLAN_RANGE', 'End date precedes start date.', 422);
      const created = await createPlanRows(db, owner, input.displayName, {
        ...(input.startDate ? { startDate: input.startDate } : {}),
        ...(input.endDate ? { endDate: input.endDate } : {}),
      });
      return {
        plan: await detail(db, owner, created.planId),
        draftId: created.draftId,
        editNumber: 1,
      };
    }
    case 'update_plan_brief': {
      const input = raw as Input<'update_plan_brief'>;
      if (input.startDate && input.endDate && input.endDate < input.startDate)
        throw new PlanError('INVALID_PLAN_RANGE', 'End date precedes start date.', 422);
      const { plan, versionId } = await draft(db, owner, input);
      const state = await readBrief(db, versionId);
      if (
        state.startDate !== input.startDate ||
        state.endDate !== input.endDate ||
        plan.draft?.description !== input.description
      ) {
        await db
          .updateTable('plan_versions')
          .set({
            start_date: input.startDate,
            end_date: input.endDate,
            description: input.description,
          })
          .where('id', '=', versionId)
          .execute();
        await recordDraftChange(
          db,
          versionId,
          state.startDate !== input.startDate || state.endDate !== input.endDate
            ? 'invalidate-confirmation-and-review-schedule'
            : 'edit-only',
        );
      }
      await saveBriefRows(db, await readBrief(db, versionId), input.brief);
      return { brief: await readBrief(db, versionId), ...(await nextEdit(db, versionId)) };
    }
    case 'apply_schedule_changes':
    case 'replace_schedule_range': {
      const { planId, expectedDraftId, expectedEditNumber, ...schedule } =
        raw as Input<'replace_schedule_range'>;
      const { versionId } = await draft(db, owner, { planId, expectedDraftId, expectedEditNumber });
      const result = await writeSchedule(
        db,
        versionId,
        { ...schedule, generation: null },
        null,
        name === 'replace_schedule_range' ? schedule.range : undefined,
      );
      return { ...result, ...(await nextEdit(db, versionId)) };
    }
    case 'validate_plan': {
      const { plan } = await current(db, owner, (raw as Input<'validate_plan'>).planId);
      return plan.draft
        ? {
            ...(await preview(db, plan)),
            draftId: plan.draft.id,
            editNumber: plan.draft.editNumber,
          }
        : { readOnly: true };
    }
    case 'read_training_log':
      return readTrainingLog(db, owner, raw as Input<'read_training_log'>);
    case 'record_workout_log': {
      const input = raw as Input<'record_workout_log'>;
      return saveLogRows(db, owner, input.planId, input.lineageId, input.log);
    }
    case 'read_performance':
    case 'preview_performance':
    case 'record_performance':
    case 'retract_performance':
      return performanceTool(db, owner, null, name, raw);
  }
}

/**
 * Executes one tool for the signed-in athlete in a single transaction. The SDK has already
 * validated the input against McpToolSchemas; domain services repeat their own checks.
 */
export async function callMcpTool(owner: string, name: McpToolName, input: unknown) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      // Share-locks the athlete like a coaching run, so a deletion request cannot slip past a write.
      await assertAccountOpen(db, owner);
      const text = JSON.stringify(await run(db, owner, name, McpToolSchemas[name].parse(input)));
      // Refuse before commit: a refused write rolls back instead of saving behind an error.
      if (text.length > MAX_RESULT_CHARACTERS)
        throw new ChatError(
          'CONTEXT_TOO_LARGE',
          'Narrow the schedule date range before reading.',
          400,
        );
      return text;
    })
    .catch((error: unknown) => {
      if (
        (name === 'apply_schedule_changes' || name === 'replace_schedule_range') &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        /^23[0-9A-Z]{3}$/.test(String(error.code))
      )
        throw new PlanError(
          'SCHEDULE_INVALID',
          'The batch violates a content constraint. Review dates, positions, parent references and prescription structure.',
          422,
        );
      throw error;
    });
}
