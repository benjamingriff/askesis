import { draftChanges, getTurn } from '../../src/modules/live/live.service.js';
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
  getRevision,
} from '../../src/modules/plans/plan.service.js';
import { getPerformance } from '../../src/modules/performance/performance.service.js';
import { confirmBrief, getBrief } from '../../src/modules/plans/brief.service.js';
import { emptyBrief } from '../../src/modules/plans/brief.schemas.js';
import type { z } from 'zod';
import type { ScheduleSchema } from '../../src/modules/agent/agent.schemas.js';
import { calculatePaces } from '../../src/modules/performance/run-pace.calculator.js';
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
    promptVersion: 'multisport-coach-v1',
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
  sports: [
    {
      sport: 'run' as const,
      currentSessions: { status: 'known' as const, value: 3 },
      desiredSessions: 3,
      weeklyDistance: { status: 'known' as const, value: 18000 },
      longestDistance: { status: 'known' as const, value: 8000 },
    },
  ],
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
      discipline: 'run',
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
  generation: { startDate: '2027-01-01', endDate: '2027-01-07' },
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
  await tool(a.claim, 'record_performance', {
    system: 'run_pace',
    input: { method: 'threshold_pace', secondsPerKilometre: 330 },
    provenance: 'agent_estimate',
    estimateBasis: 'Starting estimate based on reported easy running; reassess after a few runs.',
    observedOn: null,
  });
  return { ...a, p };
}
async function confirmCurrentBrief(planId: string) {
  const state = await getBrief(owner, planId);
  return confirmBrief(owner, planId, {
    expectedDraftId: state.versionId,
    expectedEditNumber: state.editNumber,
    expectedHash: state.hash,
    acknowledgedWarningCodes: state.findings
      .filter((f) => f.severity === 'warning')
      .map((f) => f.code),
  });
}
function confirmationMetadata(versionId: string) {
  return db
    .selectFrom('plan_briefs')
    .select([
      'confirmed_hash',
      'confirmed_at',
      'confirmed_edit_number',
      'validator_version',
      'acknowledged_warning_codes',
    ])
    .where('plan_version_id', '=', versionId)
    .executeTakeFirstOrThrow();
}
const clearedConfirmation = {
  confirmed_hash: null,
  confirmed_at: null,
  confirmed_edit_number: null,
  validator_version: null,
  acknowledged_warning_codes: null,
};

it('adds the nearest calibrated zone to pace-only efforts without replacing chosen zones', async () => {
  const { claim } = await planning();
  const { zones } = calculatePaces({ method: 'threshold_pace', secondsPerKilometre: 330 });
  const pace = (key: string) => zones.find((zone) => zone.key === key)!.target;
  const step = (label: string, targets: object[]) => ({
    ...effort,
    parentIndex: 0,
    label,
    targets,
  });
  await tool(claim, 'apply_schedule_changes', {
    ...batch,
    workouts: [
      {
        ...batch.workouts[0]!,
        steps: [
          { ...effort, kind: 'sequence', role: null, completion: null, targets: [] },
          step('Warm up', [{ type: 'pace', secondsPerKilometre: pace('easy') + 20 }]),
          step('Rep', [{ type: 'pace', secondsPerKilometre: pace('interval') - 3 }]),
          step('Cruise', [
            { type: 'zone', key: 'threshold' },
            { type: 'pace', secondsPerKilometre: pace('interval') },
          ]),
          step('Strides', [{ type: 'rpe', value: 8 }]),
        ],
      },
    ],
  });
  const { versionId } = await runContext(claim.runId, claim.token);
  const rows = await db
    .selectFrom('step_targets')
    .innerJoin('workout_steps', 'workout_steps.id', 'step_targets.step_id')
    .select(['workout_steps.label', 'step_targets.target_type', 'step_targets.zone_key'])
    .where('step_targets.plan_version_id', '=', versionId)
    .orderBy('workout_steps.position')
    .orderBy('step_targets.position')
    .execute();
  expect(rows.map((row) => [row.label, row.target_type, row.zone_key])).toEqual([
    ['Warm up', 'pace', null],
    ['Warm up', 'zone', 'easy'],
    ['Rep', 'pace', null],
    ['Rep', 'zone', 'interval'],
    ['Cruise', 'zone', 'threshold'],
    ['Cruise', 'pace', null],
    ['Strides', 'rpe', null],
  ]);
});

