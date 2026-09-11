import { randomUUID } from 'node:crypto';
import { sql, type Transaction, type Selectable } from 'kysely';
import { getDatabase } from '../../database/client.js';
import { getApiConfig } from '../../config.js';
import type { DB, Json } from '../../database/generated.js';
import { contentHash, type SemanticValue } from '../plans/plan.canonical.js';
import { Id } from '../plans/plan.schemas.js';
import { activeStatuses, assertPlanIdle, ChatError, createConversationRow } from './chat.core.js';
import {
  ContextSchema,
  ConversationSchema,
  ConversationDetailSchema,
  MessageSchema,
  RunSchema,
  AcceptedSchema,
  CreatedSchema,
  type Context,
  type Send,
  type Target,
} from './chat.schemas.js';
import type { z } from '@hono/zod-openapi';

type Tx = Transaction<DB>;
type Conversation = Selectable<DB['conversations']>;
type Run = Selectable<DB['agent_runs']>;
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const iso = (value: Date | string | null) => (value instanceof Date ? value.toISOString() : value);
const notFound = () => new ChatError('NOT_FOUND', 'Conversation or run not found.', 404);
export function chatCapabilities() {
  const mode = getApiConfig().CHAT_EXECUTION_MODE;
  return { executionAvailable: mode === 'test', mode };
}
function available() {
  if (!chatCapabilities().executionAvailable)
    throw new ChatError(
      'AGENT_UNAVAILABLE',
      'Coaching is not available yet. Conversation history is still available.',
      503,
    );
}

