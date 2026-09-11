import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'kysely';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import { resetApiConfigForTests } from '../../src/config.js';
import { cloneContent } from '../../src/modules/plans/plan.aggregate.js';
import { getBrief, confirmBrief } from '../../src/modules/plans/brief.service.js';
import {
  cancelRun,
  changeConversation,
  createConversation,
  getConversation,
  getRun,
  listConversations,
  listEvents,
  listMessages,
  openPlanConversation,
  sendMessage,
  tickTestRun,
} from '../../src/modules/chat/chat.service.js';
import {
  createPlan,
  discardDraft,
  editDraft,
  previewLock,
  lockPlan,
  organizePlan,
  restoreRevision,
  unlockPlan,
} from '../../src/modules/plans/plan.service.js';

const owner = '00000000-0000-0000-0000-000000000001';
const stranger = '00000000-0000-4000-8000-000000000999';
const message = (
  content = 'Hello',
  target: { versionId: string; editNumber: number } | null = null,
) => ({ content, target });
beforeEach(() => {
  process.env.CHAT_EXECUTION_MODE = 'test';
  resetApiConfigForTests();
});
afterAll(async () => {
  delete process.env.CHAT_EXECUTION_MODE;
  resetApiConfigForTests();
  await closeDatabase();
});
async function chat(content = 'Hello') {
  return createConversation(owner, { initialMessage: message(content) }, randomUUID());
}
async function finish(id: string) {
  const started = await tickTestRun(owner, id);
  return tickTestRun(owner, id, Date.parse(started.startedAt!) + 5000);
}

it('atomically creates a turn once across simultaneous retries, then persists one final assistant message', async () => {
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => createConversation(owner, { initialMessage: message() }, key)),
  );
  expect(new Set(results.map((r) => r.conversation.id)).size).toBe(1);
  expect(new Set(results.map((r) => r.accepted!.run.id)).size).toBe(1);
  const first = results[0]!;
  await expect(
    createConversation(owner, { initialMessage: message('Different') }, key),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect((await finish(first.accepted!.run.id)).status).toBe('completed');
  await tickTestRun(owner, first.accepted!.run.id);
  const rows = await listMessages(owner, first.conversation.id, undefined, 50);
  expect(rows.messages.map((m) => [m.role, m.sequence])).toEqual([
    ['user', 1],
    ['assistant', 2],
  ]);
  expect(
    (await listEvents(owner, first.accepted!.run.id, 0, 50)).events.map((e) => e.type),
  ).toEqual(['queued', 'started', 'completed']);
  expect((await cancelRun(owner, first.accepted!.run.id)).status).toBe('completed');
});