it('preserves confirmation for edit-only changes and keeps schedule review sticky until covered', async () => {
  const { claim, p } = await planning();
  let state = await confirmCurrentBrief(p.id);
  let confirmed = await confirmationMetadata(state.versionId);
  const header = {
    startDate: state.startDate,
    endDate: state.endDate,
    description: 'Updated description',
  };
  await tool(claim, 'update_plan_brief', { ...header, brief: state.brief });
  let next = await getBrief(owner, p.id);
  expect(next.editNumber).toBe(state.editNumber + 1);
  expect(next.confirmed).toBe(true);
  expect(next.scheduleReviewRequired).toBe(false);
  expect(await confirmationMetadata(state.versionId)).toEqual(confirmed);
  state = next;

  await tool(claim, 'apply_schedule_changes', batch);
  next = await getBrief(owner, p.id);
  expect(next.editNumber).toBe(state.editNumber + 1);
  expect(next.confirmed).toBe(true);
  expect(next.scheduleReviewRequired).toBe(false);
  expect(await confirmationMetadata(state.versionId)).toEqual(confirmed);
  state = next;

  // Fitness belongs to the athlete: recording it never edits, unconfirms or stales the plan.
  const calibration = {
    system: 'run_pace',
    input: { method: 'threshold_pace', secondsPerKilometre: 320 },
    provenance: 'agent_estimate',
    estimateBasis: 'Revised starting estimate based on recent easy running.',
    observedOn: null,
  };
  await tool(claim, 'record_performance', calibration);
  expect(await getBrief(owner, p.id)).toEqual(state);
  expect(await confirmationMetadata(state.versionId)).toEqual(confirmed);

  await tool(claim, 'update_plan_brief', {
    ...header,
    brief: { ...state.brief, unit: 'miles' },
  });
  next = await getBrief(owner, p.id);
  expect(next.editNumber).toBe(state.editNumber + 1);
  expect(next.confirmed).toBe(true);
  expect(next.scheduleReviewRequired).toBe(false);
  expect(await confirmationMetadata(state.versionId)).toEqual(confirmed);
  state = next;

  await tool(claim, 'update_plan_brief', {
    ...header,
    brief: { ...state.brief, goal: 'Run a comfortable half marathon' },
  });
  next = await getBrief(owner, p.id);
  expect(next.editNumber).toBe(state.editNumber + 1);
  expect(next.confirmed).toBe(false);
  expect(next.scheduleReviewRequired).toBe(true);
  expect(await confirmationMetadata(state.versionId)).toEqual(clearedConfirmation);
  state = await confirmCurrentBrief(p.id);
  confirmed = await confirmationMetadata(state.versionId);

  await tool(claim, 'update_plan_brief', {
    ...header,
    brief: { ...state.brief, unit: 'kilometres' },
  });
  next = await getBrief(owner, p.id);
  expect(next.editNumber).toBe(state.editNumber + 1);
  expect(next.confirmed).toBe(true);
  expect(next.scheduleReviewRequired).toBe(true);
  expect(await confirmationMetadata(state.versionId)).toEqual(confirmed);
  state = next;

  await tool(claim, 'record_performance', {
    ...calibration,
    input: { method: 'threshold_pace', secondsPerKilometre: 310 },
  });
  expect(await getBrief(owner, p.id)).toEqual(state);
  expect(await confirmationMetadata(state.versionId)).toEqual(confirmed);

  // An unfinished schedule edit cannot clear review; complete current coverage can.
  for (const coverage of [null, batch.coverage]) {
    const before = await getBrief(owner, p.id);
    await tool(claim, 'apply_schedule_changes', {
      ...batch,
      blocks: [],
      weeks: [],
      workouts: [],
      coverage,
    });
    const after = await getBrief(owner, p.id);
    expect(after.editNumber).toBe(before.editNumber + 1);
    expect(after.confirmed).toBe(true);
    expect(after.scheduleReviewRequired).toBe(coverage === null);
    expect(await confirmationMetadata(state.versionId)).toEqual(confirmed);
  }
});

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
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(
    await finishRun(claim.runId, claim.token, {
      status: 'completed',
      content: 'What would you like to achieve?',
    }),
  ).toEqual({ status: 'completed' });
  expect((await listMessages(owner, c.conversation.id, undefined, 50)).messages).toHaveLength(2);
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
  // The fixture also calibrates cycling and swimming for this athlete.
  expect(
    (await getPerformance(owner)).current.filter((entry) => entry.system === 'run_pace'),
  ).toEqual([expect.objectContaining({ provenance: 'agent_estimate', recordedBy: 'coach' })]);
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
  // The version records the fitness it was locked against, outside its content hash.
  const revision = await getRevision(owner, p.id, locked.locked!.id);
  expect(revision.revision.calibrationBasis).toContainEqual({
    system: 'run_pace',
    calibrationId: (await getPerformance(owner)).current[0]!.id,
    effectiveFrom: expect.any(String),
  });
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
    generation: { startDate: '2027-01-08', endDate: '2027-01-14' },
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

async function lockReviewedPartial(planId: string) {
  const plan = await getPlan(owner, planId);
  const state = await getBrief(owner, planId);
  const review = await previewLock(owner, planId);
  return lockPlan(
    owner,
    planId,
    {
      expectedStateVersion: plan.stateVersion,
      expectedDraftId: review.draftId,
      expectedEditNumber: review.editNumber,
      expectedContentHash: review.contentHash,
      expectedValidationDigest: review.validationDigest,
      confirmBriefHash: state.hash,
      acknowledgedWarningCodes: review.findings
        .filter((f) => f.severity === 'warning')
        .map((f) => f.code),
    },
    randomUUID(),
  );
}

