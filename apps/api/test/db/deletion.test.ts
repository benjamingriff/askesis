import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, closeDatabase } from '../../src/database/client.js';
import { resetApiConfigForTests } from '../../src/config.js';
import {
  createConversation,
  getConversation,
  getRun,
  listConversations,
  listEvents,
} from '../../src/modules/chat/chat.service.js';
import {
  claimRun,
  executeTool,
  finishRun,
  registerWorker,
  runContext,
} from '../../src/modules/agent/agent.service.js';
import { PROMPT_VERSION } from '../../src/modules/agent/agent.schemas.js';
import { getOutput, getTurn, saveProgress } from '../../src/modules/live/live.service.js';
import { ProgressSchema } from '../../src/modules/live/live.schemas.js';
import {
  createPlan,
  deletePlan,
  deletionImpact,
  getPlan,
  listPlans,
  organizePlan,
  undeletePlan,
} from '../../src/modules/plans/plan.service.js';
import { cloneContent } from '../../src/modules/plans/plan.aggregate.js';
import { getBrief } from '../../src/modules/plans/brief.service.js';
import { emptyBrief } from '../../src/modules/plans/brief.schemas.js';
import { recordCalibration } from '../../src/modules/performance/performance.service.js';
import {
  createCheckInRows,
  logCommand,
  readTrainingLog,
} from '../../src/modules/training-log/training-log.service.js';
import { CheckInSchema } from '../../src/modules/training-log/training-log.schemas.js';
import { listWorkouts } from '../../src/modules/workouts/workout.repository.js';
import {
  cancelAccountDeletion,
  exportAccount,
  getAccount,
  replayDeletionEvents,
  ReplayGapError,
  requestAccountDeletion,
  runRetention,
  scheduleImmediatePurge,
} from '../../src/modules/account/account.service.js';
import {
  appendDeletion,
  parseDeletionLog,
  shipDeletions,
} from '../../src/modules/account/journal.js';
import { TABLE_RETENTION } from '../../src/modules/account/purge.js';

const db = getDatabase();
const DAY = 86_400_000;
const REPLY = 'Easing things back for two weeks.';
/** Full prescription content published by the development fixture. */
const FIXTURE_VERSION = '00000000-0000-0000-0000-000000000050';
const later = (days: number) => new Date(Date.now() + days * DAY);

beforeEach(async () => {
  process.env.CHAT_EXECUTION_MODE = 'agent';
  process.env.AGENT_BOOTSTRAP_TOKEN = 'deletion-test-bootstrap-token-32-characters';
  resetApiConfigForTests();
  await sql`UPDATE agent_runs SET status='failed',failure_code='TEST_CLEANUP',finished_at=now() WHERE status IN ('queued','running','cancelling')`.execute(
    db,
  );
});
afterAll(async () => {
  delete process.env.CHAT_EXECUTION_MODE;
  delete process.env.AGENT_BOOTSTRAP_TOKEN;
  resetApiConfigForTests();
  await closeDatabase();
});

async function athlete() {
  const id = randomUUID();
  const subject = `user_${randomUUID()}`;
  await db
    .insertInto('athletes')
    .values({ id, display_name: 'Deletion tests', timezone: 'Europe/London' })
    .execute();
  await db
    .insertInto('athlete_identities')
    .values({ athlete_id: id, provider: 'clerk', provider_subject: subject })
    .execute();
  await recordCalibration(id, {
    system: 'run_pace',
    input: { method: 'threshold_pace', secondsPerKilometre: 300 },
    provenance: 'user_estimate',
    estimateBasis: 'Synthetic test estimate.',
  });
  return { id, subject };
}

async function worker() {
  const id = randomUUID();
  await registerWorker({
    id,
    provider: 'openai',
    model: 'gpt-6.1-sol',
    reasoning: 'medium',
    promptVersion: PROMPT_VERSION,
    promptHash: 'a'.repeat(64),
    ready: true,
  });
  return id;
}