it('serializes runs across multiple chats for a plan and does not persist rejected messages', async () => {
  const plan = await createPlan(owner, 'Chat concurrency', randomUUID());
  const [a, b] = await Promise.all([
    createConversation(owner, { planId: plan.id }, randomUUID()),
    createConversation(owner, { planId: plan.id }, randomUUID()),
  ]);
  const target = a.conversation.context!;
  const result = await Promise.allSettled([
    sendMessage(owner, a.conversation.id, message('A', target), randomUUID()),
    sendMessage(owner, b.conversation.id, message('B', target), randomUUID()),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = result.find((r) => r.status === 'rejected');
  expect(rejected).toMatchObject({ reason: { code: 'RUN_ACTIVE' } });
  const count =
    (await listMessages(owner, a.conversation.id, undefined, 50)).messages.length +
    (await listMessages(owner, b.conversation.id, undefined, 50)).messages.length;
  expect(count).toBe(1);
  const active = (await getConversation(owner, a.conversation.id)).activeRun!;
  await expect(organizePlan(owner, plan.id, 'archive', plan.stateVersion)).rejects.toMatchObject({
    code: 'RUN_ACTIVE',
  });
  await expect(unlockPlan(owner, plan.id, plan.stateVersion)).rejects.toMatchObject({
    code: 'RUN_ACTIVE',
  });
  await expect(
    lockPlan(owner, plan.id, { expectedStateVersion: plan.stateVersion }, randomUUID()),
  ).rejects.toMatchObject({ code: 'RUN_ACTIVE' });
  await expect(
    discardDraft(owner, plan.id, { expectedStateVersion: plan.stateVersion }, randomUUID()),
  ).rejects.toMatchObject({ code: 'RUN_ACTIVE' });
  await expect(
    restoreRevision(
      owner,
      plan.id,
      randomUUID(),
      {
        expectedStateVersion: plan.stateVersion,
        expectedCurrentVersionId: randomUUID(),
        expectedSourceHash: 'a'.repeat(64),
      },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'RUN_ACTIVE' });
  await cancelRun(owner, active.id);
});

it('opens a plan chat once under concurrent first-open requests and creates a first chat atomically with a new plan', async () => {
  const plan = await createPlan(owner, 'Plan with chat', randomUUID(), {
    createConversation: true,
  });
  expect(plan.conversationId).toBeTruthy();
  const opened = await Promise.all(
    Array.from({ length: 3 }, () => openPlanConversation(owner, plan.id)),
  );
  expect(opened.every((c) => c.id === plan.conversationId)).toBe(true);
  const empty = await createPlan(owner, 'Existing plan', randomUUID());
  const first = await Promise.all(
    Array.from({ length: 3 }, () => openPlanConversation(owner, empty.id)),
  );
  expect(new Set(first.map((c) => c.id)).size).toBe(1);
});

it('preserves individual archive state through plan archive/unarchive and allows accepted retries', async () => {
  const plan = await createPlan(owner, 'Archive chats', randomUUID());
  const a = await createConversation(owner, { planId: plan.id }, randomUUID());
  const b = await createConversation(owner, { planId: plan.id }, randomUUID());
  await changeConversation(owner, a.conversation.id, a.conversation.stateVersion, {
    archived: true,
  });
  const archived = await organizePlan(owner, plan.id, 'archive', plan.stateVersion);
  expect(
    (await listConversations(owner, { collection: 'archive', planId: plan.id, limit: 50 }))
      .conversations,
  ).toHaveLength(2);
  await expect(
    changeConversation(owner, b.conversation.id, b.conversation.stateVersion, { archived: false }),
  ).rejects.toMatchObject({ code: 'PLAN_ARCHIVED' });
  await expect(
    sendMessage(owner, b.conversation.id, message('No', b.conversation.context), randomUUID()),
  ).rejects.toMatchObject({ code: 'PLAN_ARCHIVED' });
  await organizePlan(owner, plan.id, 'unarchive', archived.stateVersion);
  expect((await getConversation(owner, a.conversation.id)).archived).toBe(true);
  expect((await getConversation(owner, b.conversation.id)).archived).toBe(false);
  const key = randomUUID();
  const accepted = await sendMessage(
    owner,
    b.conversation.id,
    message('Accepted', b.conversation.context),
    key,
  );
  await cancelRun(owner, accepted.run.id);
  const latest = await getConversation(owner, b.conversation.id);
  await changeConversation(owner, latest.id, latest.stateVersion, { archived: true });
  expect(
    await sendMessage(owner, b.conversation.id, message('Accepted', b.conversation.context), key),
  ).toEqual(accepted);
});

it('hides every conversation, run, event, message and plan association from another owner', async () => {
  const item = await chat();
  const id = item.conversation.id;
  const run = item.accepted!.run.id;
  await Promise.all(
    [
      getConversation(stranger, id),
      listMessages(stranger, id, undefined, 50),
      getRun(stranger, run),
      listEvents(stranger, run, 0, 50),
      cancelRun(stranger, run),
      sendMessage(stranger, id, message(), randomUUID()),
      changeConversation(stranger, id, 1, { title: 'Stolen' }),
    ].map((read) => expect(read).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })),
  );
  const plan = await createPlan(owner, 'Private', randomUUID());
  await expect(
    createConversation(stranger, { planId: plan.id }, randomUUID()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    listConversations(stranger, { collection: 'open', planId: plan.id, limit: 50 }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(
    (await listConversations(stranger, { collection: 'open', limit: 50 })).conversations,
  ).toEqual([]);
  await cancelRun(owner, run);
});

it('has one terminal winner when completion races cancellation', async () => {
  for (let i = 0; i < 4; i++) {
    const item = await chat();
    const id = item.accepted!.run.id;
    const start = await tickTestRun(owner, id);
    await Promise.all([
      cancelRun(owner, id),
      tickTestRun(owner, id, Date.parse(start.startedAt!) + 4000),
    ]);
    let final = await getRun(owner, id);
    if (final.status === 'cancelling') final = await tickTestRun(owner, id);
    expect(['completed', 'cancelled']).toContain(final.status);
    expect(
      (await listMessages(owner, item.conversation.id, undefined, 50)).messages.filter(
        (m) => m.role === 'assistant',
      ),
    ).toHaveLength(final.status === 'completed' ? 1 : 0);
  }
});

it('fails stale queued context, rejects stale sends, and preserves the submitted text', async () => {
  const plan = await createPlan(owner, 'Context', randomUUID());
  const item = await createConversation(owner, { planId: plan.id }, randomUUID());
  const input = message('Remember this', item.conversation.context);
  const accepted = await sendMessage(owner, item.conversation.id, input, randomUUID());
  await editDraft(owner, plan.id, {
    expectedDraftId: plan.draft!.id,
    expectedEditNumber: plan.draft!.editNumber,
    description: 'Changed elsewhere',
    startDate: null,
    endDate: null,
  });
  expect(await tickTestRun(owner, accepted.run.id)).toMatchObject({
    status: 'failed',
    failureCode: 'STALE_CONTEXT',
  });
  await expect(sendMessage(owner, item.conversation.id, input, randomUUID())).rejects.toMatchObject(
    { code: 'STALE_CONTEXT' },
  );
  expect((await listMessages(owner, item.conversation.id, undefined, 50)).messages).toHaveLength(1);
});

it('retains provenance when the actual discard command deletes the draft', async () => {
  const fresh = await createPlan(owner, 'Discard audit', randomUUID(), {
    startDate: '2026-05-11',
    endDate: '2026-10-04',
  });
  await getDatabase()
    .transaction()
    .execute((db) => cloneContent(db, '00000000-0000-0000-0000-000000000050', fresh.draft!.id));
  const brief = await getBrief(owner, fresh.id);
  await confirmBrief(owner, fresh.id, {
    expectedDraftId: brief.versionId,
    expectedEditNumber: brief.editNumber,
    expectedHash: brief.hash,
    acknowledgedWarningCodes: brief.findings
      .filter((f) => f.severity === 'warning')
      .map((f) => f.code),
  });
  const preview = await previewLock(owner, fresh.id);
  const locked = await lockPlan(
    owner,
    fresh.id,
    {
      expectedStateVersion: preview.stateVersion,
      expectedDraftId: preview.draftId,
      expectedEditNumber: preview.editNumber,
      expectedContentHash: preview.contentHash,
      expectedValidationDigest: preview.validationDigest,
      acknowledgedWarningCodes: preview.findings
        .filter((f) => f.severity === 'warning')
        .map((f) => f.code),
    },
    randomUUID(),
  );
  const plan = await unlockPlan(owner, fresh.id, locked.stateVersion);
  const item = await createConversation(owner, { planId: plan.id }, randomUUID());
  const turn = await sendMessage(
    owner,
    item.conversation.id,
    message('Draft audit', item.conversation.context),
    randomUUID(),
  );
  await cancelRun(owner, turn.run.id);
  await discardDraft(
    owner,
    plan.id,
    {
      expectedStateVersion: plan.stateVersion,
      expectedDraftId: plan.draft!.id,
      expectedEditNumber: plan.draft!.editNumber,
    },
    randomUUID(),
  );
  expect((await getRun(owner, turn.run.id)).context?.versionId).toBe(plan.draft!.id);
  expect(
    (await listMessages(owner, item.conversation.id, undefined, 50)).messages[0]!.context
      ?.versionId,
  ).toBe(plan.draft!.id);
  expect(
    await getDatabase()
      .selectFrom('plan_versions')
      .select('id')
      .where('id', '=', plan.draft!.id)
      .executeTakeFirst(),
  ).toBeUndefined();
});

it('does not write anything when execution is unavailable, but returns accepted retries', async () => {
  const key = randomUUID();
  const accepted = await createConversation(owner, { initialMessage: message() }, key);
  await cancelRun(owner, accepted.accepted!.run.id);
  const before = await getDatabase()
    .selectFrom('conversations')
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirstOrThrow();
  process.env.CHAT_EXECUTION_MODE = 'unavailable';
  resetApiConfigForTests();
  await expect(
    createConversation(owner, { initialMessage: message() }, randomUUID()),
  ).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE', status: 503 });
  const after = await getDatabase()
    .selectFrom('conversations')
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirstOrThrow();
  expect(after.count).toBe(before.count);
  expect(await createConversation(owner, { initialMessage: message() }, key)).toEqual(accepted);
  expect((await createConversation(owner, {}, randomUUID())).accepted).toBeNull();
});

it('bounds failure and timeout and refuses late completion', async () => {
  const failure = await chat('/test fail');
  expect(await finish(failure.accepted!.run.id)).toMatchObject({
    status: 'failed',
    failureCode: 'TEST_FAILURE',
  });
  const timeout = await chat('/test timeout');
  await tickTestRun(owner, timeout.accepted!.run.id);
  expect(await tickTestRun(owner, timeout.accepted!.run.id, Date.now() + 60000)).toMatchObject({
    status: 'failed',
    failureCode: 'EXECUTION_TIMEOUT',
  });
  expect((await tickTestRun(owner, timeout.accepted!.run.id)).status).toBe('failed');
  expect((await listMessages(owner, timeout.conversation.id, undefined, 50)).messages).toHaveLength(
    1,
  );
});

it('rolls back completion if the final assistant write fails', async () => {
  const item = await chat();
  const id = item.accepted!.run.id;
  const started = await tickTestRun(owner, id);
  // Force a sequence collision; the attempted final write and run transition must both roll back.
  await getDatabase()
    .updateTable('conversations')
    .set({ next_sequence: 1 })
    .where('id', '=', item.conversation.id)
    .execute();
  await expect(tickTestRun(owner, id, Date.parse(started.startedAt!) + 4000)).rejects.toThrow();
  expect((await getRun(owner, id)).status).toBe('running');
  expect((await listEvents(owner, id, 0, 50)).events.map((e) => e.type)).toEqual([
    'queued',
    'started',
  ]);
  await getDatabase()
    .updateTable('conversations')
    .set({ next_sequence: 2 })
    .where('id', '=', item.conversation.id)
    .execute();
  await cancelRun(owner, id);
  await tickTestRun(owner, id);
});

it('rejects malformed cursor UUIDs as validation errors', async () => {
  const cursor = Buffer.from(
    JSON.stringify({ time: '2026-09-11T12:00:00.000000Z', id: '-'.repeat(36) }),
  ).toString('base64url');
  await expect(
    listConversations(owner, { collection: 'open', cursor, limit: 10 }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 });
});

it('paginates messages and events without repeats and keeps history immutable', async () => {
  const item = await chat();
  await finish(item.accepted!.run.id);
  const newest = await listMessages(owner, item.conversation.id, undefined, 1);
  const older = await listMessages(owner, item.conversation.id, newest.nextBeforeSequence!, 1);
  expect([older.messages[0]!.sequence, newest.messages[0]!.sequence]).toEqual([1, 2]);
  const events = await listEvents(owner, item.accepted!.run.id, 0, 1);
  expect(
    (await listEvents(owner, item.accepted!.run.id, events.nextAfterSequence!, 50)).events.map(
      (e) => e.sequence,
    ),
  ).toEqual([2, 3]);
  await expect(
    sql`UPDATE conversation_messages SET content = 'rewritten' WHERE id = ${newest.messages[0]!.id}`.execute(
      getDatabase(),
    ),
  ).rejects.toThrow('append-only');
  await expect(
    sql`DELETE FROM agent_run_events WHERE run_id = ${item.accepted!.run.id}`.execute(
      getDatabase(),
    ),
  ).rejects.toThrow('append-only');
});
