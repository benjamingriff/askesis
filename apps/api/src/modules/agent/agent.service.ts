import { createHash, randomBytes } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
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
import { compareVersions, storedSummary } from '../live/live.changes.js';
import { readAggregate } from '../plans/plan.aggregate.js';
import { contentHash, type SemanticValue } from '../plans/plan.canonical.js';
import { recordDraftChange, readBrief, saveBriefRows } from '../plans/brief.service.js';
import {
  previewCalibration,
  readPerformance,
  recordCalibrationRows,
  retractCalibrationRows,
} from '../performance/performance.service.js';
import { createPlanRows, detail, PlanError, preview } from '../plans/plan.service.js';
import {
  ToolSchemas,
  PROMPT_VERSION,
  toolDefinitions,
  type RegisterSchema,
  type ToolRequestSchema,
  type ToolName,
} from './agent.schemas.js';
import { writeSchedule } from './agent.schedule.js';

type Tx = Transaction<DB>;
type Run = Selectable<DB['agent_runs']>;
export const LEASE_MS = 90000;
/** Tools that commit plan content; reads and validation never count as saved changes. */
export const MUTATING_TOOLS: ToolName[] = [
  'create_plan_draft',
  'update_plan_brief',
  'apply_schedule_changes',
  'replace_schedule_range',
];
/** Tools on the athlete's calibration timeline. They never touch plan content or need a plan. */
export const PERFORMANCE_TOOLS: ToolName[] = [
  'read_performance',
  'preview_performance',
  'record_performance',
  'retract_performance',
];
export const READY_MS = 60000;
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const rejected = () => new ChatError('LEASE_LOST', 'This execution is no longer authorized.', 409);
// Pass the open transaction when called inside one, so the check does not take a second pooled connection.
export async function workerReady(db: Kysely<DB> | Tx = getDatabase()) {
  if (getApiConfig().CHAT_EXECUTION_MODE !== 'agent') return false;
  return !!(await db
    .selectFrom('agent_workers')
    .select('id')
    .where('ready', '=', true)
    .where('prompt_version', '=', PROMPT_VERSION)
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
        worker.prompt_version !== PROMPT_VERSION ||
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
export async function authorized(db: Tx, id: string, token: string, allowCancelling = false) {
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
        performance: await readPerformance(db, run.owner_id),
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
      const mutating = MUTATING_TOOLS.includes(name);
      // Stabilize the before snapshot and expected edit identity against human writers.
      if (run.execution_version_id)
        await db
          .selectFrom('plan_versions')
          .select('id')
          .where('id', '=', run.execution_version_id)
          .forUpdate()
          .executeTakeFirst();
      const before =
        mutating && run.execution_version_id
          ? await readAggregate(db, run.execution_version_id)
          : null;
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
      } else if (PERFORMANCE_TOOLS.includes(name)) {
        const conversation = await ownedConversation(db, run.owner_id, run.conversation_id);
        if (conversation.archived_at) throw rejected();
        response = await performanceTool(db, run, name, command.input);
      } else {
        const writing = mutating;
        const current = await target(db, run, writing);
        if (!current) response = { plan: null };
        else {
          const versionId = current.version.id;
          if (name === 'read_plan_context')
            response = {
              plan: current.plan,
              brief: await readBrief(db, versionId, current.version.state === 'locked'),
            };
          if (name === 'read_schedule') {
            const input = ToolSchemas.read_schedule.parse(command.input);
            // IDs are required for precise edits; the semantic revision projection deliberately excludes them.
            // Structure (blocks, weeks) is small and returned whole; prescriptions are filtered in SQL.
            let workoutQuery = db
              .selectFrom('workouts')
              .selectAll()
              .where('plan_version_id', '=', versionId);
            if (input.startDate)
              workoutQuery = workoutQuery.where(
                'scheduled_date',
                '>=',
                sql<Date>`${input.startDate}::date`,
              );
            if (input.endDate)
              workoutQuery = workoutQuery.where(
                'scheduled_date',
                '<=',
                sql<Date>`${input.endDate}::date`,
              );
            const [blocks, weeks, workouts] = await Promise.all([
              db
                .selectFrom('training_blocks')
                .selectAll()
                .where('plan_version_id', '=', versionId)
                .execute(),
              db
                .selectFrom('training_weeks')
                .selectAll()
                .where('plan_version_id', '=', versionId)
                .execute(),
              workoutQuery.execute(),
            ]);
            const workoutIds = workouts.map((w) => w.id);
            const steps = workoutIds.length
              ? await db
                  .selectFrom('workout_steps')
                  .selectAll()
                  .where('plan_version_id', '=', versionId)
                  .where('workout_id', 'in', workoutIds)
                  .execute()
              : [];
            const stepIds = steps.map((s) => s.id);
            const [tags, completions, targets] = await Promise.all([
              workoutIds.length
                ? db
                    .selectFrom('workout_tags')
                    .selectAll()
                    .where('plan_version_id', '=', versionId)
                    .where('workout_id', 'in', workoutIds)
                    .execute()
                : [],
              stepIds.length
                ? db
                    .selectFrom('step_completions')
                    .selectAll()
                    .where('plan_version_id', '=', versionId)
                    .where('step_id', 'in', stepIds)
                    .execute()
                : [],
              stepIds.length
                ? db
                    .selectFrom('step_targets')
                    .selectAll()
                    .where('plan_version_id', '=', versionId)
                    .where('step_id', 'in', stepIds)
                    .execute()
                : [],
            ]);
            response = {
              training_blocks: blocks,
              training_weeks: weeks,
              workouts,
              workout_steps: steps,
              step_completions: completions,
              step_targets: targets,
              workout_tags: tags,
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
              await recordDraftChange(
                db,
                versionId,
                state.startDate !== input.startDate || state.endDate !== input.endDate
                  ? 'invalidate-confirmation-and-review-schedule'
                  : 'edit-only',
              );
            }
            await saveBriefRows(db, await readBrief(db, versionId), input.brief);
            response = { brief: await readBrief(db, versionId) };
          }
          if (name === 'apply_schedule_changes')
            response = await writeSchedule(
              db,
              versionId,
              ToolSchemas.apply_schedule_changes.parse(command.input),
              id,
            );
          if (name === 'replace_schedule_range') {
            const input = ToolSchemas.replace_schedule_range.parse(command.input);
            response = await writeSchedule(db, versionId, input, id, input.range);
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
      if (mutating && updated.execution_version_id) {
        const summary = await compareVersions(db, before, updated.execution_version_id);
        await db
          .insertInto('agent_tool_changes')
          .values({
            run_id: id,
            operation_id: command.operationId,
            summary: json(storedSummary(summary)),
          })
          .execute();
      }
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
        (command.name === 'apply_schedule_changes' || command.name === 'replace_schedule_range') &&
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
async function performanceTool(db: Tx, run: Run, name: ToolName, raw: unknown) {
  if (name === 'preview_performance')
    return {
      preview: await previewCalibration(
        db,
        run.owner_id,
        ToolSchemas.preview_performance.parse(raw),
      ),
    };
  if (name === 'record_performance') {
    const { observedOn, ...input } = ToolSchemas.record_performance.parse(raw);
    const entry = await recordCalibrationRows(
      db,
      run.owner_id,
      { ...input, ...(observedOn ? { observedOn } : {}) },
      { runId: run.id },
    );
    return { recorded: entry, performance: await readPerformance(db, run.owner_id) };
  }
  if (name === 'retract_performance')
    await retractCalibrationRows(
      db,
      run.owner_id,
      ToolSchemas.retract_performance.parse(raw).calibrationId,
      run.id,
    );
  return { performance: await readPerformance(db, run.owner_id) };
}
export async function finishRun(
  id: string,
  token: string,
  input: {
    status: 'completed' | 'failed' | 'cancelled';
    content?: string | undefined;
    finalOutputItemId?: string | undefined;
    failureCode?: string | undefined;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
  },
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const hash = contentHash(json(input) as SemanticValue);
      const hint = await db
        .selectFrom('agent_runs')
        .select('credential_digest')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!hint || hint.credential_digest !== digest(token)) throw rejected();
      // A repeated delivery returns the recorded outcome, even after the run became terminal.
      const replay = async () => {
        const receipt = await db
          .selectFrom('agent_run_finishes')
          .selectAll()
          .where('run_id', '=', id)
          .executeTakeFirst();
        if (receipt && receipt.input_hash !== hash)
          throw new ChatError('IDEMPOTENCY_CONFLICT', 'Finish identity changed.');
        return receipt ? { status: receipt.status } : null;
      };
      const earlier = await replay();
      if (earlier) return earlier;
      // Take conversation and run locks in the order every other run command uses; a concurrent
      // finish that committed while this one waited is then visible as a receipt.
      let run: Run;
      try {
        run = await authorized(db, id, token, true);
      } catch (error) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
        throw error;
      }
      const concurrent = await replay();
      if (concurrent) return concurrent;
      const status = run.status === 'cancelling' ? 'cancelled' : input.status;
      await db
        .insertInto('agent_run_finishes')
        .values({ run_id: id, input_hash: hash, status })
        .execute();
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
        if (input.finalOutputItemId) {
          const item = await db
            .selectFrom('agent_run_outputs')
            .select('content')
            .where('run_id', '=', id)
            .where('item_id', '=', input.finalOutputItemId)
            .executeTakeFirst();
          if (!item || item.content !== input.content)
            throw new ChatError('OUTPUT_CONFLICT', 'Final output does not match saved text.');
          await db
            .updateTable('agent_run_outputs')
            .set({ is_final: true })
            .where('run_id', '=', id)
            .where('item_id', '=', input.finalOutputItemId)
            .execute();
        }
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
// Each worker process registers a fresh identity; drop long-stale ones that no run references.
export async function pruneAgentWorkers() {
  await getDatabase()
    .deleteFrom('agent_workers')
    .where('last_seen_at', '<', new Date(Date.now() - 24 * 60 * 60 * 1000))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('agent_runs')
            .select('id')
            .whereRef('agent_runs.worker_id', '=', 'agent_workers.id'),
        ),
      ),
    )
    .execute();
}
