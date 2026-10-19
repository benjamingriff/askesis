import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/generated.js';
import { contentTables } from '../plans/plan.aggregate.js';

/**
 * The only hard deletion of retained history. Every new table needs a classification here and,
 * unless it holds no personal data, a purge step; the purge completeness test enforces both.
 */
type Tx = Transaction<DB>;
type Retention = 'account' | 'plan' | 'conversation' | 'kept';
export const TABLE_RETENTION = {
  athletes: 'account',
  athlete_identities: 'account',
  athlete_calibrations: 'account',
  athlete_calibration_zones: 'account',
  api_idempotency_keys: 'account',
  live_event_heads: 'account',
  live_events: 'account',
  plans: 'plan',
  plan_versions: 'plan',
  ...Object.fromEntries(contentTables.map((table) => [table, 'plan' as const])),
  workout_logs: 'plan',
  athlete_check_ins: 'plan',
  example_plan_editions: 'plan',
  conversations: 'conversation',
  conversation_messages: 'conversation',
  agent_runs: 'conversation',
  agent_run_events: 'conversation',
  agent_tool_receipts: 'conversation',
  agent_tool_changes: 'conversation',
  agent_run_outputs: 'conversation',
  agent_progress_batches: 'conversation',
  agent_run_measurements: 'conversation',
  agent_run_finishes: 'conversation',
  // No personal data: anonymous usage, the deletion ledger, workers and shared vocabularies.
  agent_usage_rollups: 'kept',
  data_deletions: 'kept',
  agent_workers: 'kept',
  movement_definitions: 'kept',
  seed_runs: 'kept',
} satisfies Partial<Record<keyof DB, Retention>>;

/** One array parameter, however many ids a long-lived plan has accumulated. */
const anyOf = (column: string, ids: string[]) =>
  sql<boolean>`${sql.ref(column)} = ANY(${ids}::uuid[])`;

/** History guards allow DELETE only while this transaction-local flag is on. */
async function purging<T>(db: Tx, work: () => Promise<T>): Promise<T> {
  await sql`SELECT set_config('askesis.purge', 'on', true)`.execute(db);
  const result = await work();
  // A failed purge aborts the transaction, which discards the flag with it.
  await sql`SELECT set_config('askesis.purge', 'off', true)`.execute(db);
  return result;
}

/** Conversations with their messages, runs and every record a run produced. */
async function purgeConversations(db: Tx, conversationIds: string[]) {
  if (conversationIds.length === 0) return [];
  const runs = await db
    .selectFrom('agent_runs')
    .select('id')
    .where(anyOf('conversation_id', conversationIds))
    .execute();
  const runIds = runs.map((run) => run.id);
  if (runIds.length > 0) {
    // Usage outlives the runs, without identifiers or text.
    await sql`
      INSERT INTO agent_usage_rollups AS r
        (day, provider, model, prompt_version, status, runs, input_tokens, output_tokens, tool_calls)
      SELECT (created_at AT TIME ZONE 'UTC')::date, coalesce(provider, ''), coalesce(model, ''),
        coalesce(prompt_version, ''), status, count(*), coalesce(sum(input_tokens), 0),
        coalesce(sum(output_tokens), 0), coalesce(sum(tool_count), 0)
      FROM agent_runs WHERE id = ANY(${runIds}::uuid[])
      GROUP BY 1, 2, 3, 4, 5
      ON CONFLICT (day, provider, model, prompt_version, status) DO UPDATE SET
        runs = r.runs + excluded.runs,
        input_tokens = r.input_tokens + excluded.input_tokens,
        output_tokens = r.output_tokens + excluded.output_tokens,
        tool_calls = r.tool_calls + excluded.tool_calls`.execute(db);
    // Calibrations and logs recorded by these runs can belong to data that survives.
    await db
      .updateTable('athlete_calibrations')
      .set({ recorded_by_run_id: null })
      .where(anyOf('recorded_by_run_id', runIds))
      .execute();
    await db
      .updateTable('athlete_calibrations')
      .set({ retracted_by_run_id: null })
      .where(anyOf('retracted_by_run_id', runIds))
      .execute();
    await db
      .updateTable('workout_logs')
      .set({ recorded_by_run_id: null })
      .where(anyOf('recorded_by_run_id', runIds))
      .execute();
    for (const table of [
      'agent_tool_changes',
      'agent_tool_receipts',
      'agent_run_events',
      'agent_run_outputs',
      'agent_progress_batches',
      'agent_run_measurements',
      'agent_run_finishes',
    ] as const) {
      await db.deleteFrom(table).where(anyOf('run_id', runIds)).execute();
    }
  }
  // Messages and runs reference each other, so they go in one statement.
  await sql`
    WITH messages AS (
      DELETE FROM conversation_messages WHERE conversation_id = ANY(${conversationIds}::uuid[])
    )
    DELETE FROM agent_runs WHERE conversation_id = ANY(${conversationIds}::uuid[])`.execute(db);
  await db.deleteFrom('conversations').where(anyOf('id', conversationIds)).execute();
  return runIds;
}