async function idempotent<T>(
  owner: string,
  scope: string,
  key: string,
  input: unknown,
  schema: z.ZodType<T>,
  perform: (db: Tx) => Promise<T>,
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([owner, scope, key])}, 0))`.execute(
        db,
      );
      const hash = contentHash(json(input) as SemanticValue);
      const existing = await db
        .selectFrom('api_idempotency_keys')
        .selectAll()
        .where('athlete_id', '=', owner)
        .where('command_scope', '=', scope)
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (existing) {
        if (existing.request_hash !== hash)
          throw new ChatError(
            'IDEMPOTENCY_CONFLICT',
            'This request key was already used for different input.',
          );
        return schema.parse(existing.response_body);
      }
      const result = await perform(db);
      await db
        .insertInto('api_idempotency_keys')
        .values({
          athlete_id: owner,
          command_scope: scope,
          idempotency_key: key,
          request_hash: hash,
          response_status: scope === 'chat.send' ? 202 : 201,
          response_body: json(result),
        })
        .execute();
      return result;
    });
}
async function ownedPlan(db: Tx, owner: string, id: string) {
  const plan = await db
    .selectFrom('plans')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .forUpdate()
    .executeTakeFirst();
  if (!plan) throw notFound();
  return plan;
}
async function ownedConversation(db: Tx, owner: string, id: string, lock = false) {
  const row = await db
    .selectFrom('conversations')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!row) throw notFound();
  if (!lock) return row;
  if (row.plan_id) await ownedPlan(db, owner, row.plan_id);
  return await db
    .selectFrom('conversations')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .forUpdate()
    .executeTakeFirstOrThrow();
}
async function contextFor(db: Tx, conversation: Conversation): Promise<Context> {
  if (!conversation.plan_id) return null;
  const plan = await db
    .selectFrom('plans')
    .selectAll()
    .where('id', '=', conversation.plan_id)
    .executeTakeFirstOrThrow();
  const version = await db
    .selectFrom('plan_versions')
    .selectAll()
    .where('id', '=', plan.current_draft_version_id ?? plan.current_locked_version_id!)
    .executeTakeFirstOrThrow();
  return ContextSchema.parse({
    versionId: version.id,
    state: version.state,
    versionNumber: version.version_number,
    editNumber: version.edit_number,
  });
}
async function conversationView(db: Tx, row: Conversation) {
  const plan = row.plan_id
    ? await db
        .selectFrom('plans')
        .selectAll()
        .where('id', '=', row.plan_id)
        .executeTakeFirstOrThrow()
    : null;
  return ConversationSchema.parse({
    id: row.id,
    title: row.title,
    planId: row.plan_id,
    planName: plan?.display_name ?? null,
    archived: row.archived_at !== null || !!plan?.archived_at,
    planArchived: !!plan?.archived_at,
    stateVersion: row.state_version,
    createdAt: iso(row.created_at),
    activityAt: iso(row.activity_at),
    context: await contextFor(db, row),
  });
}
async function writable(db: Tx, row: Conversation) {
  const view = await conversationView(db, row);
  if (view.planArchived)
    throw new ChatError('PLAN_ARCHIVED', 'Unarchive the plan before changing this conversation.');
  if (view.archived)
    throw new ChatError('CONVERSATION_ARCHIVED', 'Unarchive this conversation before changing it.');
}
function runView(row: Run) {
  return RunSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    planId: row.plan_id,
    userMessageId: row.user_message_id,
    status: row.status,
    context: row.context,
    failureCode: row.failure_code,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  });
}
function messageView(row: Selectable<DB['conversation_messages']>) {
  return MessageSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    producingRunId: row.producing_run_id,
    context: row.context,
    createdAt: iso(row.created_at),
  });
}
async function activeRun(db: Tx, row: Conversation) {
  let query = db.selectFrom('agent_runs').selectAll().where('status', 'in', activeStatuses);
  query = row.plan_id
    ? query.where('plan_id', '=', row.plan_id)
    : query.where('conversation_id', '=', row.id);
  return await query.executeTakeFirst();
}
function targetMatches(context: Context, target: Target) {
  if (
    (context === null) !== (target === null) ||
    (context &&
      target &&
      (context.versionId !== target.versionId || context.editNumber !== target.editNumber))
  ) {
    throw new ChatError(
      'STALE_CONTEXT',
      'The plan context changed. Refresh context and review your message.',
    );
  }
}
async function appendEvent(db: Tx, runId: string, type: string, metadata: unknown = {}) {
  const last = await db
    .selectFrom('agent_run_events')
    .select('sequence')
    .where('run_id', '=', runId)
    .orderBy('sequence', 'desc')
    .executeTakeFirst();
  await db
    .insertInto('agent_run_events')
    .values({ run_id: runId, sequence: (last?.sequence ?? 0) + 1, type, metadata: json(metadata) })
    .execute();
}
async function appendMessage(
  db: Tx,
  row: Conversation,
  role: 'user' | 'assistant',
  content: string,
  context: Context,
  runId: string | null = null,
) {
  const counter = await db
    .updateTable('conversations')
    .set({ next_sequence: sql`next_sequence + 1`, activity_at: new Date() })
    .where('id', '=', row.id)
    .returning('next_sequence')
    .executeTakeFirstOrThrow();
  return messageView(
    await db
      .insertInto('conversation_messages')
      .values({
        id: randomUUID(),
        conversation_id: row.id,
        sequence: counter.next_sequence - 1,
        role,
        content,
        context: context === null ? null : json(context),
        producing_run_id: runId,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}
async function accept(db: Tx, row: Conversation, input: Send) {
  await writable(db, row);
  available();
  const context = await contextFor(db, row);
  targetMatches(context, input.target);
  if (await activeRun(db, row))
    throw new ChatError(
      'RUN_ACTIVE',
      'Wait for the active run or stop it before sending another message.',
    );
  if (row.next_sequence === 1 && row.title === 'New conversation') {
    await db
      .updateTable('conversations')
      .set({ title: input.content.slice(0, 80), state_version: sql`state_version + 1` })
      .where('id', '=', row.id)
      .execute();
  }
  const message = await appendMessage(db, row, 'user', input.content, context);
  const run = await db
    .insertInto('agent_runs')
    .values({
      id: randomUUID(),
      owner_id: row.owner_id,
      conversation_id: row.id,
      plan_id: row.plan_id,
      user_message_id: message.id,
      context: context === null ? null : json(context),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await appendEvent(db, run.id, 'queued');
  return { message, run: runView(run) };
}

export async function createConversation(
  owner: string,
  input: { planId?: string | undefined; initialMessage?: Send | undefined },
  key: string,
) {
  return idempotent(owner, 'chat.create', key, input, CreatedSchema, async (db) => {
    if (input.planId) {
      const plan = await ownedPlan(db, owner, input.planId);
      if (plan.archived_at)
        throw new ChatError('PLAN_ARCHIVED', 'Unarchive this plan before creating a conversation.');
    }
    if (input.initialMessage) available();
    const id = await createConversationRow(db, owner, input.planId ?? null);
    const row = await ownedConversation(db, owner, id, true);
    const accepted = input.initialMessage ? await accept(db, row, input.initialMessage) : null;
    return {
      conversation: await conversationView(db, await ownedConversation(db, owner, id)),
      accepted,
    };
  });
}
export async function sendMessage(owner: string, id: string, input: Send, key: string) {
  return idempotent(
    owner,
    'chat.send',
    key,
    { conversationId: id, ...input },
    AcceptedSchema,
    async (db) => accept(db, await ownedConversation(db, owner, id, true), input),
  );
}
export async function openPlanConversation(owner: string, planId: string) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const plan = await ownedPlan(db, owner, planId);
      if (plan.archived_at)
        throw new ChatError('PLAN_ARCHIVED', 'Unarchive this plan before opening chat.');
      const existing = await db
        .selectFrom('conversations')
        .select('id')
        .where('plan_id', '=', planId)
        .where('owner_id', '=', owner)
        .where('archived_at', 'is', null)
        .orderBy('activity_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      const id = existing?.id ?? (await createConversationRow(db, owner, planId));
      return conversationView(db, await ownedConversation(db, owner, id));
    });
}
export async function getConversation(owner: string, id: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const row = await ownedConversation(db, owner, id);
      const active = await activeRun(db, row);
      const latest = await db
        .selectFrom('agent_runs')
        .selectAll()
        .where('conversation_id', '=', id)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return ConversationDetailSchema.parse({
        ...(await conversationView(db, row)),
        activeRun: active ? runView(active) : null,
        latestRun: latest ? runView(latest) : null,
      });
    });
}
export async function listConversations(
  owner: string,
  input: {
    collection: 'open' | 'archive';
    planId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      let query = db
        .selectFrom('conversations as c')
        .leftJoin('plans as p', 'p.id', 'c.plan_id')
        .selectAll('c')
        .select(
          sql<string>`to_char(c.activity_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
            'cursor_time',
          ),
        )
        .where('c.owner_id', '=', owner);
      query =
        input.collection === 'archive'
          ? query.where((eb) =>
              eb.or([eb('c.archived_at', 'is not', null), eb('p.archived_at', 'is not', null)]),
            )
          : query.where('c.archived_at', 'is', null).where('p.archived_at', 'is', null);
      if (input.planId) {
        const plan = await db
          .selectFrom('plans')
          .select('id')
          .where('id', '=', input.planId)
          .where('owner_id', '=', owner)
          .executeTakeFirst();
        if (!plan) throw notFound();
        query = query.where('c.plan_id', '=', input.planId);
      }
      if (input.cursor) {
        let cursor: { time: string; id: string };
        try {
          const parsed: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            !('time' in parsed) ||
            !('id' in parsed) ||
            typeof parsed.time !== 'string' ||
            typeof parsed.id !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T/.test(parsed.time) ||
            !Number.isFinite(Date.parse(parsed.time)) ||
            !Id.safeParse(parsed.id).success
          )
            throw new Error();
          cursor = { time: parsed.time, id: parsed.id };
        } catch {
          throw new ChatError('INVALID_CURSOR', 'Invalid conversation cursor.', 400);
        }
        query = query.where(
          sql<boolean>`(c.activity_at, c.id) < (${cursor.time}::timestamptz, ${cursor.id}::uuid)`,
        );
      }
      const rows = await query
        .orderBy('c.activity_at', 'desc')
        .orderBy('c.id', 'desc')
        .limit(input.limit + 1)
        .execute();
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        conversations: await Promise.all(page.map((row) => conversationView(db, row))),
        nextCursor:
          rows.length > input.limit && last
            ? Buffer.from(JSON.stringify({ time: last.cursor_time, id: last.id })).toString(
                'base64url',
              )
            : null,
      };
    });
}
export async function changeConversation(
  owner: string,
  id: string,
  expected: number,
  change: { title: string } | { archived: boolean },
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const row = await ownedConversation(db, owner, id, true);
      const view = await conversationView(db, row);
      if (view.planArchived)
        throw new ChatError('PLAN_ARCHIVED', 'Restore the plan before changing this conversation.');
      if ('archived' in change && view.archived === change.archived) return view;
      if (row.state_version !== expected)
        throw new ChatError(
          'STALE_CONVERSATION',
          'This conversation changed. Refresh and try again.',
        );
      if ('title' in change) await writable(db, row);
      if ('archived' in change && change.archived) {
        const run = await db
          .selectFrom('agent_runs')
          .select('id')
          .where('conversation_id', '=', id)
          .where('status', 'in', activeStatuses)
          .executeTakeFirst();
        if (run)
          throw new ChatError('RUN_ACTIVE', 'Stop this conversation’s run before archiving.');
      }
      if ('title' in change && row.title === change.title) return view;
      const updated = await db
        .updateTable('conversations')
        .set({
          ...('title' in change
            ? { title: change.title }
            : { archived_at: change.archived ? new Date() : null }),
          state_version: sql`state_version + 1`,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return conversationView(db, updated);
    });
}
export async function listMessages(
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
        .selectFrom('conversation_messages')
        .selectAll()
        .where('conversation_id', '=', id);
      if (before !== undefined) query = query.where('sequence', '<', before);
      const rows = await query
        .orderBy('sequence', 'desc')
        .limit(limit + 1)
        .execute();
      const page = rows.slice(0, limit).reverse();
      return {
        messages: page.map(messageView),
        nextBeforeSequence: rows.length > limit ? page[0]!.sequence : null,
      };
    });
}
async function ownedRun(db: Tx, owner: string, id: string, lock = false) {
  const run = await db
    .selectFrom('agent_runs')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!run) throw notFound();
  if (!lock) return run;
  await ownedConversation(db, owner, run.conversation_id, true);
  return db
    .selectFrom('agent_runs')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirstOrThrow();
}
export async function getRun(owner: string, id: string) {
  return getDatabase()
    .transaction()
    .execute(async (db) => runView(await ownedRun(db, owner, id)));
}
export async function listEvents(owner: string, id: string, after: number, limit: number) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      await ownedRun(db, owner, id);
      const rows = await db
        .selectFrom('agent_run_events')
        .selectAll()
        .where('run_id', '=', id)
        .where('sequence', '>', after)
        .orderBy('sequence')
        .limit(limit + 1)
        .execute();
      const page = rows.slice(0, limit);
      return {
        events: page.map((row) => ({
          sequence: row.sequence,
          type: row.type,
          metadata: row.metadata as Record<string, unknown>,
          createdAt: iso(row.created_at)!,
        })),
        nextAfterSequence: rows.length > limit ? page.at(-1)!.sequence : null,
      };
    });
}
async function transition(
  db: Tx,
  row: Run,
  status: string,
  event: string,
  failure: string | null = null,
) {
  const terminal = ['completed', 'failed', 'cancelled'].includes(status);
  const updated = await db
    .updateTable('agent_runs')
    .set({
      status,
      failure_code: failure,
      ...(terminal ? { finished_at: new Date() } : {}),
      ...(status === 'running' ? { started_at: new Date() } : {}),
      ...(status === 'cancelling' || status === 'cancelled'
        ? { cancel_requested_at: row.cancel_requested_at ?? new Date() }
        : {}),
    })
    .where('id', '=', row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await appendEvent(db, row.id, event, failure ? { code: failure } : {});
  return updated;
}
export async function cancelRun(owner: string, id: string) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const run = await ownedRun(db, owner, id, true);
      if (run.status === 'queued')
        return runView(await transition(db, run, 'cancelled', 'cancelled'));
      if (run.status === 'running')
        return runView(await transition(db, run, 'cancelling', 'cancel_requested'));
      return runView(run);
    });
}