/**
 * A completed coaching run: a brief edit, a calibration, a training-log read, streamed output
 * and a reply.
 */
async function coachedRun(owner: string, planId: string | null) {
  const workerId = await worker();
  const plan = planId ? await getPlan(owner, planId) : null;
  const created = await createConversation(
    owner,
    {
      ...(planId ? { planId } : {}),
      initialMessage: {
        content: 'My calf has been sore since the race. Can you adjust things?',
        target: plan ? { versionId: plan.draft!.id, editNumber: plan.draft!.editNumber } : null,
      },
    },
    randomUUID(),
  );
  const claim = (await claimRun(workerId)).claim!;
  expect(claim.runId).toBe(created.accepted!.run.id);
  const tool = async (name: string, input: unknown) => {
    const context = await runContext(claim.runId, claim.token);
    return executeTool(claim.runId, claim.token, {
      operationId: randomUUID(),
      name,
      input,
      expectedVersionId: context.versionId,
      expectedEditNumber: context.editNumber,
    });
  };
  if (planId)
    await tool('update_plan_brief', {
      brief: { ...emptyBrief(), goal: 'Return from a calf strain' },
      startDate: '2027-01-01',
      endDate: '2027-03-31',
      description: 'Rebuild',
    });
  await tool('record_performance', {
    system: 'run_pace',
    input: { method: 'threshold_pace', secondsPerKilometre: 310 },
    provenance: 'agent_estimate',
    estimateBasis: 'Adjusted for the calf strain.',
    observedOn: null,
  });
  // Reads every plan's log, so this run's receipt can hold another plan's health data.
  await tool('read_training_log', { from: '2027-01-01', to: '2027-01-31' });
  await saveProgress(
    claim.runId,
    claim.token,
    ProgressSchema.parse({
      sequence: 1,
      items: [{ itemId: 'reply', position: 0, content: REPLY, revision: 1 }],
    }),
  );
  await finishRun(claim.runId, claim.token, {
    status: 'completed',
    content: REPLY,
    finalOutputItemId: 'reply',
    inputTokens: 120,
    outputTokens: 40,
  });
  return { conversationId: created.conversation.id, runId: claim.runId };
}

async function logSession(owner: string, planId: string, versionId: string, runId?: string) {
  await db
    .insertInto('workout_logs')
    .values({
      athlete_id: owner,
      plan_id: planId,
      workout_lineage_id: randomUUID(),
      logged_version_id: versionId,
      scheduled_on: '2027-01-02',
      title: 'Easy run',
      discipline: 'run',
      key_session: false,
      status: 'done',
      performed_on: '2027-01-02',
      rpe: 4,
      note: 'Calf tight at the end.',
      recorded_by_run_id: runId ?? null,
    })
    .execute();
}

/** A plan with a logged session, a check-in and a coaching conversation that read them. */
async function populatedPlan(owner: string) {
  const plan = await createPlan(owner, `Plan ${randomUUID().slice(0, 8)}`, randomUUID(), {
    startDate: '2027-01-01',
    endDate: '2027-03-31',
  });
  await logSession(owner, plan.id, plan.draft!.id);
  const checkInKey = randomUUID();
  const checkIn = {
    planId: plan.id,
    kind: 'pain' as const,
    startsOn: '2026-10-01',
    endsOn: null,
    details: { preference: 'easy' as const, returnStyle: 'gently' as const, note: 'Sore calf.' },
  };
  await logCommand(owner, 'check-in.create', checkInKey, checkIn, CheckInSchema, plan.id, (tx) =>
    createCheckInRows(tx, owner, checkIn),
  );
  const run = await coachedRun(owner, plan.id);
  return { planId: plan.id, versionId: plan.draft!.id, checkIn, checkInKey, ...run };
}