async function purgePlanContent(db: Tx, owner: string, planId: string, account = false) {
  const conversations = await db
    .selectFrom('conversations')
    .select('id')
    .where('plan_id', '=', planId)
    .execute();
  const conversationIds = conversations.map((row) => row.id);
  const runIds = await purgeConversations(db, conversationIds);
  await db.deleteFrom('workout_logs').where('plan_id', '=', planId).execute();
  await db.deleteFrom('athlete_check_ins').where('plan_id', '=', planId).execute();
  await db.deleteFrom('example_plan_editions').where('plan_id', '=', planId).execute();
  await db.deleteFrom('api_idempotency_keys').where('plan_id', '=', planId).execute();
  if (!account) {
    // Tools in the athlete's other conversations can return this plan's logs and check-ins,
    // or name its conversations. Results are only replayed within their run, so they are
    // redacted rather than kept.
    const named = [planId, ...conversationIds, ...runIds];
    await sql`
      UPDATE agent_tool_receipts SET response = ${JSON.stringify({ redacted: 'A plan in this result was deleted.' })}::jsonb
      WHERE run_id IN (SELECT id FROM agent_runs WHERE owner_id = ${owner}::uuid)
        AND EXISTS (SELECT 1 FROM unnest(${named}::text[]) AS id WHERE strpos(response::text, id) > 0)`.execute(
      db,
    );
  }
  const versions = db.selectFrom('plan_versions').select('id').where('plan_id', '=', planId);
  for (const table of [...contentTables].reverse()) {
    await sql`DELETE FROM ${sql.table(table)} WHERE plan_version_id IN (${versions})`.execute(db);
  }
  await db.deleteFrom('plan_versions').where('plan_id', '=', planId).execute();
  await db.deleteFrom('plans').where('id', '=', planId).execute();
  const resources = [planId, ...conversationIds, ...runIds];
  await db
    .deleteFrom('live_events')
    .where('owner_id', '=', owner)
    .where(anyOf('resource_id', resources))
    .execute();
}

/**
 * Removes a deleted plan with its conversations, training log and check-ins. Replaying a
 * recorded purge onto a restored backup passes `requestedAt`, as the plan may predate deletion.
 */
export async function purgePlanRows(db: Tx, planId: string, requestedAt?: Date) {
  const plan = await db
    .selectFrom('plans')
    .select(['owner_id', 'deleted_at'])
    .where('id', '=', planId)
    .forUpdate()
    .executeTakeFirst();
  const deletedAt = plan?.deleted_at ?? requestedAt;
  if (!plan || !deletedAt) return false;
  await purging(db, () => purgePlanContent(db, plan.owner_id, planId));
  await db
    .insertInto('data_deletions')
    .values({ kind: 'plan', subject_id: planId, requested_at: deletedAt })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return true;
}

/** Removes everything the athlete owns, then the athlete. */
export async function purgeAccountRows(db: Tx, athleteId: string, requestedAt?: Date) {
  const athlete = await db
    .selectFrom('athletes')
    .select(['id', 'deletion_requested_at'])
    .where('id', '=', athleteId)
    .forUpdate()
    .executeTakeFirst();
  const deletionRequestedAt = athlete?.deletion_requested_at ?? requestedAt;
  if (!athlete || !deletionRequestedAt) return false;
  await purging(db, async () => {
    const plans = await db
      .selectFrom('plans')
      .select('id')
      .where('owner_id', '=', athleteId)
      .execute();
    for (const plan of plans) await purgePlanContent(db, athleteId, plan.id, true);
    const conversations = await db
      .selectFrom('conversations')
      .select('id')
      .where('owner_id', '=', athleteId)
      .execute();
    await purgeConversations(
      db,
      conversations.map((row) => row.id),
    );
    await db.deleteFrom('workout_logs').where('athlete_id', '=', athleteId).execute();
    await db.deleteFrom('athlete_check_ins').where('athlete_id', '=', athleteId).execute();
    await db
      .deleteFrom('athlete_calibration_zones')
      .where(
        'calibration_id',
        'in',
        db.selectFrom('athlete_calibrations').select('id').where('athlete_id', '=', athleteId),
      )
      .execute();
    await db.deleteFrom('athlete_calibrations').where('athlete_id', '=', athleteId).execute();
    await db.deleteFrom('api_idempotency_keys').where('athlete_id', '=', athleteId).execute();
    await db.deleteFrom('example_plan_editions').where('owner_id', '=', athleteId).execute();
    await db.deleteFrom('live_events').where('owner_id', '=', athleteId).execute();
    await db.deleteFrom('live_event_heads').where('owner_id', '=', athleteId).execute();
    await db.deleteFrom('athlete_identities').where('athlete_id', '=', athleteId).execute();
    await db.deleteFrom('athletes').where('id', '=', athleteId).execute();
  });
  await db
    .insertInto('data_deletions')
    .values({
      kind: 'account',
      subject_id: athleteId,
      requested_at: deletionRequestedAt,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return true;
}
