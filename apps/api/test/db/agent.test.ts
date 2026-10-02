import { startAgentSweeper } from '../../src/modules/agent/agent.sweeper.js';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { getDatabase, closeDatabase } from '../../src/database/client.js';
import { resetApiConfigForTests } from '../../src/config.js';
import { app } from '../../src/app.js';
import {
  createConversation,
  cancelRun,
  getRun,
  listMessages,
  getConversation,
  sendMessage,
  chatCapabilities,
} from '../../src/modules/chat/chat.service.js';
import {
  claimRun,
  executeTool,
  finishRun,
  heartbeatRun,
  registerWorker,
  runContext,
} from '../../src/modules/agent/agent.service.js';
import {
  createPlan,
  editDraft,
  getPlan,
  lockPlan,
  previewLock,
  unlockPlan,
  discardDraft,
} from '../../src/modules/plans/plan.service.js';
import { getBrief } from '../../src/modules/plans/brief.service.js';
import { emptyBrief } from '../../src/modules/plans/brief.schemas.js';
import type { z } from 'zod';
import type { ScheduleSchema } from '../../src/modules/agent/agent.schemas.js';
const owner = '00000000-0000-0000-0000-000000000001';
const bootstrap = 'local-test-bootstrap-credential-32-characters';
const db = getDatabase();
beforeEach(async () => {
  process.env.CHAT_EXECUTION_MODE = 'agent';
  process.env.AGENT_BOOTSTRAP_TOKEN = bootstrap;
  resetApiConfigForTests();
  // End any pending test-created work before claiming the next isolated scenario.
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
async function worker() {
  const id = randomUUID();
  await registerWorker({
    id,
    provider: 'openai',
    model: 'gpt-6.1-sol',
    reasoning: 'medium',
    promptVersion: 'running-coach-v1',
    ready: true,
  });
  return id;
}
async function accepted(planId?: string) {
  const w = await worker();
  const plan = planId ? await getPlan(owner, planId) : null;
  const created = await createConversation(
    owner,
    {
      ...(planId ? { planId } : {}),
      initialMessage: {
        content: 'Help me build a running plan',
        target: plan ? { versionId: plan.draft!.id, editNumber: plan.draft!.editNumber } : null,
      },
    },
    randomUUID(),
  );
  const claim = (await claimRun(w)).claim!;
  expect(claim.runId).toBe(created.accepted!.run.id);
  return { claim, created, w };
}
async function tool(
  claim: NonNullable<Awaited<ReturnType<typeof claimRun>>['claim']>,
  name: string,
  input: unknown,
  operationId = randomUUID(),
) {
  const c = await runContext(claim.runId, claim.token);
  return executeTool(claim.runId, claim.token, {
    operationId,
    name,
    input,
    expectedVersionId: c.versionId,
    expectedEditNumber: c.editNumber,
  });
}
const brief = {
  ...emptyBrief(),
  goal: 'Run a comfortable 10K',
  weeklyDistance: { status: 'known' as const, value: 18000 },
  currentRuns: { status: 'known' as const, value: 3 },
  longestRun: { status: 'known' as const, value: 8000 },
  desiredRuns: 3,
};
const effort = {
  parentIndex: null,
  kind: 'effort' as const,
  repeatCount: null,
  role: 'main' as const,
  label: 'Easy run',
  instructions: 'Comfortable effort',
  completion: { type: 'duration' as const, value: 1800, unit: 'seconds' as const },
  targets: [{ type: 'zone' as const, key: 'easy' as const }],
};
const batch: z.infer<typeof ScheduleSchema> = {
  blocks: [
    {
      key: 'foundation',
      title: 'Foundation',
      description: null,
      startDate: '2027-01-01',
      endDate: '2027-01-28',
      position: 1,
    },
  ],
  weeks: [
    {
      key: 'week1',
      blockKey: 'foundation',
      weekNumber: 1,
      position: 1,
      title: 'First week',
      description: null,
      startDate: '2027-01-01',
      endDate: '2027-01-07',
    },
  ],
  workouts: [
    {
      key: 'easy1',
      weekKey: 'week1',
      date: '2027-01-02',
      position: 1,
      title: 'Easy run',
      description: null,
      purpose: 'Build consistency',
      priority: 'medium',
      estimatedDurationSeconds: 1800,
      estimatedDistanceMetres: null,
      tags: ['easy'],
      steps: [effort],
    },
  ],
  deleteWorkoutIds: [],
  deleteWeekIds: [],
  deleteBlockIds: [],
  coverage: { startDate: '2027-01-01', endDate: '2027-01-07' },
};
async function planning() {
  const p = await createPlan(owner, 'Agent plan', randomUUID(), {
    startDate: '2027-01-01',
    endDate: '2027-03-31',
  });
  const a = await accepted(p.id);
  await tool(a.claim, 'update_plan_brief', {
    brief,
    startDate: '2027-01-01',
    endDate: '2027-03-31',
    description: 'Initial month then reassess',
  });
  await tool(a.claim, 'set_fitness_calibration', {
    input: { method: 'threshold_pace', secondsPerKilometre: 330 },
    provenance: 'agent_estimate',
    estimateBasis: 'Starting estimate based on reported easy running; reassess after a few runs.',
  });
  return { ...a, p };
}
it('rejects machine credentials at the private boundary and keeps bootstrap authority out of run context', async () => {
  const { claim } = await accepted();
  for (const token of ['', 'browser-session-token', bootstrap]) {
    const response = await app.request(`/internal/agent/runs/${claim.runId}/context`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect([401, 409]).toContain(response.status);
    expect(await response.text()).not.toContain('Help me build');
  }
  const r = await app.request('/internal/agent/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${claim.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ workerId: randomUUID() }),
  });
  expect(r.status).toBe(401);
  await expect(runContext(randomUUID(), claim.token)).rejects.toMatchObject({ code: 'LEASE_LOST' });
});
it('claims once across workers, allows discussion without generating, and persists one final reply', async () => {
  const w1 = await worker(),
    w2 = await worker();
  const c = await createConversation(
    owner,
    { initialMessage: { content: 'I am considering running', target: null } },
    randomUUID(),
  );
  const claims = await Promise.all([claimRun(w1), claimRun(w2)]);
  expect(claims.filter((c) => c.claim)).toHaveLength(1);
  const claim = claims.find((c) => c.claim)!.claim!;
  expect((await runContext(claim.runId, claim.token)).plan).toBeNull();
  await finishRun(claim.runId, claim.token, {
    status: 'completed',
    content: 'What would you like to achieve?',
  });
  expect((await listMessages(owner, c.conversation.id, undefined, 50)).messages).toHaveLength(2);
  await expect(
    finishRun(claim.runId, claim.token, { status: 'completed', content: 'Duplicate' }),
  ).rejects.toMatchObject({ code: 'LEASE_LOST' });
});
it('binds standalone creation atomically and replays a lost-response receipt without rewriting original context', async () => {
  const { claim, created } = await accepted();
  const operationId = randomUUID();
  const cmd = {
    operationId,
    name: 'create_plan_draft',
    input: { displayName: 'My 10K', startDate: '2027-01-01', endDate: '2027-03-31' },
    expectedVersionId: null,
    expectedEditNumber: null,
  };
  const results = await Promise.all([
    executeTool(claim.runId, claim.token, cmd),
    executeTool(claim.runId, claim.token, cmd),
  ]);
  expect(results[0]).toEqual(results[1]);
  const c = await getConversation(owner, created.conversation.id);
  expect(c.planId).toBeTruthy();
  expect((await getRun(owner, claim.runId)).context).toBeNull();
  expect((await listMessages(owner, c.id, undefined, 50)).messages[0]!.context).toBeNull();
  await expect(
    executeTool(claim.runId, claim.token, {
      ...cmd,
      input: { ...cmd.input, displayName: 'Different' },
    }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const other = await createConversation(owner, { planId: c.planId! }, randomUUID());
  await expect(
    sendMessage(
      owner,
      other.conversation.id,
      { content: 'Competing run', target: c.context },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'RUN_ACTIVE' });
});
it('generates complete prescriptions, safely replays mutations, and locks a partial horizon with combined human review', async () => {
  const { claim, p } = await planning();
  const context = await runContext(claim.runId, claim.token);
  const cmd = {
    operationId: randomUUID(),
    name: 'apply_schedule_changes',
    input: batch,
    expectedVersionId: context.versionId,
    expectedEditNumber: context.editNumber,
  };
  const result = await executeTool(claim.runId, claim.token, cmd);
  expect(await executeTool(claim.runId, claim.token, cmd)).toEqual(result);
  const b = await getBrief(owner, p.id);
  expect(b.coverage).toEqual([{ startDate: '2027-01-01', endDate: '2027-01-07', current: true }]);
  expect(b.calibrations[0]).toMatchObject({ provenance: 'agent_estimate' });
  expect(
    await db
      .selectFrom('workouts')
      .select('id')
      .where('plan_version_id', '=', p.draft!.id)
      .execute(),
  ).toHaveLength(1);
  await finishRun(claim.runId, claim.token, {
    status: 'completed',
    content:
      'The first week is prescribed. Paces are estimates; the remaining dates are unplanned.',
  });
  const current = await getPlan(owner, p.id),
    preview = await previewLock(owner, p.id);
  const lock = {
    expectedStateVersion: current.stateVersion,
    expectedDraftId: preview.draftId,
    expectedEditNumber: preview.editNumber,
    expectedContentHash: preview.contentHash,
    expectedValidationDigest: preview.validationDigest,
    confirmBriefHash: b.hash,
    acknowledgedWarningCodes: preview.findings
      .filter((f) => f.severity === 'warning')
      .map((f) => f.code),
  };
  const locked = await lockPlan(owner, p.id, lock, randomUUID());
  expect(locked.locked).toBeTruthy();
  const draft = await unlockPlan(owner, p.id, locked.stateVersion);
  expect((await getBrief(owner, p.id)).coverage).toEqual(b.coverage);
  await discardDraft(
    owner,
    p.id,
    {
      expectedStateVersion: draft.stateVersion,
      expectedDraftId: draft.draft!.id,
      expectedEditNumber: draft.draft!.editNumber,
    },
    randomUUID(),
  );
  expect(
    await db
      .selectFrom('agent_tool_receipts')
      .selectAll()
      .where('run_id', '=', claim.runId)
      .execute(),
  ).toHaveLength(3);
});
it('rolls back an invalid multi-workout batch including its receipt and edit increment', async () => {
  const { claim, p } = await planning();
  const before = (await getPlan(owner, p.id)).draft!.editNumber;
  const bad = {
    ...batch,
    workouts: [...batch.workouts, { ...batch.workouts[0]!, key: 'bad', date: '2027-02-01' }],
  };
  await expect(tool(claim, 'apply_schedule_changes', bad)).rejects.toMatchObject({
    code: 'SCHEDULE_INVALID',
  });
  expect((await getPlan(owner, p.id)).draft!.editNumber).toBe(before);
  expect(
    await db
      .selectFrom('workouts')
      .select('id')
      .where('plan_version_id', '=', p.draft!.id)
      .execute(),
  ).toHaveLength(0);
  expect(
    await db
      .selectFrom('agent_tool_receipts')
      .select('operation_id')
      .where('run_id', '=', claim.runId)
      .execute(),
  ).toHaveLength(2);
});
it('replaces an explicit date range while retaining unrelated workouts and trailing rest-day coverage', async () => {
  const { claim, p } = await planning();
  const first = (await tool(claim, 'apply_schedule_changes', batch)) as {
    result: { ids: Record<string, string> };
  };
  const week = first.result.ids.week1!;
  await tool(claim, 'apply_schedule_changes', {
    ...batch,
    blocks: [],
    weeks: [],
    coverage: null,
    workouts: [{ ...batch.workouts[0]!, key: 'outside', weekKey: week, date: '2027-01-06' }],
  });
  const outside = await db
    .selectFrom('workouts')
    .selectAll()
    .where('plan_version_id', '=', p.draft!.id)
    .where('scheduled_date', '=', sql<Date>`'2027-01-06'::date`)
    .executeTakeFirstOrThrow();
  await tool(claim, 'replace_schedule_range', {
    ...batch,
    blocks: [],
    weeks: [],
    range: { startDate: '2027-01-01', endDate: '2027-01-04' },
    coverage: { startDate: '2027-01-01', endDate: '2027-01-04' },
    workouts: [{ ...batch.workouts[0]!, key: 'replacement', weekKey: week, date: '2027-01-03' }],
  });
  expect(
    await db.selectFrom('workouts').selectAll().where('id', '=', outside.id).executeTakeFirst(),
  ).toEqual(outside);
  const coverage = (await getBrief(owner, p.id)).coverage;
  expect(coverage.at(-1)!.endDate).toBe('2027-01-07');
});
it('fences expired workers and releases the active slot even with no worker running', async () => {
  const { claim, created } = await accepted();
  await db
    .updateTable('agent_runs')
    .set({ lease_expires_at: new Date(Date.now() - 1) })
    .where('id', '=', claim.runId)
    .execute();
  await expect(heartbeatRun(claim.runId, claim.token)).rejects.toMatchObject({
    code: 'LEASE_LOST',
  });
  process.env.CHAT_EXECUTION_MODE = 'unavailable';
  resetApiConfigForTests();
  await startAgentSweeper()();
  expect((await getRun(owner, claim.runId)).failureCode).toBe('WORKER_LOST');
  await expect(
    tool(claim, 'create_plan_draft', { displayName: 'Too late', startDate: null, endDate: null }),
  ).rejects.toMatchObject({ code: 'LEASE_LOST' });
  expect((await getConversation(owner, created.conversation.id)).activeRun).toBeNull();
});
it('cancellation rejects new mutations and completion while preserving previously committed work', async () => {
  const { claim, p } = await planning();
  await tool(claim, 'apply_schedule_changes', batch);
  await cancelRun(owner, claim.runId);
  await expect(tool(claim, 'apply_schedule_changes', batch)).rejects.toMatchObject({
    code: 'LEASE_LOST',
  });
  expect(
    await finishRun(claim.runId, claim.token, {
      status: 'completed',
      content: 'Should not be published',
    }),
  ).toEqual({ status: 'cancelled' });
  expect(
    await db
      .selectFrom('workouts')
      .select('id')
      .where('plan_version_id', '=', p.draft!.id)
      .execute(),
  ).toHaveLength(1);
  expect(
    (await listMessages(owner, (await getRun(owner, claim.runId)).conversationId, undefined, 50))
      .messages,
  ).toHaveLength(1);
});
it('rejects unknown local parent keys as a recoverable schedule error, not a database failure', async () => {
  const { claim } = await planning();
  await expect(
    tool(claim, 'apply_schedule_changes', {
      ...batch,
      blocks: [],
      weeks: [],
      workouts: [{ ...batch.workouts[0]!, weekKey: 'misspelled-week' }],
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_INVALID' });
});
it('rejects external edits, foreign content references and lifecycle tool names', async () => {
  const { claim, p } = await planning();
  const c = await runContext(claim.runId, claim.token);
  await expect(
    executeTool(claim.runId, claim.token, {
      operationId: randomUUID(),
      name: 'lock_plan',
      input: {},
      expectedVersionId: c.versionId,
      expectedEditNumber: c.editNumber,
    }),
  ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
  await expect(
    tool(claim, 'apply_schedule_changes', {
      ...batch,
      blocks: [],
      weeks: [],
      workouts: [{ ...batch.workouts[0]!, weekKey: randomUUID() }],
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_INVALID' });
  const current = await getPlan(owner, p.id);
  await editDraft(owner, p.id, {
    expectedDraftId: current.draft!.id,
    expectedEditNumber: current.draft!.editNumber,
    description: 'Human changed it',
    startDate: '2027-01-01',
    endDate: '2027-03-31',
  });
  await expect(
    executeTool(claim.runId, claim.token, {
      operationId: randomUUID(),
      name: 'read_plan_context',
      input: {},
      expectedVersionId: c.versionId,
      expectedEditNumber: c.editNumber,
    }),
  ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
});
it('disables fresh submission when readiness expires, while accepted retries remain readable', async () => {
  const w = await worker(),
    key = randomUUID(),
    input = { initialMessage: { content: 'Hi', target: null } };
  const original = await createConversation(owner, input, key);
  await db
    .updateTable('agent_workers')
    .set({ last_seen_at: new Date(Date.now() - 120000) })
    .execute();
  expect((await chatCapabilities()).executionAvailable).toBe(false);
  expect(await createConversation(owner, input, key)).toEqual(original);
  await expect(createConversation(owner, input, randomUUID())).rejects.toMatchObject({
    code: 'AGENT_UNAVAILABLE',
  });
  expect(w).toBeTruthy();
});

it('extends an unlocked partial horizon into a second immutable revision while preserving the first', async () => {
  const { claim, p } = await planning();
  await tool(claim, 'apply_schedule_changes', batch);
  await finishRun(claim.runId, claim.token, {
    status: 'completed',
    content: 'First horizon is ready for review.',
  });
  async function lockCurrent() {
    const current = await getPlan(owner, p.id),
      b = await getBrief(owner, p.id),
      v = await previewLock(owner, p.id);
    return lockPlan(
      owner,
      p.id,
      {
        expectedStateVersion: current.stateVersion,
        expectedDraftId: v.draftId,
        expectedEditNumber: v.editNumber,
        expectedContentHash: v.contentHash,
        expectedValidationDigest: v.validationDigest,
        confirmBriefHash: b.hash,
        acknowledgedWarningCodes: v.findings
          .filter((f) => f.severity === 'warning')
          .map((f) => f.code),
      },
      randomUUID(),
    );
  }
  const first = await lockCurrent();
  await unlockPlan(owner, p.id, first.stateVersion);
  const next = await accepted(p.id);
  const schedule = (await tool(next.claim, 'read_schedule', {
    startDate: null,
    endDate: null,
  })) as { result: { training_blocks: { id: string }[] } };
  await tool(next.claim, 'apply_schedule_changes', {
    ...batch,
    blocks: [],
    weeks: [
      {
        ...batch.weeks[0]!,
        key: 'week2',
        blockKey: schedule.result.training_blocks[0]!.id,
        weekNumber: 2,
        position: 2,
        startDate: '2027-01-08',
        endDate: '2027-01-14',
      },
    ],
    workouts: [{ ...batch.workouts[0]!, key: 'easy2', weekKey: 'week2', date: '2027-01-09' }],
    coverage: { startDate: '2027-01-08', endDate: '2027-01-14' },
  });
  await finishRun(next.claim.runId, next.claim.token, {
    status: 'completed',
    content: 'The plan now includes the next week.',
  });
  const second = await lockCurrent();
  expect(second.locked!.versionNumber).toBe(2);
  expect(
    await db
      .selectFrom('workouts')
      .select('id')
      .where('plan_version_id', '=', first.locked!.id)
      .execute(),
  ).toHaveLength(1);
  expect(
    await db
      .selectFrom('workouts')
      .select('id')
      .where('plan_version_id', '=', second.locked!.id)
      .execute(),
  ).toHaveLength(2);
});
it('swaps dated workouts in one coherent transaction without intermediate uniqueness failures', async () => {
  const { claim, p } = await planning();
  const first = (await tool(claim, 'apply_schedule_changes', batch)) as {
    result: { ids: Record<string, string> };
  };
  const week = first.result.ids.week1!;
  const second = (await tool(claim, 'apply_schedule_changes', {
    ...batch,
    blocks: [],
    weeks: [],
    coverage: null,
    workouts: [{ ...batch.workouts[0]!, key: 'second', weekKey: week, date: '2027-01-06' }],
  })) as { result: { ids: Record<string, string> } };
  await tool(claim, 'apply_schedule_changes', {
    ...batch,
    blocks: [],
    weeks: [],
    coverage: null,
    workouts: [
      { ...batch.workouts[0]!, id: first.result.ids.easy1!, weekKey: week, date: '2027-01-06' },
      {
        ...batch.workouts[0]!,
        key: 'second',
        id: second.result.ids.second!,
        weekKey: week,
        date: '2027-01-02',
      },
    ],
  });
  const workouts = await db
    .selectFrom('workouts')
    .select(['id', 'scheduled_date'])
    .where('plan_version_id', '=', p.draft!.id)
    .orderBy('scheduled_date')
    .execute();
  expect(workouts.map((w) => w.id)).toEqual([second.result.ids.second, first.result.ids.easy1]);
});