async function calibrationCount(owner: string) {
  const row = await db
    .selectFrom('athlete_calibrations')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('athlete_id', '=', owner)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** The journal entries recorded for a subject, oldest first. */
async function journal(subjectId: string) {
  const rows = await db
    .selectFrom('deletion_journal')
    .select('event')
    .where('subject_id', '=', subjectId)
    .orderBy('sequence')
    .execute();
  return rows.map((row) => row.event);
}

async function publicTables() {
  const tables = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`.execute(db);
  return tables.rows.map((row) => row.table_name);
}

async function tableCounts() {
  const counts: Record<string, number> = {};
  for (const table of await publicTables()) {
    const result = await sql<{
      count: string;
    }>`SELECT count(*) FROM ${sql.table(table)}`.execute(db);
    counts[table] = Number(result.rows[0]!.count);
  }
  return counts;
}

/** Every table and uuid column that still names one of the ids. */
async function rowsReferencing(columns: string[], ids: string[]) {
  const found = await sql<{ table_name: string; column_name: string }>`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.column_name = ANY(${columns}::text[]) AND c.data_type = 'uuid'`.execute(db);
  const hits: string[] = [];
  for (const { table_name, column_name } of found.rows) {
    if (table_name === 'deletion_journal') continue;
    const result = await sql<{ count: string }>`
      SELECT count(*) FROM ${sql.table(table_name)}
      WHERE ${sql.ref(column_name)} = ANY(${ids}::uuid[])`.execute(db);
    if (Number(result.rows[0]!.count) > 0) hits.push(`${table_name}.${column_name}`);
  }
  return hits;
}

/** Any JSON column that still mentions one of the ids, such as a tool result or event. */
async function jsonMentioning(ids: string[]) {
  const found = await sql<{ table_name: string; column_name: string }>`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = 'jsonb'`.execute(
    db,
  );
  const hits: string[] = [];
  for (const { table_name, column_name } of found.rows) {
    for (const id of ids) {
      const result = await sql<{ count: string }>`
        SELECT count(*) FROM ${sql.table(table_name)}
        WHERE strpos(${sql.ref(column_name)}::text, ${id}) > 0`.execute(db);
      if (Number(result.rows[0]!.count) > 0) hits.push(`${table_name}.${column_name}`);
    }
  }
  return hits;
}

it('classifies every table for deletion', async () => {
  expect((await publicTables()).filter((table) => !(table in TABLE_RETENTION))).toEqual([]);
});

describe('plan deletion', () => {
  it('hides a deleted plan everywhere, restores it to the archive, and purges after 30 days', async () => {
    const { id: owner } = await athlete();
    const doomed = await populatedPlan(owner);
    // Created second, so its coach's training-log read includes the doomed plan's log.
    const kept = await populatedPlan(owner);
    const plan = await getPlan(owner, doomed.planId);
    const createKey = randomUUID();
    const replayed = await createPlan(owner, 'Replay check', createKey);

    expect(await deletionImpact(owner, doomed.planId)).toMatchObject({
      conversations: 1,
      messages: 2,
      workoutLogs: 1,
      checkIns: 1,
      restoreDays: 30,
    });
    const calibrationsBefore = await calibrationCount(owner);
    const deleted = await deletePlan(owner, doomed.planId, plan.stateVersion);
    await deletePlan(owner, replayed.id, replayed.stateVersion);
    expect(deleted).toMatchObject({ archived: true, active: false });
    expect(Date.parse(deleted.purgeAfter!) - Date.parse(deleted.deletedAt!)).toBe(30 * DAY);

    // Every read path treats the plan, its conversation, runs and log as gone.
    const gone = { status: 404 };
    await expect(getPlan(owner, doomed.planId)).rejects.toMatchObject(gone);
    await expect(getBrief(owner, doomed.planId)).rejects.toMatchObject(gone);
    await expect(getConversation(owner, doomed.conversationId)).rejects.toMatchObject(gone);
    await expect(getRun(owner, doomed.runId)).rejects.toMatchObject(gone);
    await expect(listEvents(owner, doomed.runId, 0, 50)).rejects.toMatchObject(gone);
    await expect(getOutput(owner, doomed.runId)).rejects.toMatchObject(gone);
    await expect(getTurn(owner, doomed.runId)).rejects.toMatchObject(gone);
    expect(await listWorkouts(owner, plan.draft!.id)).toEqual([]);
    for (const collection of ['library', 'archive'] as const)
      expect((await listPlans(owner, collection)).map((p) => p.id)).not.toContain(doomed.planId);
    expect((await listPlans(owner, 'deleted')).map((p) => p.id)).toEqual(
      expect.arrayContaining([doomed.planId, replayed.id]),
    );
    for (const collection of ['open', 'archive'] as const) {
      const page = await listConversations(owner, { collection, limit: 50 });
      expect(page.conversations.map((c) => c.id)).not.toContain(doomed.conversationId);
    }
    const log = await readTrainingLog(db, owner);
    expect(log.logs.map((l) => l.planId)).toEqual([kept.planId]);
    expect(log.checkIns.map((c) => c.planId)).toEqual([kept.planId]);
    await expect(
      organizePlan(owner, doomed.planId, 'unarchive', deleted.stateVersion),
    ).rejects.toMatchObject(gone);

    // Retrying an earlier command cannot replay a deleted plan's data.
    await expect(createPlan(owner, 'Replay check', createKey)).rejects.toMatchObject(gone);
    await expect(
      logCommand(
        owner,
        'check-in.create',
        doomed.checkInKey,
        doomed.checkIn,
        CheckInSchema,
        doomed.planId,
        (tx) => createCheckInRows(tx, owner, doomed.checkIn),
      ),
    ).rejects.toMatchObject(gone);

    // Restoring returns the plan to the archive with its history and replays intact.
    const restored = await undeletePlan(owner, doomed.planId);
    expect(restored).toMatchObject({ archived: true, deletedAt: null });
    expect((await listPlans(owner, 'archive')).map((p) => p.id)).toContain(doomed.planId);
    expect((await getConversation(owner, doomed.conversationId)).id).toBe(doomed.conversationId);
    await undeletePlan(owner, replayed.id);
    expect((await createPlan(owner, 'Replay check', createKey)).id).toBe(replayed.id);

    const again = await deletePlan(owner, doomed.planId, restored.stateVersion);
    const versions = (
      await db
        .selectFrom('plan_versions')
        .select('id')
        .where('plan_id', '=', doomed.planId)
        .execute()
    ).map((v) => v.id);

    // Within the window nothing is purged.
    await runRetention({ now: later(29) });
    expect((await listPlans(owner, 'deleted')).map((p) => p.id)).toEqual([doomed.planId]);

    const rollupsBefore = await db
      .selectFrom('agent_usage_rollups')
      .select(({ fn }) => fn.sum<string>('runs').as('runs'))
      .executeTakeFirstOrThrow();
    const result = await runRetention({
      now: new Date(Date.parse(again.deletedAt!) + 30 * DAY + 1),
    });
    expect(result.plans).toBeGreaterThanOrEqual(1);

    const ids = [doomed.planId, ...versions, doomed.conversationId, doomed.runId];
    expect(
      await rowsReferencing(
        [
          'plan_id',
          'execution_plan_id',
          'plan_version_id',
          'logged_version_id',
          'execution_version_id',
          'target_version_id',
          'conversation_id',
          'run_id',
          'recorded_by_run_id',
          'retracted_by_run_id',
          'producing_run_id',
          'resource_id',
        ],
        ids,
      ),
    ).toEqual([]);
    // The kept plan's coach read the deleted plan's log; that copy is redacted, not kept.
    expect(await jsonMentioning(ids)).toEqual([]);
    const receipts = await db
      .selectFrom('agent_tool_receipts')
      .select(['tool_name', 'response'])
      .where('run_id', '=', kept.runId)
      .execute();
    expect(receipts.find((r) => r.tool_name === 'read_training_log')?.response).toEqual({
      redacted: 'A plan in this result was deleted.',
    });
    expect(receipts.find((r) => r.tool_name === 'update_plan_brief')?.response).not.toHaveProperty(
      'redacted',
    );
    // Athlete-owned calibrations recorded in that chat survive, without their run.
    expect(await calibrationCount(owner)).toBe(calibrationsBefore);
    // The other plan is untouched, and usage of the purged run is kept anonymously.
    expect((await getPlan(owner, kept.planId)).id).toBe(kept.planId);
    expect((await getConversation(owner, kept.conversationId)).id).toBe(kept.conversationId);
    expect((await readTrainingLog(db, owner, { planId: kept.planId })).logs).toHaveLength(1);
    const rollupsAfter = await db
      .selectFrom('agent_usage_rollups')
      .select(({ fn }) => fn.sum<string>('runs').as('runs'))
      .executeTakeFirstOrThrow();
    // Other tests' expired deletions may be purged in the same pass.
    expect(Number(rollupsAfter.runs) - Number(rollupsBefore.runs ?? 0)).toBeGreaterThanOrEqual(1);
    expect(await journal(doomed.planId)).toEqual([
      'plan.deleted',
      'plan.restored',
      'plan.deleted',
      'plan.purged',
    ]);
  });

  it('refuses to restore a plan once its 30 days are up, even before the purge', async () => {
    const { id: owner } = await athlete();
    const plan = await createPlan(owner, 'Window', randomUUID());
    const deletedAt = new Date();
    const window = 30 * DAY;
    let deleted = await deletePlan(owner, plan.id, plan.stateVersion, deletedAt);
    const restored = await undeletePlan(owner, plan.id, new Date(deletedAt.getTime() + window - 1));
    expect(restored.deletedAt).toBeNull();
    deleted = await deletePlan(owner, plan.id, restored.stateVersion, deletedAt);
    for (const offset of [window, window + 1])
      await expect(
        undeletePlan(owner, plan.id, new Date(deletedAt.getTime() + offset)),
      ).rejects.toMatchObject({ status: 404 });
    expect(deleted.deletedAt).toBe(deletedAt.toISOString());
    // Still present, but no longer offered for restoring.
    expect(
      await db.selectFrom('plans').select('id').where('id', '=', plan.id).execute(),
    ).toHaveLength(1);
    const listed = async (offset: number) =>
      (await listPlans(owner, 'deleted', new Date(deletedAt.getTime() + offset))).map((p) => p.id);
    expect(await listed(window - 1)).toContain(plan.id);
    expect(await listed(window)).not.toContain(plan.id);
  });

  it('refuses to delete a plan while its coach is working', async () => {
    const { id: owner } = await athlete();
    const plan = await createPlan(owner, 'Busy plan', randomUUID());
    await createConversation(
      owner,
      {
        planId: plan.id,
        initialMessage: {
          content: 'Plan my week',
          target: { versionId: plan.draft!.id, editNumber: plan.draft!.editNumber },
        },
      },
      randomUUID(),
    );
    await expect(deletePlan(owner, plan.id, plan.stateVersion)).rejects.toMatchObject({
      code: 'RUN_ACTIVE',
    });
  });

  it('keeps history guards in force outside a purge', async () => {
    const { id: owner } = await athlete();
    const { conversationId, runId } = await coachedRun(owner, null);
    await expect(
      db
        .deleteFrom('conversation_messages')
        .where('conversation_id', '=', conversationId)
        .execute(),
    ).rejects.toThrow(/append-only/);
    await expect(db.deleteFrom('agent_runs').where('id', '=', runId).execute()).rejects.toThrow(
      /retained/,
    );
    await expect(
      db.deleteFrom('athlete_calibrations').where('athlete_id', '=', owner).execute(),
    ).rejects.toThrow(/retained/);
    await expect(
      db
        .updateTable('agent_tool_receipts')
        .set({ response: JSON.stringify({}) })
        .where('run_id', '=', runId)
        .execute(),
    ).rejects.toThrow(/append-only/);
    // The flag is transaction-local: setting it in one transaction does not leak to the next.
    await db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('askesis.purge', 'on', true)`.execute(tx);
    });
    await expect(
      db.deleteFrom('agent_run_events').where('run_id', '=', runId).execute(),
    ).rejects.toThrow(/append-only/);
  });
});