// Internal development executor. No browser route can call this or choose terminal state.
export async function tickTestRun(owner: string, id: string, now = Date.now()) {
  available();
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const run = await ownedRun(db, owner, id, true);
      if (!activeStatuses.some((status) => status === run.status)) return runView(run);
      if (now >= new Date(run.deadline_at).getTime())
        return runView(await transition(db, run, 'failed', 'failed', 'EXECUTION_TIMEOUT'));
      if (run.status === 'cancelling')
        return runView(await transition(db, run, 'cancelled', 'cancelled'));
      const conversation = await ownedConversation(db, owner, run.conversation_id);
      const context = await contextFor(db, conversation);
      try {
        targetMatches(context, ContextSchema.nullable().parse(run.context));
      } catch {
        return runView(await transition(db, run, 'failed', 'failed', 'STALE_CONTEXT'));
      }
      if (run.status === 'queued') return runView(await transition(db, run, 'running', 'started'));
      const message = await db
        .selectFrom('conversation_messages')
        .select('content')
        .where('id', '=', run.user_message_id)
        .executeTakeFirstOrThrow();
      const elapsed = now - new Date(run.started_at!).getTime();
      const slow = message.content.startsWith('/test slow');
      if (message.content.startsWith('/test timeout') || elapsed < (slow ? 15000 : 3000))
        return runView(run);
      if (message.content.startsWith('/test fail'))
        return runView(await transition(db, run, 'failed', 'failed', 'TEST_FAILURE'));
      await appendMessage(
        db,
        conversation,
        'assistant',
        'Test response — your message has been saved. This checks persistent chat only; no coaching model was called and no plan was changed. Real coaching arrives in Phase 5.',
        context,
        run.id,
      );
      return runView(await transition(db, run, 'completed', 'completed'));
    });
}

export async function sweepTestRuns() {
  available();
  const runs = await getDatabase()
    .selectFrom('agent_runs')
    .select(['id', 'owner_id'])
    .where('status', 'in', activeStatuses)
    .orderBy('deadline_at')
    .limit(100)
    .execute();
  for (const run of runs) await tickTestRun(run.owner_id, run.id);
}

// Used by plan lifecycle operations after taking their plan lock.
export { assertPlanIdle };
