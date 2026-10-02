import { createHash, randomBytes } from 'node:crypto';
import { sql, type Selectable, type Transaction } from 'kysely';
import type { z } from 'zod';
import { getDatabase } from '../../database/client.js';
import { getApiConfig } from '../../config.js';
import type { DB, Json } from '../../database/generated.js';
import { ChatError, activeStatuses } from '../chat/chat.core.js';
import {
  appendEvent,
  appendMessage,
  contextFor,
  ownedConversation,
  ownedRun,
  targetMatches,
  transition,
} from '../chat/chat.service.js';
import { ContextSchema } from '../chat/chat.schemas.js';
import { contentHash, type SemanticValue } from '../plans/plan.canonical.js';
import { addCalibrationRows, changed, readBrief, saveBriefRows } from '../plans/brief.service.js';
import { createPlanRows, detail, PlanError, preview } from '../plans/plan.service.js';
import {
  ToolSchemas,
  toolDefinitions,
  type RegisterSchema,
  type ToolRequestSchema,
  type ToolName,
} from './agent.schemas.js';
import { writeSchedule } from './agent.schedule.js';

type Tx = Transaction<DB>;
type Run = Selectable<DB['agent_runs']>;
export const LEASE_MS = 90000;
export const READY_MS = 60000;
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const rejected = () => new ChatError('LEASE_LOST', 'This execution is no longer authorized.', 409);
export async function workerReady() {
  if (getApiConfig().CHAT_EXECUTION_MODE !== 'agent') return false;
  return !!(await getDatabase()
    .selectFrom('agent_workers')
    .select('id')
    .where('ready', '=', true)
    .where('last_seen_at', '>', new Date(Date.now() - READY_MS))
    .executeTakeFirst());
}
export async function registerWorker(input: z.infer<typeof RegisterSchema>) {
  await getDatabase()
    .insertInto('agent_workers')
    .values({
      id: input.id,
      provider: input.provider,
      model: input.model,
      reasoning: input.reasoning,
      prompt_version: input.promptVersion,
      ready: input.ready,
      last_seen_at: new Date(),
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({
        provider: input.provider,
        model: input.model,
        reasoning: input.reasoning,
        prompt_version: input.promptVersion,
        ready: input.ready,
        last_seen_at: new Date(),
      }),
    )
    .execute();
  return { registered: true };
}
export async function claimRun(workerId: string) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const worker = await db
        .selectFrom('agent_workers')
        .selectAll()
        .where('id', '=', workerId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !worker ||
        !worker.ready ||
        new Date(worker.last_seen_at).getTime() < Date.now() - READY_MS
      )
        throw new ChatError('WORKER_NOT_READY', 'Register a ready worker before claiming.', 503);
      if (
        await db
          .selectFrom('agent_runs')
          .select('id')
          .where('worker_id', '=', workerId)
          .where('status', 'in', ['running', 'cancelling'])
          .executeTakeFirst()
      )
        return { claim: null };
      const candidates = await db
        .selectFrom('agent_runs')
        .select(['id', 'owner_id'])
        .where('status', '=', 'queued')
        .orderBy('created_at')
        .limit(20)
        .execute();
      for (const candidate of candidates) {
        const run = await ownedRun(db, candidate.owner_id, candidate.id, true);
        if (run.status !== 'queued') continue;
        if (Date.now() >= new Date(run.deadline_at).getTime()) {
          await transition(db, run, 'failed', 'failed', 'EXECUTION_TIMEOUT');
          continue;
        }
        const conversation = await ownedConversation(db, run.owner_id, run.conversation_id);
        const context = await contextFor(db, conversation);
        try {
          targetMatches(context, ContextSchema.nullable().parse(run.context));
        } catch {
          await transition(db, run, 'failed', 'failed', 'STALE_CONTEXT');
          continue;
        }
        if (conversation.archived_at) {
          await transition(db, run, 'failed', 'failed', 'CONVERSATION_ARCHIVED');
          continue;
        }
        const token = randomBytes(32).toString('base64url');
        const generation = run.lease_generation + 1;
        const expires = new Date(
          Math.min(Date.now() + LEASE_MS, new Date(run.deadline_at).getTime()),
        );
        await db
          .updateTable('agent_runs')
          .set({
            worker_id: workerId,
            lease_generation: generation,
            lease_expires_at: expires,
            credential_digest: digest(token),
            execution_plan_id: run.plan_id,
            execution_version_id: context?.versionId ?? null,
            execution_edit_number: context?.editNumber ?? null,
            provider: worker.provider,
            model: worker.model,
            reasoning: worker.reasoning,
            prompt_version: worker.prompt_version,
          })
          .where('id', '=', run.id)
          .execute();
        await transition(db, run, 'running', 'started');
        return {
          claim: {
            runId: run.id,
            token,
            generation,
            deadlineAt: new Date(run.deadline_at).toISOString(),
            versionId: context?.versionId ?? null,
            editNumber: context?.editNumber ?? null,
          },
        };
      }
      return { claim: null };
    });
}
async function authorized(db: Tx, id: string, token: string, allowCancelling = false) {
  const hint = await db
    .selectFrom('agent_runs')
    .select(['owner_id', 'credential_digest'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!hint || hint.credential_digest !== digest(token)) throw rejected();
  const run = await ownedRun(db, hint.owner_id, id, true);
  if (
    run.credential_digest !== digest(token) ||
    !run.lease_expires_at ||
    Date.now() >= new Date(run.lease_expires_at).getTime() ||
    Date.now() >= new Date(run.deadline_at).getTime() ||
    !(run.status === 'running' || (allowCancelling && run.status === 'cancelling'))
  )
    throw rejected();
  return run;
}
async function target(db: Tx, run: Run, write = false) {
  const conversation = await ownedConversation(db, run.owner_id, run.conversation_id);
  if (conversation.archived_at) throw rejected();
  if (!run.execution_plan_id) {
    if (conversation.plan_id) throw rejected();
    if (write) throw new PlanError('PLAN_REQUIRED', 'Create a plan draft first.');
    return null;
  }
  const plan = await detail(db, run.owner_id, run.execution_plan_id);
  if (plan.archived || conversation.plan_id !== plan.id) throw rejected();
  const version = plan.draft ?? plan.locked;
  if (
    !version ||
    version.id !== run.execution_version_id ||
    version.editNumber !== run.execution_edit_number
  )
    throw new ChatError(
      'STALE_CONTEXT',
      'The plan changed elsewhere. Stop this run and review the current draft.',
    );
  if (write && version.state !== 'draft')
    throw new PlanError('DRAFT_REQUIRED', 'Ask the user to unlock the plan before editing.');
  return { plan, version };
}
export async function heartbeatRun(id: string, token: string) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const run = await authorized(db, id, token, true);
      if (run.status === 'running')
        await db
          .updateTable('agent_runs')
          .set({
            lease_expires_at: new Date(
              Math.min(Date.now() + LEASE_MS, new Date(run.deadline_at).getTime()),
            ),
          })
          .where('id', '=', id)
          .execute();
      return { status: run.status, deadlineAt: new Date(run.deadline_at).toISOString() };
    });
}
export async function runContext(id: string, token: string) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const run = await authorized(db, id, token);
      const current = await target(db, run);
      const history = await db
        .selectFrom('conversation_messages')
        .select(['role', 'content', 'sequence'])
        .where('conversation_id', '=', run.conversation_id)
        .orderBy('sequence', 'desc')
        .limit(60)
        .execute();
      // Keep newest messages within a bounded budget; do not truncate a message in
      // a way that changes its meaning. Explicitly disclose omitted older history.
      let total = 0;
      const messages: typeof history = [];
      for (const m of history) {
        if (total + m.content.length > 100000) break;
        messages.push(m);
        total += m.content.length;
      }
      return {
        messages: messages.reverse(),
        historyTruncated: messages.length < history.length || (history.at(-1)?.sequence ?? 1) > 1,
        plan: current?.plan ?? null,
        brief: current
          ? await readBrief(db, current.version.id, current.version.state === 'locked')
          : null,
        tools: toolDefinitions(),
        versionId: run.execution_version_id,
        editNumber: run.execution_edit_number,
      };
    });
}
export async function executeTool(
  id: string,
  token: string,
  command: z.infer<typeof ToolRequestSchema>,
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const run = await authorized(db, id, token);
      const hash = contentHash(json(command) as SemanticValue);
      const receipt = await db
        .selectFrom('agent_tool_receipts')
        .selectAll()
        .where('run_id', '=', id)
        .where('operation_id', '=', command.operationId)
        .executeTakeFirst();
      if (receipt) {
        if (receipt.input_hash !== hash)
          throw new ChatError(
            'IDEMPOTENCY_CONFLICT',
            'This operation identity was used for different input.',
          );
        return receipt.response;
      }
      if (run.tool_count >= 200)
        throw new ChatError('TOOL_LIMIT', 'The execution tool limit was reached.');
      if (!Object.hasOwn(ToolSchemas, command.name))
        throw new ChatError('TOOL_NOT_ALLOWED', 'This tool is not available.', 400);
      if (
        command.expectedVersionId !== run.execution_version_id ||
        command.expectedEditNumber !== run.execution_edit_number
      )
        throw new ChatError(
          'STALE_CONTEXT',
          'Use the execution’s current version and edit number.',
        );
      const name = command.name as ToolName;
      const schema = ToolSchemas[name];
      const parsed = schema.safeParse(command.input);
      if (!parsed.success)
        throw new ChatError('INVALID_TOOL_INPUT', 'The tool input does not match its schema.', 400);
      let response: unknown;
      if (name === 'create_plan_draft') {
        await target(db, run);
        if (run.execution_plan_id)
          throw new PlanError('PLAN_ALREADY_BOUND', 'This conversation already belongs to a plan.');
        const input = ToolSchemas.create_plan_draft.parse(command.input);
        if (input.startDate && input.endDate && input.endDate < input.startDate)
          throw new PlanError('INVALID_PLAN_RANGE', 'End date precedes start date.', 422);
        const created = await createPlanRows(db, run.owner_id, input.displayName, {
          ...(input.startDate ? { startDate: input.startDate } : {}),
          ...(input.endDate ? { endDate: input.endDate } : {}),
        });
        await db
          .updateTable('conversations')
          .set({ plan_id: created.planId, state_version: sql`state_version + 1` })
          .where('id', '=', run.conversation_id)
          .execute();
        await db
          .updateTable('agent_runs')
          .set({
            execution_plan_id: created.planId,
            execution_version_id: created.draftId,
            execution_edit_number: 1,
          })
          .where('id', '=', id)
          .execute();
        await appendEvent(db, id, 'plan_bound', {
          planId: created.planId,
          versionId: created.draftId,
        });
        response = { plan: await detail(db, run.owner_id, created.planId) };
      } else {
        const writing = [
          'update_plan_brief',
          'set_fitness_calibration',
          'apply_schedule_changes',
          'replace_schedule_range',
        ].includes(name);
        const current = await target(db, run, writing);
        if (!current) response = { plan: null };
        else {
          const versionId = current.version.id;
          if (writing) {
            const v = await db
              .selectFrom('plan_versions')
              .select('content_schema_version')
              .where('id', '=', versionId)
              .executeTakeFirstOrThrow();
            if (v.content_schema_version < 3) {
              await db
                .updateTable('plan_versions')
                .set({ content_schema_version: 3 })
                .where('id', '=', versionId)
                .execute();
              await changed(db, versionId, true, false);
            }
          }
          if (name === 'read_plan_context')
            response = {
              plan: current.plan,
              brief: await readBrief(db, versionId, current.version.state === 'locked'),
            };
          if (name === 'read_schedule') {
            const input = ToolSchemas.read_schedule.parse(command.input);
            // IDs are required for precise edits; the semantic revision projection deliberately excludes them.
            const tables = [
              'training_blocks',
              'training_weeks',
              'workouts',
              'workout_steps',
              'step_completions',
              'step_targets',
              'workout_tags',
            ] as const;
            const entries = await Promise.all(
              tables.map(async (table) => {
                const rows = await db
                  .selectFrom(table)
                  .selectAll()
                  .where('plan_version_id', '=', versionId)
                  .execute();
                return [table, rows] as const;
              }),
            );
            const schedule = Object.fromEntries(entries);
            const workouts = schedule.workouts as Selectable<DB['workouts']>[];
            const selected = workouts.filter(
              (w) =>
                (!input.startDate || String(w.scheduled_date) >= input.startDate) &&
                (!input.endDate || String(w.scheduled_date) <= input.endDate),
            );
            const workoutIds = new Set(selected.map((w) => w.id));
            const steps = schedule.workout_steps as Selectable<DB['workout_steps']>[];
            const selectedSteps = steps.filter((s) => workoutIds.has(s.workout_id));
            const stepIds = new Set(selectedSteps.map((s) => s.id));
            response = {
              ...schedule,
              workouts: selected,
              workout_steps: selectedSteps,
              workout_tags: (schedule.workout_tags as Selectable<DB['workout_tags']>[]).filter(
                (t) => workoutIds.has(t.workout_id),
              ),
              step_completions: (
                schedule.step_completions as Selectable<DB['step_completions']>[]
              ).filter((s) => stepIds.has(s.step_id)),
              step_targets: (schedule.step_targets as Selectable<DB['step_targets']>[]).filter(
                (s) => stepIds.has(s.step_id),
              ),
            };
          }
          if (name === 'update_plan_brief') {
            const input = ToolSchemas.update_plan_brief.parse(command.input);
            if (input.startDate && input.endDate && input.endDate < input.startDate)
              throw new PlanError('INVALID_PLAN_RANGE', 'End date precedes start date.', 422);
            const state = await readBrief(db, versionId);
            if (
              state.startDate !== input.startDate ||
              state.endDate !== input.endDate ||
              current.version.description !== input.description
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
              await changed(
                db,
                versionId,
                state.startDate !== input.startDate || state.endDate !== input.endDate,
                true,
              );
              if (input.startDate && state.startDate !== input.startDate) {
                const first = await db
                  .selectFrom('plan_calibration_periods')
                  .selectAll()
                  .where('plan_version_id', '=', versionId)
                  .orderBy('effective_from')
                  .executeTakeFirst();
                if (
                  first &&
                  (!first.effective_until || input.startDate < String(first.effective_until))
                )
                  await db
                    .updateTable('plan_calibration_periods')
                    .set({ effective_from: input.startDate })
                    .where('id', '=', first.id)
                    .execute();
              }
            }
            await saveBriefRows(db, await readBrief(db, versionId), input.brief);
            response = { brief: await readBrief(db, versionId) };
          }
          if (name === 'set_fitness_calibration') {
            const input = ToolSchemas.set_fitness_calibration.parse(command.input);
            await addCalibrationRows(db, await readBrief(db, versionId), input);
            response = { brief: await readBrief(db, versionId) };
          }
          if (name === 'apply_schedule_changes')
            response = await writeSchedule(
              db,
              versionId,
              ToolSchemas.apply_schedule_changes.parse(command.input),
            );
          if (name === 'replace_schedule_range') {
            const input = ToolSchemas.replace_schedule_range.parse(command.input);
            response = await writeSchedule(db, versionId, input, input.range);
          }
          if (name === 'validate_plan')
            response = current.plan.draft ? await preview(db, current.plan) : { readOnly: true };
          if (writing) {
            const version = await db
              .selectFrom('plan_versions')
              .select('edit_number')
              .where('id', '=', versionId)
              .executeTakeFirstOrThrow();
            await db
              .updateTable('agent_runs')
              .set({ execution_edit_number: version.edit_number })
              .where('id', '=', id)
              .execute();
          }
        }
      }
      if (
        Date.now() >= new Date(run.deadline_at).getTime() ||
        Date.now() >= new Date(run.lease_expires_at!).getTime()
      )
        throw rejected();
      const updated = await db
        .selectFrom('agent_runs')
        .select(['execution_version_id', 'execution_edit_number', 'execution_plan_id'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const result = {
        result: response,
        versionId: updated.execution_version_id,
        editNumber: updated.execution_edit_number,
        planId: updated.execution_plan_id,
      };
      if (JSON.stringify(result).length > 500000)
        throw new ChatError(
          'CONTEXT_TOO_LARGE',
          'Narrow the schedule date range before reading.',
          400,
        );
      await db
        .insertInto('agent_tool_receipts')
        .values({
          run_id: id,
          operation_id: command.operationId,
          tool_name: name,
          input_hash: hash,
          response: json(result),
          target_version_id: updated.execution_version_id,
          edit_number: updated.execution_edit_number,
        })
        .execute();
      await db
        .updateTable('agent_runs')
        .set({ tool_count: sql`tool_count + 1` })
        .where('id', '=', id)
        .execute();
      await appendEvent(db, id, 'tool_completed', {
        name,
        operationId: command.operationId,
        versionId: updated.execution_version_id,
        editNumber: updated.execution_edit_number,
      });
      return result;
    })
    .catch((error: unknown) => {
      if (
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
export async function finishRun(
  id: string,
  token: string,
  input: {
    status: 'completed' | 'failed' | 'cancelled';
    content?: string | undefined;
    failureCode?: string | undefined;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
  },
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const run = await authorized(db, id, token, true);
      if (run.status === 'cancelling') {
        await transition(db, run, 'cancelled', 'cancelled');
        return { status: 'cancelled' };
      }
      if (input.status === 'cancelled')
        throw new ChatError('CANCELLATION_REQUIRED', 'Cancellation has not been requested.');
      if (input.status === 'completed') {
        const current = await target(db, run);
        const conversation = await ownedConversation(db, run.owner_id, run.conversation_id);
        if (!input.content?.trim())
          throw new ChatError('EMPTY_RESPONSE', 'An assistant reply is required.', 400);
        await appendMessage(
          db,
          conversation,
          'assistant',
          input.content,
          current
            ? {
                versionId: current.version.id,
                state: current.version.state,
                versionNumber: current.version.versionNumber,
                editNumber: current.version.editNumber,
              }
            : null,
          id,
        );
      }
      await db
        .updateTable('agent_runs')
        .set({ input_tokens: input.inputTokens ?? null, output_tokens: input.outputTokens ?? null })
        .where('id', '=', id)
        .execute();
      await transition(
        db,
        run,
        input.status,
        input.status,
        input.status === 'failed' ? (input.failureCode ?? 'PROVIDER_ERROR') : null,
      );
      return { status: input.status };
    });
}
export async function sweepAgentRuns() {
  const candidates = await getDatabase()
    .selectFrom('agent_runs')
    .select(['id', 'owner_id'])
    .where('status', 'in', activeStatuses)
    .where((eb) =>
      eb.or([
        eb('deadline_at', '<=', new Date()),
        eb.and([
          eb('status', 'in', ['running', 'cancelling']),
          eb('lease_expires_at', '<=', new Date()),
        ]),
      ]),
    )
    .limit(100)
    .execute();
  for (const candidate of candidates)
    await getDatabase()
      .transaction()
      .execute(async (db) => {
        const run = await ownedRun(db, candidate.owner_id, candidate.id, true);
        if (!activeStatuses.some((s) => s === run.status)) return;
        if (Date.now() >= new Date(run.deadline_at).getTime())
          await transition(db, run, 'failed', 'failed', 'EXECUTION_TIMEOUT');
        else if (run.lease_expires_at && Date.now() >= new Date(run.lease_expires_at).getTime()) {
          if (run.status === 'cancelling') await transition(db, run, 'cancelled', 'cancelled');
          else await transition(db, run, 'failed', 'failed', 'WORKER_LOST');
        }
      });
}