it('reconciles coverage after agent and human date edits and locks only in-range coverage', async () => {
  const { claim, p } = await planning();
  const first = (await tool(claim, 'apply_schedule_changes', batch)) as {
    result: { ids: Record<string, string> };
  };
  const beforeDateEdit = await confirmCurrentBrief(p.id);
  await tool(claim, 'update_plan_brief', {
    brief,
    startDate: '2027-01-01',
    endDate: '2027-01-05',
    description: 'Shorter plan',
  });
  const afterDateEdit = await getBrief(owner, p.id);
  expect(afterDateEdit.editNumber).toBe(beforeDateEdit.editNumber + 1);
  expect(afterDateEdit.confirmed).toBe(false);
  expect(afterDateEdit.scheduleReviewRequired).toBe(true);
  expect(await confirmationMetadata(beforeDateEdit.versionId)).toEqual(clearedConfirmation);
  expect((await getBrief(owner, p.id)).coverage).toEqual([
    { startDate: '2027-01-01', endDate: '2027-01-05', current: false },
  ]);
  // A different human writer must obey the same boundary rule.
  const current = await getPlan(owner, p.id);
  await editDraft(owner, p.id, {
    expectedDraftId: current.draft!.id,
    expectedEditNumber: current.draft!.editNumber,
    startDate: '2027-01-02',
    endDate: '2027-01-05',
    description: 'Shorter plan',
  });
  expect((await getBrief(owner, p.id)).coverage).toEqual([
    { startDate: '2027-01-02', endDate: '2027-01-05', current: false },
  ]);
  await finishRun(claim.runId, claim.token, { status: 'failed', failureCode: 'STALE_CONTEXT' });
  const next = await accepted(p.id);
  await tool(next.claim, 'apply_schedule_changes', {
    ...batch,
    generation: { startDate: '2027-01-02', endDate: '2027-01-05' },
    blocks: [
      {
        ...batch.blocks[0]!,
        id: first.result.ids.foundation!,
        startDate: '2027-01-02',
        endDate: '2027-01-05',
      },
    ],
    weeks: [
      {
        ...batch.weeks[0]!,
        id: first.result.ids.week1!,
        startDate: '2027-01-02',
        endDate: '2027-01-05',
      },
    ],
    workouts: [],
    coverage: { startDate: '2027-01-02', endDate: '2027-01-05' },
  });
  await finishRun(next.claim.runId, next.claim.token, {
    status: 'completed',
    content: 'Shortened schedule reviewed.',
  });
  const locked = await lockReviewedPartial(p.id);
  expect((await getBrief(owner, p.id, locked.locked!.id)).coverage).toEqual([
    { startDate: '2027-01-02', endDate: '2027-01-05', current: true },
  ]);
  await unlockPlan(owner, p.id, locked.stateVersion);
  const draft = await getPlan(owner, p.id);
  await editDraft(owner, p.id, {
    expectedDraftId: draft.draft!.id,
    expectedEditNumber: draft.draft!.editNumber,
    startDate: '2027-02-01',
    endDate: '2027-02-28',
    description: 'Moved plan',
  });
  expect((await getBrief(owner, p.id)).coverage).toEqual([]);
  expect((await getBrief(owner, p.id, locked.locked!.id)).coverage).toHaveLength(1);
});

