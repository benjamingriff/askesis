import { resetApiConfigForTests } from '../../src/config.js';
import { createConversation } from '../../src/modules/chat/chat.service.js';
import {
  registerWorker,
  claimRun,
  runContext,
  executeTool,
  finishRun,
} from '../../src/modules/agent/agent.service.js';
import { PROMPT_VERSION } from '../../src/modules/agent/agent.schemas.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getDatabase, closeDatabase } from '../../src/database/client.js';
import { recordCalibration } from '../../src/modules/performance/performance.service.js';
import { listWorkouts, getWorkoutDetail } from '../../src/modules/workouts/workout.repository.js';
import { cloneContent, readAggregate } from '../../src/modules/plans/plan.aggregate.js';
import { contentHash } from '../../src/modules/plans/plan.canonical.js';
import {
  getPlan,
  discardDraft,
  createPlan,
  editDraft,
  unlockPlan,
  previewLock,
  lockPlan,
  previewRestore,
  restoreRevision,
  organizePlan,
} from '../../src/modules/plans/plan.service.js';
import {
  getBrief,
  confirmBrief,
  recordDraftChange,
} from '../../src/modules/plans/brief.service.js';
import {
  saveLogRows,
  clearLogRows,
  readTrainingLog,
  feedbackReferences,
  resolveFeedback,
  createCheckInRows,
  logCommand,
} from '../../src/modules/training-log/training-log.service.js';
import { LogSchema } from '../../src/modules/training-log/training-log.schemas.js';
const db = getDatabase(),
  owner = randomUUID();
let planId: string;
const now = new Date('2026-10-14T12:00:00Z');
beforeAll(async () => {
  await db
    .insertInto('athletes')
    .values({ id: owner, display_name: 'Log tests', timezone: 'Europe/London' })
    .execute();
  let plan = await createPlan(owner, 'Workout log fixture', randomUUID());
  plan = await editDraft(owner, plan.id, {
    expectedDraftId: plan.draft!.id,
    expectedEditNumber: plan.draft!.editNumber,
    description: 'Logging fixture',
    startDate: '2026-05-11',
    endDate: '2026-10-04',
  });
  planId = plan.id;
  await db
    .transaction()
    .execute((tx) => cloneContent(tx, '00000000-0000-0000-0000-000000000050', plan.draft!.id));
  await recordCalibration(owner, {
    system: 'run_pace',
    input: { method: 'threshold_pace', secondsPerKilometre: 300 },
    provenance: 'user_estimate',
    estimateBasis: 'Synthetic test estimate.',
  });
  await publish();
});
afterAll(closeDatabase);
const write = (lineageId: string, input: Parameters<typeof saveLogRows>[4]) =>
  db.transaction().execute((tx) => saveLogRows(tx, owner, planId, lineageId, input, { now }));
