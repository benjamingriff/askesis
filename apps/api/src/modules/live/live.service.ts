import { sql } from 'kysely';
import { getDatabase } from '../../database/client.js';
import type { Json } from '../../database/generated.js';
import { authorized } from '../agent/agent.service.js';
import { ToolSchemas } from '../agent/agent.schemas.js';
import { ChatError } from '../chat/chat.core.js';
import { appendEvent, ownedRun, ownedConversation, runView } from '../chat/chat.service.js';
import { compareVersions } from './live.changes.js';
import { readAggregate } from '../plans/plan.aggregate.js';
import { contentHash, type SemanticValue } from '../plans/plan.canonical.js';
import { detail, PlanError } from '../plans/plan.service.js';
import { ProgressSchema, type Progress } from './live.schemas.js';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;
export async function saveProgress(id: string, token: string, raw: Progress) {
  const input = ProgressSchema.parse(raw);
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const run = await authorized(db, id, token, true);
      const hash = contentHash(json(input) as SemanticValue);
      const receipt = await db
        .selectFrom('agent_progress_batches')
        .selectAll()
        .where('run_id', '=', id)
        .where('sequence', '=', input.sequence)
        .executeTakeFirst();
      if (receipt) {
        if (receipt.input_hash !== hash)
          throw new ChatError('IDEMPOTENCY_CONFLICT', 'Progress identity changed.');
        return { status: run.status };
      }
      const previous = await db
        .selectFrom('agent_progress_batches')
        .select('sequence')
        .where('run_id', '=', id)
        .orderBy('sequence', 'desc')
        .executeTakeFirst();
      if (input.sequence !== (previous?.sequence ?? 0) + 1)
        throw new ChatError('OUTPUT_GAP', 'Progress must be delivered in order.');
      for (const item of input.items) {
        const old = await db
          .selectFrom('agent_run_outputs')
          .selectAll()
          .where('run_id', '=', id)
          .where('item_id', '=', item.itemId)
          .executeTakeFirst();
        if (
          old &&
          (old.position !== item.position ||
            item.revision <= old.revision ||
            !item.content.startsWith(old.content) ||
            (old.truncated && !item.truncated) ||
            old.is_final)
        )
          throw new ChatError('OUTPUT_CONFLICT', 'Output revision changed.');
        const values = {
          content: item.content,
          revision: item.revision,
          truncated: item.truncated,
        };
        if (old)
          await db
            .updateTable('agent_run_outputs')
            .set(values)
            .where('run_id', '=', id)
            .where('item_id', '=', item.itemId)
            .execute();
        else
          await db
            .insertInto('agent_run_outputs')
            .values({ run_id: id, item_id: item.itemId, position: item.position, ...values })
            .execute();
      }
      const size = await db
        .selectFrom('agent_run_outputs')
        .select(sql<string>`sum(length(content))`.as('size'))
        .where('run_id', '=', id)
        .executeTakeFirst();
      if (Number(size?.size ?? 0) > 64000)
        throw new ChatError('OUTPUT_LIMIT', 'Visible output limit reached.');
      if (input.activity) {
        if (run.status !== 'running')
          throw new ChatError('CANCELLATION_REQUIRED', 'No new activity while stopping.');
        if (!Object.hasOwn(ToolSchemas, input.activity.name))
          throw new ChatError('TOOL_NOT_ALLOWED', 'Unknown activity.');
        // A lost tool acknowledgement is not a failure when its receipt committed.
        const saved = await db
          .selectFrom('agent_tool_receipts')
          .select('operation_id')
          .where('run_id', '=', id)
          .where('operation_id', '=', input.activity.operationId)
          .executeTakeFirst();
        if (!saved)
          await appendEvent(
            db,
            id,
            input.activity.state === 'started' ? 'tool_started' : 'tool_failed',
            {
              name: input.activity.name,
              operationId: input.activity.operationId,
            },
          );
      }
      if (input.timings)
        await db
          .insertInto('agent_run_measurements')
          .values({ run_id: id, timings: json(input.timings) })
          .onConflict((oc) => oc.column('run_id').doUpdateSet({ timings: json(input.timings) }))
          .execute();
      await db
        .insertInto('agent_progress_batches')
        .values({ run_id: id, sequence: input.sequence, input_hash: hash })
        .execute();
      return { status: run.status };
    });
}
export async function getOutput(owner: string, id: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const run = await ownedRun(db, owner, id);
      const items = await db
        .selectFrom('agent_run_outputs')
        .selectAll()
        .where('run_id', '=', id)
        .orderBy('position')
        .execute();
      const message = await db
        .selectFrom('conversation_messages')
        .select('id')
        .where('producing_run_id', '=', id)
        .executeTakeFirst();
      const measurements = await db
        .selectFrom('agent_run_measurements')
        .select('timings')
        .where('run_id', '=', id)
        .executeTakeFirst();
      return {
        runId: id,
        status: run.status,
        finalMessageId: message?.id ?? null,
        items: items.map((i) => ({
          itemId: i.item_id,
          position: i.position,
          content: i.content,
          revision: i.revision,
          isFinal: i.is_final,
          truncated: i.truncated,
        })),
        timings: {
          ...((measurements?.timings as Record<string, unknown>) ?? {}),
          ...(run.started_at
            ? {
                queueWaitMs: Math.max(
                  0,
                  new Date(run.started_at).getTime() - new Date(run.created_at).getTime(),
                ),
              }
            : {}),
          ...(run.started_at && run.finished_at
            ? {
                executionMs: Math.max(
                  0,
                  new Date(run.finished_at).getTime() - new Date(run.started_at).getTime(),
                ),
              }
            : {}),
        },
      };
    });
}
export async function conversationRuns(
  owner: string,
  id: string,
  before: number | undefined,
  limit: number,
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      await ownedConversation(db, owner, id);
      let query = db
        .selectFrom('agent_runs as r')
        .innerJoin('conversation_messages as m', 'm.id', 'r.user_message_id')
        .selectAll('r')
        .select('m.sequence as message_sequence')
        .where('r.conversation_id', '=', id)
        .where('r.owner_id', '=', owner);
      if (before !== undefined) query = query.where('m.sequence', '<', before);
      const rows = await query
        .orderBy('m.sequence', 'desc')
        .limit(limit + 1)
        .execute();
      const page = rows.slice(0, limit);
      return {
        runs: page.map(runView),
        nextBeforeSequence: rows.length > limit ? page.at(-1)!.message_sequence : null,
      };
    });
}
export async function draftChanges(owner: string, id: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const plan = await detail(db, owner, id);
      if (!plan.draft) throw new PlanError('DRAFT_REQUIRED', 'There is no draft to compare.');
      const before = plan.locked ? await readAggregate(db, plan.locked.id) : null;
      return {
        versionId: plan.draft.id,
        editNumber: plan.draft.editNumber,
        baselineId: plan.locked?.id ?? null,
        ...(await compareVersions(db, before, plan.draft.id)),
      };
    });
}
export async function runChanges(owner: string, id: string) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      await ownedRun(db, owner, id);
      const rows = await db
        .selectFrom('agent_tool_changes as c')
        .innerJoin('agent_run_events as e', 'e.run_id', 'c.run_id')
        .select('c.summary')
        .where('c.run_id', '=', id)
        .where('e.type', '=', 'tool_completed')
        .where(sql<boolean>`e.metadata->>'operationId' = c.operation_id`)
        .orderBy('e.sequence')
        .execute();
      const receipt = await db
        .selectFrom('agent_tool_receipts')
        .select('operation_id')
        .where('run_id', '=', id)
        .where('tool_name', 'in', [
          'create_plan_draft',
          'update_plan_brief',
          'set_fitness_calibration',
          'apply_schedule_changes',
          'replace_schedule_range',
        ])
        .executeTakeFirst();
      return { summaries: rows.map((r) => r.summary), legacy: rows.length === 0 && !!receipt };
    });
}
export async function bootstrap(owner: string) {
  const row = await getDatabase()
    .selectFrom('live_event_heads')
    .select('sequence')
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  return { cursor: String(row?.sequence ?? 0) };
}
export async function liveEvents(owner: string, cursor: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const head = await db
        .selectFrom('live_event_heads')
        .select('sequence')
        .where('owner_id', '=', owner)
        .executeTakeFirst();
      const latest = String(head?.sequence ?? 0);
      const oldest = await db
        .selectFrom('live_events')
        .select('sequence')
        .where('owner_id', '=', owner)
        .orderBy('sequence')
        .executeTakeFirst();
      if (
        BigInt(cursor) > BigInt(latest) ||
        (oldest && BigInt(cursor) < BigInt(String(oldest.sequence)) - 1n)
      )
        return { cursor: latest, reset: true, events: [] };
      const rows = await db
        .selectFrom('live_events')
        .selectAll()
        .where('owner_id', '=', owner)
        .where('sequence', '>', cursor)
        .orderBy('sequence')
        .limit(100)
        .execute();
      return {
        cursor: rows.length ? String(rows.at(-1)!.sequence) : cursor,
        reset: false,
        events: rows.map((r) => ({ id: String(r.sequence), type: r.type, metadata: r.metadata })),
      };
    });
}