describe('account deletion', () => {
  it('waits out the grace period, deletes sign-in first, then removes every row', async () => {
    const other = await athlete();
    const otherPlan = await populatedPlan(other.id);
    const before = await tableCounts();
    const { id: owner, subject } = await athlete();
    const { planId } = await populatedPlan(owner);
    await coachedRun(owner, null);
    await deletePlan(owner, planId, (await getPlan(owner, planId)).stateVersion);
    await populatedPlan(owner);
    // Fill every remaining table the account owns, so none can escape the purge unnoticed.
    const content = await createPlan(owner, 'Full content', randomUUID(), {
      startDate: '2026-05-11',
      endDate: '2026-10-04',
    });
    await db.transaction().execute(async (tx) => {
      await cloneContent(tx, FIXTURE_VERSION, content.draft!.id);
      await tx
        .insertInto('plan_schedule_coverage')
        .values({
          plan_version_id: content.draft!.id,
          start_date: '2026-05-11',
          end_date: '2026-05-17',
          brief_hash: 'a'.repeat(64),
        })
        .execute();
      await tx
        .insertInto('example_plan_editions')
        .values({
          owner_id: owner,
          blueprint_revision: 'deletion-test',
          anchor_date: '2026-05-11',
          plan_id: content.id,
          published_state_version: 1,
          published_content_hash: 'a'.repeat(64),
        })
        .execute();
      const run = await tx
        .selectFrom('agent_runs')
        .select('id')
        .where('owner_id', '=', owner)
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('agent_run_measurements')
        .values({ run_id: run.id, timings: JSON.stringify({ firstOutputMs: 900 }) })
        .execute();
    });
    const populated = await tableCounts();
    const unpopulated = Object.entries(TABLE_RETENTION)
      .filter(([table, retention]) => retention !== 'kept' && populated[table]! <= before[table]!)
      .map(([table]) => table);
    expect(unpopulated).toEqual([]);

    const exported = await exportAccount(owner);
    expect(exported.plans).toHaveLength(3);
    expect(exported.conversations).toHaveLength(3);
    expect(exported.trainingLog).toHaveLength(2);
    expect(exported.calibrations).toHaveLength(await calibrationCount(owner));
    expect(JSON.stringify(exported)).toContain('Calf tight at the end.');

    const requested = await requestAccountDeletion(owner);
    expect(requested.deletion).not.toBeNull();
    expect(
      Date.parse(requested.deletion!.purgeAfter) - Date.parse(requested.deletion!.requestedAt),
    ).toBe(7 * DAY);
    expect((await cancelAccountDeletion(owner)).deletion).toBeNull();
    await requestAccountDeletion(owner);

    const deleted: string[] = [];
    const deleteIdentity = async (clerkUserId: string) => {
      // The athlete still exists when sign-in is removed.
      expect(
        await db.selectFrom('athletes').select('id').where('id', '=', owner).executeTakeFirst(),
      ).toBeDefined();
      deleted.push(clerkUserId);
    };
    expect((await runRetention({ now: later(6), deleteIdentity })).accounts).toBe(0);
    expect(deleted).toEqual([]);

    // A failed identity deletion leaves the data in place and closes cancellation.
    const failing = async () => {
      throw new Error('Clerk unavailable');
    };
    expect((await runRetention({ now: later(8), deleteIdentity: failing })).accounts).toBe(0);
    await expect(cancelAccountDeletion(owner)).rejects.toMatchObject({
      code: 'ACCOUNT_PURGE_STARTED',
    });
    expect((await getAccount(owner)).deletion).not.toBeNull();

    expect((await runRetention({ now: later(8), deleteIdentity })).accounts).toBe(1);
    expect(deleted).toEqual([subject]);

    const after = await tableCounts();
    const changed = Object.keys(after).filter(
      (table) =>
        after[table] !== before[table] &&
        // Anonymous usage, the deletion ledger and workers are kept on purpose; the pass
        // also pruned other tests' week-old command records and journal events.
        ![
          'agent_usage_rollups',
          'deletion_journal',
          'deletion_journal_head',
          'agent_workers',
          'api_idempotency_keys',
          'live_events',
        ].includes(table),
    );
    expect(changed).toEqual([]);
    expect(await rowsReferencing(['athlete_id', 'owner_id'], [owner])).toEqual([]);
    expect(await jsonMentioning([owner])).toEqual([]);
    // Another athlete's data is untouched.
    expect((await getPlan(other.id, otherPlan.planId)).id).toBe(otherPlan.planId);
    expect((await readTrainingLog(db, other.id)).logs).toHaveLength(1);
    expect(await journal(owner)).toEqual([
      'account.deletion_requested',
      'account.deletion_cancelled',
      'account.deletion_requested',
      'account.purged',
    ]);
  });

  it('fences coaching once deletion is requested', async () => {
    const { id: owner } = await athlete();
    const created = await createConversation(
      owner,
      { initialMessage: { content: 'Are you there?', target: null } },
      randomUUID(),
    );
    await requestAccountDeletion(owner);
    const status = async (id: string) =>
      (
        await db
          .selectFrom('agent_runs')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).status;
    expect(await status(created.accepted!.run.id)).toBe('cancelled');
    // A request admitted before the marker cannot start a run after it.
    await expect(
      createConversation(
        owner,
        { initialMessage: { content: 'One more thing', target: null } },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_PENDING' });
  });

  it.each([
    ['a deletion request', (owner: string) => requestAccountDeletion(owner)],
    ['the Clerk webhook', (owner: string, subject: string) => scheduleImmediatePurge(subject)],
  ])('does not deadlock %s against a coaching tool holding a run', async (_name, request) => {
    const { id: owner, subject } = await athlete();
    const created = await createConversation(
      owner,
      { initialMessage: { content: 'Record my new threshold', target: null } },
      randomUUID(),
    );
    const runId = created.accepted!.run.id;
    let locked!: () => void, release!: () => void;
    const runLocked = new Promise<void>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    // A tool locks its run first and the athlete later, as recording a calibration does.
    const tool = db.transaction().execute(async (tx) => {
      await tx.selectFrom('agent_runs').select('id').where('id', '=', runId).forUpdate().execute();
      locked();
      await released;
      await tx.selectFrom('athletes').select('id').where('id', '=', owner).forUpdate().execute();
    });
    await runLocked;
    const deletion = request(owner, subject);
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await Promise.all([tool, deletion]);
    expect((await getAccount(owner)).deletion).not.toBeNull();
    expect(
      (
        await db
          .selectFrom('agent_runs')
          .select('status')
          .where('id', '=', runId)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('cancelled');
  });

  it('does not let a worker claim a run whose account is being deleted', async () => {
    const { id: owner } = await athlete();
    const created = await createConversation(
      owner,
      { initialMessage: { content: 'Queued before deletion', target: null } },
      randomUUID(),
    );
    // As if the run committed just after the deletion request's cancellation pass.
    await sql`UPDATE athletes SET deletion_requested_at = now(), purge_after = now() + interval '7 days'
      WHERE id = ${owner}::uuid`.execute(db);
    const workerId = await worker();
    expect((await claimRun(workerId)).claim).toBeNull();
    expect(
      (
        await db
          .selectFrom('agent_runs')
          .select('status')
          .where('id', '=', created.accepted!.run.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('cancelled');
  });
});

describe('deletion journal', () => {
  const head = async () =>
    Number(
      (await db.selectFrom('deletion_journal_head').select('sequence').executeTakeFirstOrThrow())
        .sequence,
    );
  const shipped = (sequence: number, event: string, subjectId: string) =>
    JSON.stringify({
      level: 30,
      deletion: { sequence, event, subjectId, at: new Date().toISOString() },
    });

  it('replays shipped entries onto a restored backup, in sequence order, once each', async () => {
    const { id: owner } = await athlete();
    const purged = await populatedPlan(owner);
    const soft = await createPlan(owner, 'Deleted after the backup', randomUUID());
    // This database plays the restored backup: neither deletion happened in it yet.
    const from = (await head()) + 1;
    const log = [
      shipped(from + 2, 'plan.deleted', soft.id),
      shipped(from + 1, 'plan.purged', purged.planId),
      shipped(from, 'plan.deleted', purged.planId),
      shipped(from + 1, 'plan.purged', purged.planId),
    ].join('\n');
    expect(await replayDeletionEvents(parseDeletionLog(log))).toEqual({
      from,
      to: from + 2,
      applied: 3,
    });
    expect(await rowsReferencing(['plan_id'], [purged.planId])).toEqual([]);
    expect((await listPlans(owner, 'deleted')).map((p) => p.id)).toEqual([soft.id]);
    // The journal continues from the replayed entries, already shipped.
    expect(await head()).toBe(from + 2);
    expect(await journal(purged.planId)).toEqual(['plan.deleted', 'plan.purged']);
    // Running it again changes nothing.
    expect((await replayDeletionEvents(parseDeletionLog(log))).applied).toBe(0);

    const accountFrom = (await head()) + 1;
    await replayDeletionEvents(
      parseDeletionLog(
        [
          shipped(accountFrom, 'account.deletion_requested', owner),
          shipped(accountFrom + 1, 'account.purged', owner),
        ].join('\n'),
      ),
    );
    expect(await rowsReferencing(['athlete_id', 'owner_id'], [owner])).toEqual([]);
  });

  it('refuses a replay with missing entries unless the loss is accepted', async () => {
    const { id: owner } = await athlete();
    const plan = await createPlan(owner, 'Gap', randomUUID());
    const from = (await head()) + 1;
    const events = parseDeletionLog(
      [shipped(from, 'plan.deleted', plan.id), shipped(from + 2, 'plan.purged', plan.id)].join(
        '\n',
      ),
    );
    await expect(replayDeletionEvents(events)).rejects.toBeInstanceOf(ReplayGapError);
    expect((await getPlan(owner, plan.id)).deletedAt).toBeNull();
    expect(await head()).toBe(from - 1);
    expect((await replayDeletionEvents(events, { allowGaps: true })).applied).toBe(2);
    expect(await db.selectFrom('plans').select('id').where('id', '=', plan.id).execute()).toEqual(
      [],
    );
  });

  it('ships entries left behind by a crash after commit', async () => {
    const { id: owner } = await athlete();
    await db
      .transaction()
      .execute((tx) => appendDeletion(tx, 'account.deletion_requested', owner, new Date()));
    await shipDeletions();
    const rows = await db
      .selectFrom('deletion_journal')
      .select('shipped_at')
      .where('subject_id', '=', owner)
      .execute();
    expect(rows.map((row) => row.shipped_at !== null)).toEqual([true]);
  });
});

it('prunes week-old command records and journal events', async () => {
  const { id: owner } = await athlete();
  await createPlan(owner, 'Idempotent plan', randomUUID());
  const count = async (table: 'api_idempotency_keys' | 'live_events') =>
    Number(
      (
        await db
          .selectFrom(table)
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where(table === 'live_events' ? 'owner_id' : 'athlete_id', '=', owner)
          .executeTakeFirstOrThrow()
      ).count,
    );
  expect(await count('api_idempotency_keys')).toBe(1);
  expect(await count('live_events')).toBeGreaterThan(0);
  await runRetention({ now: later(6) });
  expect(await count('api_idempotency_keys')).toBe(1);
  await runRetention({ now: later(8) });
  expect(await count('api_idempotency_keys')).toBe(0);
  expect(await count('live_events')).toBe(0);
});