async function publish() {
  const brief = await getBrief(owner, planId);
  await confirmBrief(owner, planId, {
    expectedDraftId: brief.versionId,
    expectedEditNumber: brief.editNumber,
    expectedHash: brief.hash,
    acknowledgedWarningCodes: brief.findings
      .filter((f) => f.severity === 'warning')
      .map((f) => f.code),
  });
  const p = await previewLock(owner, planId);
  return lockPlan(
    owner,
    planId,
    {
      expectedStateVersion: p.stateVersion,
      expectedDraftId: p.draftId,
      expectedEditNumber: p.editNumber,
      expectedContentHash: p.contentHash,
      expectedValidationDigest: p.validationDigest,
      acknowledgedWarningCodes: p.findings
        .filter((f) => f.severity === 'warning')
        .map((f) => f.code),
    },
    randomUUID(),
  );
}
it('logs while locked or unlocked, preserves hashes, hides foreign owners and rejects future actuals', async () => {
  const plan = await getPlan(owner, planId),
    workouts = await listWorkouts(owner, plan.locked!.id),
    workout = workouts.find((w) => w.scheduledDate === '2026-05-12')!;
  for (const scheduled of workouts) {
    expect((await getWorkoutDetail(owner, scheduled.id))?.workout.plannedRpe).toBe(
      scheduled.plannedRpe,
    );
  }
  const before = contentHash((await readAggregate(db, plan.locked!.id)).semantic);
  const logged = await write(workout.lineageId, { status: 'done' });
  expect(logged).toMatchObject({
    status: 'done',
    plannedRpe: workout.plannedRpe,
    actualDurationSeconds: workout.estimatedDurationSeconds,
  });
  expect(contentHash((await readAggregate(db, plan.locked!.id)).semantic)).toBe(before);
  expect((await getPlan(owner, planId)).stateVersion).toBe(plan.stateVersion);
  await expect(
    db
      .transaction()
      .execute((tx) =>
        saveLogRows(tx, randomUUID(), planId, workout.lineageId, { status: 'done' }, { now }),
      ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(readTrainingLog(db, randomUUID(), { planId })).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    db
      .transaction()
      .execute((tx) =>
        saveLogRows(
          tx,
          owner,
          planId,
          workouts.find((w) => w.lineageId !== workout.lineageId)!.lineageId,
          { status: 'done' },
          { now: new Date('2026-05-10T12:00:00Z') },
        ),
      ),
  ).rejects.toMatchObject({ code: 'WORKOUT_IN_FUTURE' });
  await expect(
    write(workout.lineageId, { status: 'done', performedOn: '2026-10-15' }),
  ).rejects.toMatchObject({ code: 'LOG_IN_FUTURE' });
  await write(workout.lineageId, { status: 'done', performedOn: '2026-05-19' });
  const scheduledWeek = await readTrainingLog(
    db,
    owner,
    { planId, from: '2026-05-11', to: '2026-05-17' },
    now,
  );
  expect(scheduledWeek.logs).toHaveLength(0);
  expect(scheduledWeek.summary.unlogged).toBe(scheduledWeek.summary.due - 1);
  const performedWeek = await readTrainingLog(
    db,
    owner,
    { planId, from: '2026-05-18', to: '2026-05-24' },
    now,
  );
  expect(performedWeek.summary.done).toBe(1);
  expect(
    performedWeek.summary.bySport.find((s) => s.discipline === workout.discipline)?.actualSeconds,
  ).toBe(workout.estimatedDurationSeconds);
  await unlockPlan(owner, planId, plan.stateVersion);
  const edited = await write(workout.lineageId, {
    status: 'changed',
    actualDurationSeconds: 1200,
    rpe: 8,
    note: 'Shortened after poor sleep',
    reasons: ['poor_sleep'],
  });
  expect(edited.id).toBe(logged.id);
  expect(edited.loggedVersionId).toBe(logged.loggedVersionId);
  expect((await readTrainingLog(db, owner, { planId })).logs[0]?.note).toContain('Shortened');
  const review = await previewLock(owner, planId);
  expect(review.hasChanges).toBe(false);
  await discardDraft(
    owner,
    planId,
    {
      expectedStateVersion: review.stateVersion,
      expectedDraftId: review.draftId,
      expectedEditNumber: review.editNumber,
      expectedContentHash: review.contentHash,
      expectedValidationDigest: review.validationDigest,
      acknowledgedWarningCodes: review.findings
        .filter((f) => f.severity === 'warning')
        .map((f) => f.code),
    },
    randomUUID(),
  );
});
it('allows detached history correction after restore and relock, and marks changed/cleared references', async () => {
  const first = await getPlan(owner, planId),
    draft = await unlockPlan(owner, planId, first.stateVersion);
  const row = await db
    .selectFrom('workouts')
    .selectAll()
    .where('plan_version_id', '=', draft.draft!.id)
    .where('scheduled_date', '=', new Date('2026-05-11'))
    .executeTakeFirstOrThrow();
  const newLineage = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('workouts')
      .set({ title: 'Replacement strength session', lineage_id: newLineage })
      .where('id', '=', row.id)
      .execute();
    await recordDraftChange(tx, draft.draft!.id, 'invalidate-confirmation-and-review-schedule');
  });
  const second = await publish(),
    logged = await write(newLineage, { status: 'done', feel: 4, note: 'Original report' });
  const references = await feedbackReferences(db, owner, planId, [
    { type: 'workout_log', logId: logged.id },
  ]);
  await expect(
    feedbackReferences(db, randomUUID(), planId, [{ type: 'workout_log', logId: logged.id }]),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    feedbackReferences(db, owner, randomUUID(), [{ type: 'workout_log', logId: logged.id }]),
  ).rejects.toMatchObject({ status: 404 });
  const review = await previewRestore(owner, planId, first.locked!.id);
  await restoreRevision(
    owner,
    planId,
    first.locked!.id,
    {
      expectedStateVersion: review.stateVersion,
      expectedCurrentVersionId: review.currentVersionId,
      expectedSourceHash: review.sourceHash,
    },
    randomUUID(),
  );
  const restored = await publish();
  expect(
    (await listWorkouts(owner, restored.locked!.id)).some((w) => w.lineageId === newLineage),
  ).toBe(false);
  const corrected = await write(newLineage, {
    status: 'changed',
    actualDurationSeconds: 1500,
    note: 'Corrected report',
  });
  expect(corrected).toMatchObject({
    id: logged.id,
    loggedVersionId: second.locked!.id,
    title: 'Replacement strength session',
    note: 'Corrected report',
  });
  expect((await resolveFeedback(db, owner, references))[0]).toMatchObject({
    state: 'changed',
    snapshot: { note: 'Original report' },
    current: { note: 'Corrected report' },
  });
  await db.transaction().execute((tx) => clearLogRows(tx, owner, planId, newLineage));
  expect((await readTrainingLog(db, owner, { planId })).logs.some((l) => l.id === logged.id)).toBe(
    false,
  );
  expect((await resolveFeedback(db, owner, references))[0]).toMatchObject({
    state: 'cleared',
    current: null,
    snapshot: { note: 'Original report' },
  });
});
it('passes authorized feedback through worker context and records from chat without unlocking', async () => {
  const previousMode = process.env.CHAT_EXECUTION_MODE,
    previousToken = process.env.AGENT_BOOTSTRAP_TOKEN;
  process.env.CHAT_EXECUTION_MODE = 'agent';
  process.env.AGENT_BOOTSTRAP_TOKEN = 'workout-log-test-bootstrap-token-32-characters';
  resetApiConfigForTests();
  try {
    const workerId = randomUUID();
    await registerWorker({
      id: workerId,
      provider: 'openai',
      model: 'scripted',
      reasoning: 'low',
      promptVersion: PROMPT_VERSION,
      ready: true,
    });
    const plan = await getPlan(owner, planId),
      logs = (await readTrainingLog(db, owner, { planId })).logs,
      log = logs[0]!;
    const created = await createConversation(
      owner,
      {
        planId,
        initialMessage: {
          content: 'I corrected my report. Please record this as skipped.',
          target: { versionId: plan.locked!.id, editNumber: plan.locked!.editNumber },
          references: [{ type: 'workout_log', logId: log.id }],
        },
      },
      randomUUID(),
    );
    expect(created.accepted?.message.references?.[0]).toMatchObject({
      type: 'workout_log',
      logId: log.id,
      snapshot: { note: log.note },
    });
    const claim = (await claimRun(workerId)).claim!;
    expect(claim.runId).toBe(created.accepted!.run.id);
    const context = await runContext(claim.runId, claim.token);
    expect(context.trainingLog).toHaveProperty('summary');
    expect(context.messages.at(-1)?.references[0]).toMatchObject({
      type: 'workout_log',
      state: 'saved',
    });
    const tool = (name: string, input: unknown) =>
      executeTool(claim.runId, claim.token, {
        operationId: randomUUID(),
        name,
        input,
        expectedVersionId: context.versionId,
        expectedEditNumber: context.editNumber,
      });
    const read = await tool('read_training_log', { from: '2026-05-01', to: '2026-05-31' });
    expect(read.result).toMatchObject({
      logs: expect.arrayContaining([expect.objectContaining({ id: log.id })]),
    });
    const recorded = await tool('record_workout_log', {
      planId,
      lineageId: log.lineageId,
      log: { status: 'skipped', note: 'Corrected in chat' },
    });
    expect(recorded.result).toMatchObject({
      id: log.id,
      status: 'skipped',
      source: 'coach',
      actualDurationSeconds: null,
    });
    expect((await getPlan(owner, planId)).locked).toEqual(plan.locked);
    expect(
      (await runContext(claim.runId, claim.token)).messages.at(-1)?.references[0],
    ).toMatchObject({ state: 'changed', current: { note: 'Corrected in chat' } });
    await finishRun(claim.runId, claim.token, {
      status: 'completed',
      content: 'Recorded the workout as skipped. Your plan stays locked.',
    });
  } finally {
    if (previousMode === undefined) delete process.env.CHAT_EXECUTION_MODE;
    else process.env.CHAT_EXECUTION_MODE = previousMode;
    if (previousToken === undefined) delete process.env.AGENT_BOOTSTRAP_TOKEN;
    else process.env.AGENT_BOOTSTRAP_TOKEN = previousToken;
    resetApiConfigForTests();
  }
});
it('replays a PUT without recreating cleared data, validates answers, and archives logs read-only', async () => {
  const plan = await getPlan(owner, planId),
    workout = (await listWorkouts(owner, plan.locked!.id)).find(
      (w) => w.discipline === 'run' && w.scheduledDate === '2026-05-12',
    )!;
  const key = randomUUID(),
    input = { status: 'done' as const, rpe: 4 };
  const put = () =>
    logCommand(
      owner,
      'log.put',
      key,
      { planId, lineageId: workout.lineageId, input },
      LogSchema,
      (tx) => saveLogRows(tx, owner, planId, workout.lineageId, input, { now }),
    );
  const first = await put();
  await db.transaction().execute((tx) => clearLogRows(tx, owner, planId, workout.lineageId));
  expect(await put()).toEqual(first);
  expect((await readTrainingLog(db, owner, { planId })).logs.some((l) => l.id === first.id)).toBe(
    false,
  );
  await expect(write(workout.lineageId, { status: 'skipped', rpe: 4 })).rejects.toThrow();
  await expect(
    write(workout.lineageId, { status: 'done', answers: { weights: 'heavy' } }),
  ).rejects.toMatchObject({ code: 'LOG_ANSWERS_INVALID' });
  const skipped = await write(workout.lineageId, { status: 'skipped', reasons: ['ill'] });
  expect(skipped.actualDurationSeconds).toBeNull();
  const check = await db.transaction().execute((tx) =>
    createCheckInRows(tx, owner, {
      planId,
      kind: 'run_down',
      startsOn: '2026-10-14',
      endsOn: '2026-10-16',
      details: { preference: 'easy', returnStyle: 'gently' },
    }),
  );
  await expect(
    feedbackReferences(db, randomUUID(), planId, [{ type: 'check_in', checkInId: check.id }]),
  ).rejects.toMatchObject({ status: 404 });
  const events = await db
    .selectFrom('live_events')
    .selectAll()
    .where('owner_id', '=', owner)
    .where('type', '=', 'training_log.changed')
    .execute();
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((e) => Object.keys(e.metadata as object).length === 1)).toBe(true);
  await organizePlan(owner, planId, 'archive', (await getPlan(owner, planId)).stateVersion);
  await expect(write(workout.lineageId, { status: 'done' })).rejects.toMatchObject({
    code: 'PLAN_ARCHIVED',
  });
  await expect(
    db.transaction().execute((tx) => clearLogRows(tx, owner, planId, workout.lineageId)),
  ).rejects.toMatchObject({ code: 'PLAN_ARCHIVED' });
  await expect(
    db.transaction().execute((tx) =>
      createCheckInRows(tx, owner, {
        planId,
        kind: 'busy',
        startsOn: '2026-10-14',
        endsOn: null,
        details: { preference: 'coach', returnStyle: 'balanced' },
      }),
    ),
  ).rejects.toMatchObject({ code: 'PLAN_ARCHIVED' });
  expect((await readTrainingLog(db, owner, { planId })).logs.length).toBeGreaterThan(0);
});
