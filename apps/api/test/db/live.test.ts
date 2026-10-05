import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { getDatabase, closeDatabase } from '../../src/database/client.js';
import { resetApiConfigForTests } from '../../src/config.js';
import { app } from '../../src/app.js';
import {
  createConversation,
  cancelRun,
  listMessages,
} from '../../src/modules/chat/chat.service.js';
import {
  claimRun,
  finishRun,
  registerWorker,
  heartbeatRun,
  sweepAgentRuns,
} from '../../src/modules/agent/agent.service.js';
import {
  bootstrap,
  conversationRuns,
  getOutput,
  liveEvents,
  saveProgress,
  runChanges,
  draftChanges,
} from '../../src/modules/live/live.service.js';
import { ProgressSchema } from '../../src/modules/live/live.schemas.js';
import { createPlan } from '../../src/modules/plans/plan.service.js';
const owner = '00000000-0000-0000-0000-000000000001';
const db = getDatabase();
beforeEach(async () => {
  process.env.CHAT_EXECUTION_MODE = 'agent';
  process.env.AGENT_BOOTSTRAP_TOKEN = 'test-bootstrap-token-32-characters';
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
async function accepted() {
  const workerId = randomUUID();
  await registerWorker({
    id: workerId,
    provider: 'openai',
    model: 'gpt-6.1-sol',
    reasoning: 'medium',
    promptVersion: 'running-coach-v2',
    ready: true,
  });
  const created = await createConversation(
    owner,
    { initialMessage: { content: 'A live coaching question', target: null } },
    randomUUID(),
  );
  const claim = (await claimRun(workerId)).claim!;
  expect(claim.runId).toBe(created.accepted!.run.id);
  return { claim, conversationId: created.conversation.id };
}
const batch = (sequence: number, content: string, revision = sequence) =>
  ProgressSchema.parse({ sequence, items: [{ itemId: 'reply', position: 0, content, revision }] });
it('persists ordered prefixes, retries uncertain delivery, and atomically deduplicates completion', async () => {
  const { claim, conversationId } = await accepted();
  const first = batch(1, 'Hello');
  await saveProgress(claim.runId, claim.token, first);
  const cursor = await bootstrap(owner);
  await saveProgress(claim.runId, claim.token, first);
  expect(await bootstrap(owner)).toEqual(cursor);
  await expect(saveProgress(claim.runId, claim.token, batch(1, 'Changed'))).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await expect(
    saveProgress(claim.runId, claim.token, batch(3, 'Hello there')),
  ).rejects.toMatchObject({ code: 'OUTPUT_GAP' });
  await expect(saveProgress(claim.runId, claim.token, batch(2, 'Rewritten'))).rejects.toMatchObject(
    { code: 'OUTPUT_CONFLICT' },
  );
  await saveProgress(claim.runId, claim.token, batch(2, 'Hello there'));
  expect((await getOutput(owner, claim.runId)).items[0]).toMatchObject({
    content: 'Hello there',
    revision: 2,
    isFinal: false,
  });
  const finish = {
    status: 'completed' as const,
    content: 'Hello there',
    finalOutputItemId: 'reply',
    inputTokens: 3,
    outputTokens: 2,
  };
  await Promise.all([
    finishRun(claim.runId, claim.token, finish),
    finishRun(claim.runId, claim.token, finish),
  ]);
  const output = await getOutput(owner, claim.runId);
  expect(output).toMatchObject({ status: 'completed', finalMessageId: expect.any(String) });
  expect(output.items[0]!.isFinal).toBe(true);
  expect(
    (await listMessages(owner, conversationId, undefined, 50)).messages.filter(
      (m) => m.producingRunId === claim.runId,
    ),
  ).toHaveLength(1);
  const terminal = await bootstrap(owner);
  await finishRun(claim.runId, claim.token, finish);
  expect(await bootstrap(owner)).toEqual(terminal);
  await expect(
    saveProgress(claim.runId, claim.token, batch(3, 'Hello there again')),
  ).rejects.toMatchObject({ code: 'LEASE_LOST' });
  await expect(
    db
      .updateTable('agent_run_outputs')
      .set({ content: 'Rewrite', revision: 3 })
      .where('run_id', '=', claim.runId)
      .execute(),
  ).rejects.toThrow();
});
it.each(['cancelled', 'failed'] as const)(
  'retains incomplete text for older %s turns without creating assistant history',
  async (status) => {
    const { claim, conversationId } = await accepted();
    await saveProgress(claim.runId, claim.token, batch(1, 'A visible partial reply'));
    if (status === 'cancelled') {
      await cancelRun(owner, claim.runId);
      await saveProgress(claim.runId, claim.token, batch(2, 'A visible partial reply, stopped'));
      await expect(
        saveProgress(
          claim.runId,
          claim.token,
          ProgressSchema.parse({
            sequence: 3,
            activity: { operationId: 'late', name: 'read_plan_context', state: 'started' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'CANCELLATION_REQUIRED' });
    }
    await finishRun(claim.runId, claim.token, {
      status,
      ...(status === 'failed' ? { failureCode: 'PROVIDER_ERROR' } : {}),
    });
    const output = await getOutput(owner, claim.runId);
    expect(output.status).toBe(status);
    expect(output.items[0]!.content).toContain('A visible partial reply');
    expect(output.finalMessageId).toBeNull();
    expect((await listMessages(owner, conversationId, undefined, 50)).messages).toHaveLength(1);
    expect((await conversationRuns(owner, conversationId, undefined, 50)).runs[0]!.id).toBe(
      claim.runId,
    );
  },
);
it('fences expired leases and recovers the last accepted output after worker loss', async () => {
  const { claim } = await accepted();
  await saveProgress(claim.runId, claim.token, batch(1, 'Saved before loss'));
  await db
    .updateTable('agent_runs')
    .set({ lease_expires_at: new Date(Date.now() - 1) })
    .where('id', '=', claim.runId)
    .execute();
  await expect(
    saveProgress(claim.runId, claim.token, batch(2, 'Saved before loss plus late text')),
  ).rejects.toMatchObject({ code: 'LEASE_LOST' });
  await sweepAgentRuns();
  expect(await getOutput(owner, claim.runId)).toMatchObject({
    status: 'failed',
    items: [expect.objectContaining({ content: 'Saved before loss' })],
  });
});
it('authorizes output, activity, comparisons and replay by owner and keeps private progress behind machine credentials', async () => {
  const { claim, conversationId } = await accepted();
  const other = randomUUID();
  await db.insertInto('athletes').values({ id: other, display_name: 'Other owner' }).execute();
  const plan = await createPlan(owner, 'Protected diff', randomUUID());
  for (const read of [
    () => getOutput(other, claim.runId),
    () => runChanges(other, claim.runId),
    () => conversationRuns(other, conversationId, undefined, 50),
    () => draftChanges(other, plan.id),
  ])
    await expect(read()).rejects.toMatchObject({ status: 404 });
  expect((await liveEvents(other, '0')).events).toEqual([]);
  await expect(saveProgress(claim.runId, 'wrong-token', batch(1, 'private'))).rejects.toMatchObject(
    { code: 'LEASE_LOST' },
  );
  const response = await app.request(`/internal/agent/runs/${claim.runId}/progress`, {
    method: 'POST',
    headers: { authorization: 'Bearer browser-token', 'content-type': 'application/json' },
    body: JSON.stringify(batch(1, 'private')),
  });
  expect([401, 409]).toContain(response.status);
  for (const path of [
    '/api/v1/live/events',
    '/api/v1/live/bootstrap',
    `/api/v1/agent-runs/${claim.runId}/output`,
  ])
    expect((await app.request(path)).status).toBe(401);
});
it('does not emit output on rollback or liveness-only heartbeats and resets expired/future cursors', async () => {
  const { claim } = await accepted();
  const before = await bootstrap(owner);
  await heartbeatRun(claim.runId, claim.token);
  expect(await bootstrap(owner)).toEqual(before);
  await expect(
    saveProgress(
      claim.runId,
      claim.token,
      ProgressSchema.parse({
        sequence: 1,
        items: [
          { itemId: 'a', position: 0, content: 'same position', revision: 1 },
          { itemId: 'b', position: 0, content: 'invalid', revision: 1 },
        ],
      }),
    ),
  ).rejects.toThrow();
  expect((await getOutput(owner, claim.runId)).items).toEqual([]);
  expect(await bootstrap(owner)).toEqual(before);
  await saveProgress(claim.runId, claim.token, batch(1, 'Now saved'));
  const page = await liveEvents(owner, before.cursor);
  expect(page.events.some((e) => e.type === 'output.changed')).toBe(true);
  expect(await liveEvents(owner, '999999999999999999')).toMatchObject({ reset: true });
  await db
    .deleteFrom('live_events')
    .where('owner_id', '=', owner)
    .where('sequence', '<=', before.cursor)
    .execute();
  expect(await liveEvents(owner, '0')).toMatchObject({ reset: true });
});
it('allocates replay cursors in commit order when an earlier transaction commits later', async () => {
  const first = await createPlan(owner, 'Slow commit', randomUUID());
  const second = await createPlan(owner, 'Fast commit', randomUUID());
  const before = await bootstrap(owner);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const slow = db.transaction().execute(async (tx) => {
    await tx
      .updateTable('plans')
      .set({ display_name: 'Slow changed' })
      .where('id', '=', first.id)
      .execute();
    entered();
    await gate;
  });
  await ready;
  try {
    await db
      .updateTable('plans')
      .set({ display_name: 'Fast changed' })
      .where('id', '=', second.id)
      .execute();
    const fast = await liveEvents(owner, before.cursor);
    expect(fast.events).toHaveLength(1);
    expect(fast.events[0]!.metadata).toMatchObject({ planId: second.id });
    release();
    await slow;
    const later = await liveEvents(owner, fast.cursor);
    expect(later.events).toHaveLength(1);
    expect(later.events[0]!.metadata).toMatchObject({ planId: first.id });
    expect(BigInt(later.cursor)).toBeGreaterThan(BigInt(fast.cursor));
  } finally {
    release();
    await slow;
  }
});