it('rejects missing generation intent and rolls back invalid first-batch intent with its content', async () => {
  const { claim, p } = await planning();
  await expect(
    tool(claim, 'apply_schedule_changes', { ...batch, generation: null }),
  ).rejects.toMatchObject({ code: 'GENERATION_REQUIRED' });
  await expect(
    tool(claim, 'apply_schedule_changes', {
      ...batch,
      workouts: [{ ...batch.workouts[0]!, date: '2027-02-01' }],
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_INVALID' });
  expect((await getRun(owner, claim.runId)).generation).toBeNull();
  expect((await getBrief(owner, p.id)).coverage).toEqual([]);
  expect(
    await db
      .selectFrom('workouts')
      .select('id')
      .where('plan_version_id', '=', p.draft!.id)
      .execute(),
  ).toHaveLength(0);
});

it.each(['failed', 'cancelled', 'completed'] as const)(
  'preserves the intended month and committed week when the run ends as %s',
  async (status) => {
    const { claim, p } = await planning();
    await tool(claim, 'apply_schedule_changes', {
      ...batch,
      generation: { startDate: '2027-01-01', endDate: '2027-01-28' },
    });
    expect((await getRun(owner, claim.runId)).generation).toMatchObject({
      status: 'in_progress',
      prescribedThrough: '2027-01-07',
    });
    // A partial result may never redefine its original promise as the shorter completed week.
    await expect(
      tool(claim, 'apply_schedule_changes', {
        ...batch,
        blocks: [],
        weeks: [],
        workouts: [],
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_INVALID' });
    if (status === 'cancelled') await cancelRun(owner, claim.runId);
    await finishRun(claim.runId, claim.token, {
      status,
      ...(status === 'completed'
        ? { content: 'The saved first week is ready; the month remains unfinished.' }
        : {}),
    });
    const generation = {
      runId: claim.runId,
      startDate: '2027-01-01',
      endDate: '2027-01-28',
      prescribedThrough: '2027-01-07',
      status: 'interrupted',
    };
    expect((await getRun(owner, claim.runId)).generation).toEqual(generation);
    expect((await getBrief(owner, p.id)).generations).toEqual([generation]);
    expect((await previewLock(owner, p.id)).findings).toContainEqual(
      expect.objectContaining({ code: 'brief.generation_incomplete', severity: 'warning' }),
    );
    const locked = await lockReviewedPartial(p.id);
    expect((await getBrief(owner, p.id, locked.locked!.id)).generations).toEqual([generation]);
  },
);

it('advances generation only through contiguous completed chunks and retains intent after worker expiry', async () => {
  const { claim } = await planning();
  const first = (await tool(claim, 'apply_schedule_changes', {
    ...batch,
    generation: { startDate: '2027-01-01', endDate: '2027-01-14' },
  })) as { result: { ids: Record<string, string> } };
  await tool(claim, 'apply_schedule_changes', {
    ...batch,
    generation: null,
    blocks: [],
    weeks: [
      {
        ...batch.weeks[0]!,
        key: 'week2',
        blockKey: first.result.ids.foundation!,
        weekNumber: 2,
        position: 2,
        startDate: '2027-01-08',
        endDate: '2027-01-14',
      },
    ],
    workouts: [{ ...batch.workouts[0]!, key: 'easy2', weekKey: 'week2', date: '2027-01-09' }],
    coverage: { startDate: '2027-01-09', endDate: '2027-01-14' },
  });
  expect((await getRun(owner, claim.runId)).generation).toMatchObject({
    prescribedThrough: '2027-01-07',
    status: 'in_progress',
  });
  await tool(claim, 'apply_schedule_changes', {
    ...batch,
    generation: null,
    blocks: [],
    weeks: [],
    workouts: [],
    coverage: { startDate: '2027-01-08', endDate: '2027-01-08' },
  });
  expect((await getRun(owner, claim.runId)).generation).toMatchObject({
    prescribedThrough: '2027-01-14',
    status: 'completed',
  });
  await finishRun(claim.runId, claim.token, {
    status: 'completed',
    content: 'Two weeks, including rest days, are ready.',
  });
  const other = await planning();
  await tool(other.claim, 'apply_schedule_changes', {
    ...batch,
    generation: { startDate: '2027-01-01', endDate: '2027-01-28' },
  });
  await db
    .updateTable('agent_runs')
    .set({ lease_expires_at: new Date(Date.now() - 1) })
    .where('id', '=', other.claim.runId)
    .execute();
  await startAgentSweeper()();
  expect((await getRun(owner, other.claim.runId)).generation).toMatchObject({
    endDate: '2027-01-28',
    prescribedThrough: '2027-01-07',
    status: 'interrupted',
  });
});

it('invalidates previous coverage inside a regeneration horizon without deleting saved workouts', async () => {
  const { claim, p } = await planning();
  const first = (await tool(claim, 'apply_schedule_changes', batch)) as {
    result: { ids: Record<string, string> };
  };
  await finishRun(claim.runId, claim.token, {
    status: 'completed',
    content: 'First week complete.',
  });
  const next = await accepted(p.id);
  await tool(next.claim, 'apply_schedule_changes', {
    ...batch,
    blocks: [],
    weeks: [],
    generation: { startDate: '2027-01-01', endDate: '2027-01-07' },
    coverage: null,
    workouts: [
      {
        ...batch.workouts[0]!,
        id: first.result.ids.easy1!,
        weekKey: first.result.ids.week1!,
        title: 'Revised easy run',
      },
    ],
  });
  await finishRun(next.claim.runId, next.claim.token, { status: 'failed' });
  expect((await getBrief(owner, p.id)).coverage).toEqual([]);
  expect((await getRun(owner, next.claim.runId)).generation).toMatchObject({
    status: 'interrupted',
    prescribedThrough: null,
    endDate: '2027-01-07',
  });
  expect(
    await db
      .selectFrom('workouts')
      .select('title')
      .where('plan_version_id', '=', p.draft!.id)
      .execute(),
  ).toEqual([{ title: 'Revised easy run' }]);
});

it.each([
  'delete workout',
  'delete week',
  'delete block',
  'move workout',
  'add workout',
  'update workout',
  'update week',
  'update block',
])('invalidates affected coverage after a later unfinished batch: %s', async (change) => {
  const { claim, p } = await planning();
  const first = (await tool(claim, 'apply_schedule_changes', {
    ...batch,
    generation: { startDate: '2027-01-01', endDate: '2027-01-14' },
    coverage: { startDate: '2027-01-01', endDate: '2027-01-14' },
    weeks: [
      ...batch.weeks,
      {
        ...batch.weeks[0]!,
        key: 'week2',
        weekNumber: 2,
        position: 2,
        startDate: '2027-01-08',
        endDate: '2027-01-14',
      },
    ],
    workouts: [
      ...batch.workouts,
      { ...batch.workouts[0]!, key: 'easy2', weekKey: 'week2', date: '2027-01-09' },
    ],
  })) as { result: { ids: Record<string, string> } };
  const ids = first.result.ids;
  expect((await getRun(owner, claim.runId)).generation).toMatchObject({ status: 'completed' });
  const input: z.infer<typeof ScheduleSchema> = {
    blocks: [],
    weeks: [],
    workouts: [],
    deleteWorkoutIds: [],
    deleteWeekIds: [],
    deleteBlockIds: [],
    generation: null,
    coverage: null,
  };
  let remaining = [
    ['2027-01-01', '2027-01-01'],
    ['2027-01-03', '2027-01-14'],
  ];
  let prescribedThrough: string | null = '2027-01-01';
  if (change === 'delete workout') input.deleteWorkoutIds = [ids.easy1!];
  if (change === 'delete week') {
    input.deleteWeekIds = [ids.week1!];
    remaining = [['2027-01-08', '2027-01-14']];
    prescribedThrough = null;
  }
  if (change === 'delete block') {
    input.deleteBlockIds = [ids.foundation!];
    remaining = [];
    prescribedThrough = null;
  }
  if (['move workout', 'add workout', 'update workout'].includes(change)) {
    input.workouts = [
      {
        ...batch.workouts[0]!,
        ...(change === 'add workout' ? {} : { id: ids.easy1! }),
        weekKey: ids.week1!,
        date: change === 'update workout' ? '2027-01-02' : '2027-01-04',
        position: change === 'add workout' ? 2 : 1,
        title: 'Revised prescription',
      },
    ];
    if (change === 'move workout')
      remaining = [
        ['2027-01-01', '2027-01-01'],
        ['2027-01-03', '2027-01-03'],
        ['2027-01-05', '2027-01-14'],
      ];
    if (change === 'add workout') {
      remaining = [
        ['2027-01-01', '2027-01-03'],
        ['2027-01-05', '2027-01-14'],
      ];
      prescribedThrough = '2027-01-03';
    }
  }
  if (change === 'update week') {
    input.weeks = [
      { ...batch.weeks[0]!, id: ids.week1!, blockKey: ids.foundation!, title: 'Revised week' },
    ];
    remaining = [['2027-01-08', '2027-01-14']];
    prescribedThrough = null;
  }
  if (change === 'update block') {
    input.blocks = [{ ...batch.blocks[0]!, id: ids.foundation!, title: 'Revised block' }];
    remaining = [];
    prescribedThrough = null;
  }
  await tool(claim, 'apply_schedule_changes', input);
  expect((await getBrief(owner, p.id)).coverage).toEqual(
    remaining.map(([startDate, endDate]) => ({ startDate, endDate, current: true })),
  );
  await cancelRun(owner, claim.runId);
  await finishRun(claim.runId, claim.token, { status: 'cancelled' });
  expect((await getRun(owner, claim.runId)).generation).toMatchObject({
    status: 'interrupted',
    prescribedThrough,
    endDate: '2027-01-14',
  });
  expect((await previewLock(owner, p.id)).findings).toContainEqual(
    expect.objectContaining({ code: 'brief.generation_incomplete', severity: 'warning' }),
  );
});

it('records reasserted coverage after invalidation and rolls back invalid revisions atomically', async () => {
  const { claim, p } = await planning();
  const first = (await tool(claim, 'apply_schedule_changes', batch)) as {
    result: { ids: Record<string, string> };
  };
  const input = {
    ...batch,
    generation: null,
    blocks: [],
    weeks: [],
    workouts: [
      { ...batch.workouts[0]!, id: first.result.ids.easy1!, weekKey: first.result.ids.week1! },
    ],
  };
  const before = await getBrief(owner, p.id);
  await expect(
    tool(claim, 'apply_schedule_changes', {
      ...input,
      coverage: null,
      workouts: [{ ...input.workouts[0]!, date: '2027-01-15' }],
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_INVALID' });
  expect((await getBrief(owner, p.id)).coverage).toEqual(before.coverage);
  expect((await getRun(owner, claim.runId)).generation).toMatchObject({ status: 'completed' });
  await tool(claim, 'apply_schedule_changes', input);
  expect((await getBrief(owner, p.id)).coverage).toEqual(before.coverage);
  expect((await getRun(owner, claim.runId)).generation).toMatchObject({ status: 'completed' });
});

it('guards coverage boundaries and the original generation horizon in the database', async () => {
  const { claim, p } = await planning();
  const state = await getBrief(owner, p.id);
  await expect(
    db
      .insertInto('plan_schedule_coverage')
      .values({
        plan_version_id: p.draft!.id,
        start_date: '2027-01-01',
        end_date: '2027-04-01',
        brief_hash: state.hash,
      })
      .execute(),
  ).rejects.toMatchObject({ code: '23514' });
  await tool(claim, 'apply_schedule_changes', batch);
  await expect(
    db
      .updateTable('agent_runs')
      .set({ generation_end_date: '2027-01-14' })
      .where('id', '=', claim.runId)
      .execute(),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await getRun(owner, claim.runId)).generation).toMatchObject({ endDate: '2027-01-07' });
});

it('requires the current prompt contract before a worker contributes readiness or claims work', async () => {
  const id = await worker();
  await db.updateTable('agent_workers').set({ ready: false }).execute();
  await db
    .updateTable('agent_workers')
    .set({ ready: true, prompt_version: 'running-coach-v2' })
    .where('id', '=', id)
    .execute();
  expect((await chatCapabilities()).executionAvailable).toBe(false);
  await expect(claimRun(id)).rejects.toMatchObject({ code: 'WORKER_NOT_READY' });
  await registerWorker({
    id,
    provider: 'openai',
    model: 'gpt-6.1-sol',
    reasoning: 'medium',
    promptVersion: 'multisport-coach-v1',
    ready: true,
  });
  expect((await chatCapabilities()).executionAvailable).toBe(true);
});

it('keeps current lineage highlights separate from immutable per-run changes across moves, reversions and locking', async () => {
  const initial = await planning();
  await tool(initial.claim, 'apply_schedule_changes', batch);
  const firstDiff = await draftChanges(owner, initial.p.id);
  expect(firstDiff.baselineId).toBeNull();
  expect(firstDiff.workouts[0]!.change).toBe('added');
  await finishRun(initial.claim.runId, initial.claim.token, {
    status: 'completed',
    content: 'First schedule',
  });
  const locked = await lockReviewedPartial(initial.p.id);
  await unlockPlan(owner, initial.p.id, locked.stateVersion);
  expect((await draftChanges(owner, initial.p.id)).workouts).toEqual([]);
  const next = await accepted(initial.p.id);
  const current = await getPlan(owner, initial.p.id);
  const workout = await db
    .selectFrom('workouts')
    .selectAll()
    .where('plan_version_id', '=', current.draft!.id)
    .executeTakeFirstOrThrow();
  const input = {
    ...batch,
    generation: { startDate: '2027-01-01', endDate: '2027-01-07' },
    blocks: [],
    weeks: [],
    workouts: [
      {
        ...batch.workouts[0]!,
        id: workout.id,
        weekKey: workout.week_id,
        date: '2027-01-03',
        title: 'Changed and moved',
      },
    ],
  };
  await tool(next.claim, 'apply_schedule_changes', input);
  expect((await draftChanges(owner, initial.p.id)).workouts[0]).toMatchObject({
    workoutId: workout.id,
    change: 'moved',
    prescriptionChanged: true,
    previousDate: '2027-01-02',
  });
  expect((await getTurn(owner, next.claim.runId)).changes?.workouts[0]).toMatchObject({
    change: 'moved',
    previousDate: '2027-01-02',
  });
  await tool(next.claim, 'apply_schedule_changes', {
    ...input,
    generation: null,
    workouts: [{ ...input.workouts[0]!, date: '2027-01-02', title: 'Easy run' }],
  });
  expect((await draftChanges(owner, initial.p.id)).workouts).toEqual([]);
  // The draft has no net difference, but this run did edit the workout.
  expect((await getTurn(owner, next.claim.runId)).changes?.workouts[0]).toMatchObject({
    change: 'changed',
    prescriptionChanged: true,
  });
  await tool(next.claim, 'apply_schedule_changes', {
    ...input,
    generation: null,
    workouts: [],
    deleteWorkoutIds: [workout.id],
  });
  expect((await draftChanges(owner, initial.p.id)).workouts[0]).toMatchObject({
    change: 'removed',
    workoutId: null,
    title: 'Easy run',
  });
  await cancelRun(owner, next.claim.runId);
  await finishRun(next.claim.runId, next.claim.token, { status: 'cancelled' });
  const after = await lockReviewedPartial(initial.p.id);
  expect(after.draft).toBeNull();
  const turn = await getTurn(owner, next.claim.runId);
  expect(turn.changes?.workouts).toEqual([
    expect.objectContaining({ change: 'removed', title: 'Easy run', date: '2027-01-02' }),
  ]);
  expect(turn.activity.map((a) => a.state)).toEqual(['completed', 'completed', 'completed']);
  expect(turn.legacyChanges).toBe(false);
});

it('previews, records and retracts a reported race from a standalone chat without a plan', async () => {
  const { claim, created } = await accepted();
  const context = (await runContext(claim.runId, claim.token)) as { performance: unknown };
  const before = await getPerformance(owner);
  expect(context.performance).toEqual(before);
  const race = {
    system: 'run_pace',
    input: { method: 'race_result', distanceMetres: 21097.5, durationSeconds: 5880 },
  };
  const preview = (await tool(claim, 'preview_performance', race)) as {
    result: { preview: { zones: unknown[]; current?: unknown } };
  };
  expect(preview.result.preview.zones).toHaveLength(5);
  expect(preview.result.preview.current).toEqual(before.current[0]);
  expect(await getPerformance(owner)).toEqual(before);
  const report = {
    ...race,
    provenance: 'user_supplied',
    estimateBasis: 'Half marathon at the weekend, flat course, all-out effort.',
  };
  await expect(
    tool(claim, 'record_performance', { ...report, observedOn: '2999-01-01' }),
  ).rejects.toMatchObject({ code: 'OBSERVED_IN_FUTURE' });
  const recorded = (await tool(claim, 'record_performance', {
    ...report,
    observedOn: before.today,
  })) as { result: { recorded: { id: string } }; versionId: string | null };
  expect(recorded.versionId).toBeNull();
  const after = await getPerformance(owner);
  expect(after.entries).toHaveLength(before.entries.length + 1);
  expect(after.current[0]).toMatchObject({
    id: recorded.result.recorded.id,
    recordedBy: 'coach',
    conversationId: created.conversation.id,
    observedOn: before.today,
    effectiveFrom: after.today,
    provenance: 'user_supplied',
  });
  await tool(claim, 'retract_performance', { calibrationId: recorded.result.recorded.id });
  const retracted = await getPerformance(owner);
  expect(retracted.current).toEqual(before.current);
  expect(retracted.entries[0]).toMatchObject({
    id: recorded.result.recorded.id,
    retractedAt: expect.any(String),
  });
  await finishRun(claim.runId, claim.token, {
    status: 'completed',
    content: 'I recorded your half marathon, then withdrew it as you asked.',
  });
  const turn = await getTurn(owner, claim.runId);
  expect(turn.performanceChanged).toBe(true);
  expect(turn.changes).toBeNull();
});

it('prescribes rides, swims, bricks and strength with sport-specific targets and requires each sport’s calibration to lock', async () => {
  const { claim, p } = await planning();
  const sports = [
    brief.sports[0],
    {
      sport: 'cycle',
      currentSessions: { status: 'known', value: 2 },
      desiredSessions: 2,
      weeklyDuration: { status: 'known', value: 10800 },
      longestDuration: { status: 'known', value: 5400 },
    },
    {
      sport: 'swim',
      currentSessions: { status: 'known', value: 1 },
      desiredSessions: 2,
      weeklyDistance: { status: 'known', value: 3000 },
      longestDistance: { status: 'known', value: 2000 },
    },
    { sport: 'strength', currentSessions: { status: 'known', value: 0 }, desiredSessions: 1 },
  ];
  await tool(claim, 'update_plan_brief', {
    brief: { ...brief, goal: 'Olympic triathlon', sports },
    startDate: '2027-01-01',
    endDate: '2027-03-31',
    description: null,
  });
  const leaf = (parentIndex: number, extra: object) => ({
    ...effort,
    parentIndex,
    role: 'work' as const,
    instructions: null,
    ...extra,
  });
  const root = { ...effort, kind: 'sequence', role: null, completion: null, targets: [] };
  const workout = (key: string, date: string, discipline: string, steps: object[]) => ({
    ...batch.workouts[0]!,
    key,
    date,
    discipline,
    title: key,
    steps,
  });
  const minutes = (value: number) => ({ type: 'duration', value: value * 60, unit: 'seconds' });
  const schedule = {
    ...batch,
    workouts: [
      workout('Ride', '2027-01-01', 'cycle', [
        root,
        leaf(0, {
          label: 'Endurance',
          completion: minutes(40),
          targets: [{ type: 'zone', key: 'endurance' }],
        }),
        leaf(0, {
          label: 'Over-geared',
          completion: minutes(10),
          targets: [
            { type: 'power', watts: 240 },
            { type: 'rpe', value: 7 },
          ],
        }),
      ]),
      workout('Swim', '2027-01-02', 'swim', [
        root,
        { ...root, kind: 'repeat', repeatCount: 6, parentIndex: 0 },
        leaf(1, {
          label: '100 at CSS',
          completion: { type: 'distance', value: 100, unit: 'metres' },
          targets: [{ type: 'zone', key: 'threshold' }],
        }),
        leaf(1, {
          role: 'recovery',
          label: 'Rest',
          completion: { type: 'duration', value: 15, unit: 'seconds' },
          targets: [],
        }),
      ]),
      workout('Brick', '2027-01-03', 'mixed', [
        root,
        leaf(0, {
          discipline: 'cycle',
          label: 'Ride',
          completion: minutes(45),
          targets: [{ type: 'zone', key: 'tempo' }],
        }),
        leaf(0, {
          discipline: 'other',
          role: 'transition',
          label: 'T2',
          completion: minutes(2),
          targets: [],
        }),
        leaf(0, {
          discipline: 'run',
          label: 'Run off the bike',
          completion: minutes(15),
          targets: [{ type: 'zone', key: 'marathon' }],
        }),
      ]),
      workout('Strength', '2027-01-04', 'strength', [
        root,
        { ...root, kind: 'repeat', repeatCount: 3, parentIndex: 0 },
        leaf(1, {
          label: 'Back squat',
          completion: { type: 'repetitions', value: 6, unit: 'repetitions' },
          targets: [
            { type: 'rir', value: 2 },
            { type: 'load', kilograms: 60 },
          ],
        }),
        leaf(1, { role: 'recovery', label: 'Rest', completion: minutes(2), targets: [] }),
      ]),
    ],
  };
  const invalid = async (change: (input: typeof schedule) => void) => {
    const input = structuredClone(schedule);
    change(input);
    await expect(tool(claim, 'apply_schedule_changes', input)).rejects.toMatchObject({
      code: 'SCHEDULE_INVALID',
    });
  };
  // Zones belong to the step's sport, sport-specific targets stay with their sport, and a mixed
  // workout names every effort's sport.
  await invalid(
    (input) =>
      ((input.workouts[0]!.steps[1] as { targets: object[] }).targets = [
        { type: 'zone', key: 'interval' },
      ]),
  );
  await invalid(
    (input) =>
      ((input.workouts[3]!.steps[2] as { targets: object[] }).targets = [
        { type: 'zone', key: 'threshold' },
      ]),
  );
  await invalid(
    (input) =>
      ((input.workouts[1]!.steps[2] as { targets: object[] }).targets = [
        { type: 'power', watts: 200 },
      ]),
  );
  await invalid(
    (input) => delete (input.workouts[2]!.steps[1] as { discipline?: string }).discipline,
  );
  await tool(claim, 'record_performance', {
    system: 'cycle_power',
    input: { method: 'ftp', watts: 250 },
    provenance: 'agent_estimate',
    estimateBasis: 'Estimated from reported riding; replace after a ramp test.',
    observedOn: null,
  });
  // Zone targets resolve against the athlete's fitness, so swimming needs calibration first.
  // Withdraw any swim results (the development fixture records one) to start uncalibrated.
  const { retractCalibration, recordCalibration } =
    await import('../../src/modules/performance/performance.service.js');
  for (const entry of (await getPerformance(owner)).entries)
    if (entry.system === 'swim_pace' && !entry.retractedAt)
      await retractCalibration(owner, entry.id);
  await expect(tool(claim, 'apply_schedule_changes', schedule)).rejects.toMatchObject({
    message: expect.stringContaining('matching calibration zone'),
  });
  const swimTest = (await tool(claim, 'record_performance', {
    system: 'swim_pace',
    input: { method: 'css_test', t400Seconds: 380, t200Seconds: 170 },
    provenance: 'user_supplied',
    estimateBasis: '400/200 test last week.',
    observedOn: null,
  })) as { result: { recorded: { id: string } } };
  await expect(
    tool(claim, 'record_performance', {
      system: 'swim_pace',
      input: { method: 'ftp', watts: 200 },
      provenance: 'user_supplied',
      estimateBasis: 'Mismatched system and input.',
      observedOn: null,
    }),
  ).rejects.toMatchObject({ code: 'CALIBRATION_INVALID' });
  await tool(claim, 'apply_schedule_changes', schedule);
  const { versionId } = await runContext(claim.runId, claim.token);
  const rows = await db
    .selectFrom('workouts')
    .innerJoin('workout_steps', 'workout_steps.workout_id', 'workouts.id')
    .leftJoin('step_targets', 'step_targets.step_id', 'workout_steps.id')
    .select([
      'workouts.title',
      'workouts.primary_discipline',
      'workout_steps.label',
      'workout_steps.discipline',
      'step_targets.target_type',
      'step_targets.zone_system',
      'step_targets.zone_key',
      'step_targets.target_value',
      'step_targets.unit',
    ])
    .where('workouts.plan_version_id', '=', versionId)
    .where('workout_steps.kind', '=', 'effort')
    .orderBy('workouts.scheduled_date')
    .orderBy('workout_steps.position')
    .orderBy('step_targets.position')
    .execute();
  const pick = (label: string) =>
    rows
      .filter((row) => row.label === label)
      .map((row) => [row.discipline, row.target_type, row.zone_system ?? row.unit, row.zone_key]);
  expect(pick('Endurance')).toEqual([['cycle', 'zone', 'cycle_power', 'endurance']]);
  // An explicit power gets the calibrated zone it falls in (240 W is threshold at 250 W FTP).
  expect(pick('Over-geared')).toEqual([
    ['cycle', 'power', 'watts', null],
    ['cycle', 'rpe', 'rpe', null],
    ['cycle', 'zone', 'cycle_power', 'threshold'],
  ]);
  expect(pick('100 at CSS')).toEqual([['swim', 'zone', 'swim_pace', 'threshold']]);
  expect(pick('Run off the bike')).toEqual([['run', 'zone', 'run_pace', 'marathon']]);
  expect(pick('T2')).toEqual([['other', null, null, null]]);
  expect(pick('Back squat')).toEqual([
    ['strength', 'rir', 'repetitions', null],
    ['strength', 'load', 'kilograms', null],
  ]);
  expect(new Set(rows.map((row) => row.primary_discipline))).toEqual(
    new Set(['cycle', 'swim', 'mixed', 'strength']),
  );
  await finishRun(claim.runId, claim.token, { status: 'completed', content: 'First week ready.' });
  // Strength needs no calibration; swimming does, and the brick's run and ride are counted.
  const performanceCodes = async () =>
    (await previewLock(owner, p.id)).findings
      .map((f) => f.code)
      .filter((code) => code.startsWith('performance.'));
  expect(await performanceCodes()).toEqual([]);
  const performance = await getPerformance(owner);
  expect(performance.usedByPlans).toEqual(['run_pace', 'cycle_power', 'swim_pace']);
  // Withdrawing the only swim result blocks locking again.
  await retractCalibration(owner, swimTest.result.recorded.id);
  expect(await performanceCodes()).toEqual(['performance.swim_pace_required']);
  await recordCalibration(owner, {
    system: 'swim_pace',
    input: { method: 'css_pace', secondsPer100Metres: 105 },
  });
  expect(await performanceCodes()).toEqual([]);
  const detail = await import('../../src/modules/workouts/workout.repository.js');
  const swim = await db
    .selectFrom('workouts')
    .select('id')
    .where('plan_version_id', '=', versionId)
    .where('primary_discipline', '=', 'swim')
    .executeTakeFirstOrThrow();
  const prescription = (await detail.getWorkoutDetail(owner, swim.id))!.prescription;
  expect(prescription.steps[0]!.steps[0]!.targets[0]!.resolvedZone).toMatchObject({
    metric: 'pace',
    unit: 'seconds_per_100_metres',
    targetValue: 105,
  });
});
