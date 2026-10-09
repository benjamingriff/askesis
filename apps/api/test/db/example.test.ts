import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import { ensureExample } from '../../src/examples/seed.js';
import * as writer from '../../src/examples/writer.js';
import { BLUEPRINT_REVISIONS, buildExample, EXAMPLE_KINDS } from '../../src/examples/blueprint.js';
import {
  getPlan,
  renamePlan,
  createPlan,
  unlockPlan,
} from '../../src/modules/plans/plan.service.js';
import { readAggregate } from '../../src/modules/plans/plan.aggregate.js';
import { contentHash } from '../../src/modules/plans/plan.canonical.js';
import {
  recordCalibration,
  getPerformance,
  retractCalibration,
} from '../../src/modules/performance/performance.service.js';
import { getWorkoutDetail, listWorkouts } from '../../src/modules/workouts/workout.repository.js';
import { createConversationRow } from '../../src/modules/chat/chat.core.js';

const db = getDatabase();
const now = new Date('2026-10-08T12:00:00Z');
const nextWeek = new Date('2026-10-15T12:00:00Z');
afterAll(closeDatabase);
async function athlete() {
  const id = randomUUID();
  await db
    .insertInto('athletes')
    .values({ id, display_name: 'Example test owner', timezone: 'Europe/London' })
    .execute();
  return id;
}

it('publishes all content through the real lifecycle, preserving fitness and owner isolation', async () => {
  const owner = await athlete();
  await recordCalibration(
    owner,
    { system: 'run_pace', input: { method: 'threshold_pace', secondsPerKilometre: 270 } },
    now,
  );
  const before = await getPerformance(owner, now);
  const result = await ensureExample(owner, now);
  expect(result.status).toBe('created');
  expect(result.addedCalibrations).toEqual(['cycle_power', 'swim_pace']);
  expect((await getPerformance(owner, now)).entries.find((e) => e.system === 'run_pace')).toEqual(
    before.entries[0],
  );
  expect(result.plans.map((p) => p.kind)).toEqual([...EXAMPLE_KINDS]);
  for (const seeded of result.plans) {
    const blueprint = buildExample(seeded.kind, result.anchor);
    const plan = await getPlan(owner, seeded.planId);
    expect(plan.displayName).toBe(blueprint.name);
    expect(plan.active).toBe(true);
    expect(plan.draft).toBeNull();
    expect(plan.locked?.versionNumber).toBe(2);
    const versions = await db
      .selectFrom('plan_versions')
      .selectAll()
      .where('plan_id', '=', plan.id)
      .orderBy('version_number')
      .execute();
    expect(versions).toHaveLength(2);
    for (const version of versions) {
      expect(version.content_hash).toBe(
        contentHash((await readAggregate(db, version.id)).semantic),
      );
      expect(version.validation_findings).toEqual([]);
    }
    const versionId = plan.locked!.id;
    expect(
      await db
        .selectFrom('plan_brief_sports')
        .select('sport')
        .where('plan_version_id', '=', versionId)
        .orderBy('sport')
        .execute(),
    ).toEqual(
      blueprint.brief.sports
        .map((s) => ({ sport: s.sport }))
        .sort((a, b) => a.sport.localeCompare(b.sport)),
    );
    expect(
      await db
        .selectFrom('training_blocks')
        .select('phase')
        .where('plan_version_id', '=', versionId)
        .orderBy('start_date')
        .execute(),
    ).toEqual(blueprint.blocks.map((b) => ({ phase: b.phase })));
    expect(
      await db
        .selectFrom('training_weeks')
        .select('week_number')
        .where('plan_version_id', '=', versionId)
        .where('cutback', '=', true)
        .orderBy('week_number')
        .execute(),
    ).toEqual([{ week_number: 4 }, { week_number: 8 }]);
    expect(
      await db
        .selectFrom('training_weeks')
        .select('id')
        .where('plan_version_id', '=', versionId)
        .execute(),
    ).toHaveLength(12);
    expect(
      await db
        .selectFrom('plan_schedule_coverage')
        .selectAll()
        .where('plan_version_id', '=', versionId)
        .execute(),
    ).toEqual([expect.objectContaining({ start_date: '2026-09-28', end_date: '2026-12-20' })]);
    const workouts = await listWorkouts(owner, versionId);
    expect(workouts).toHaveLength(blueprint.weeks.reduce((sum, w) => sum + w.sessions.length, 0));
    const weekSeconds = (week: number) =>
      workouts
        .filter((w) => w.weekNumber === week)
        .reduce((sum, w) => sum + (w.estimatedDurationSeconds ?? 0), 0);
    expect(weekSeconds(4)).toBeLessThan(weekSeconds(3) * 0.8);
    expect(await listWorkouts(await athlete(), versionId)).toEqual([]);
    for (const workout of workouts) {
      const detail = await getWorkoutDetail(owner, workout.id);
      expect(detail?.tags.length).toBeGreaterThan(0);
      expect(detail?.prescription.steps.length).toBeGreaterThan(0);
    }
    await expect(
      db
        .updateTable('workouts')
        .set({ title: 'Illegal immutable edit' })
        .where('id', '=', workouts[0]!.id)
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  }
}, 60000);

it('serializes simultaneous first seeds and reruns without duplicating plans or estimates', async () => {
  const owner = await athlete();
  const results = await Promise.all([ensureExample(owner, now), ensureExample(owner, now)]);
  expect(results.map((r) => r.status).sort()).toEqual(['created', 'unchanged']);
  expect(results[0]!.planId).toBe(results[1]!.planId);
  expect((await getPerformance(owner, now)).entries).toHaveLength(3);
  expect((await ensureExample(owner, now)).status).toBe('unchanged');
}, 60000);

it('replaces only untouched managed editions, preserving edited examples and personal plans', async () => {
  const owner = await athlete();
  const initial = await ensureExample(owner, now);
  const second = await ensureExample(owner, nextWeek);
  expect((await getPlan(owner, initial.planId!)).archived).toBe(true);
  const example = await getPlan(owner, second.planId!);
  await renamePlan(owner, example.id, 'My modified example', example.stateVersion);
  expect((await ensureExample(owner, nextWeek)).status).toBe('preserved');
  const personal = await createPlan(owner, 'My own plan', randomUUID());
  await ensureExample(owner, new Date('2026-10-22T12:00:00Z'));
  expect((await getPlan(owner, example.id)).archived).toBe(false);
  expect((await getPlan(owner, personal.id)).draft?.id).toBe(personal.draft?.id);
}, 60000);

it('does not archive an unlocked example or one with an active coaching turn', async () => {
  const owner = await athlete();
  const initial = await ensureExample(owner, now);
  const plan = await getPlan(owner, initial.planId!);
  await unlockPlan(owner, plan.id, plan.stateVersion);
  const second = await ensureExample(owner, nextWeek);
  const runId = randomUUID();
  await db.transaction().execute(async (tx) => {
    const conversationId = await createConversationRow(tx, owner, second.planId!);
    const messageId = randomUUID();
    await tx
      .insertInto('conversation_messages')
      .values({
        id: messageId,
        conversation_id: conversationId,
        sequence: 1,
        role: 'user',
        content: 'Review this example',
      })
      .execute();
    await tx
      .insertInto('agent_runs')
      .values({
        id: runId,
        owner_id: owner,
        conversation_id: conversationId,
        user_message_id: messageId,
        plan_id: second.planId,
        deadline_at: new Date(Date.now() + 60000),
      })
      .execute();
  });
  try {
    await ensureExample(owner, new Date('2026-10-22T12:00:00Z'));
    expect((await getPlan(owner, plan.id)).draft).not.toBeNull();
    expect((await getPlan(owner, second.planId!)).archived).toBe(false);
  } finally {
    await db
      .updateTable('agent_runs')
      .set({ status: 'failed', failure_code: 'TEST_COMPLETE', finished_at: new Date() })
      .where('id', '=', runId)
      .execute();
  }
}, 60000);

it('rolls back failed replacement and retries while the previous edition stays intact', async () => {
  const owner = await athlete();
  const initial = await ensureExample(owner, now);
  const originalWrite = writer.writeExample;
  const write = vi
    .spyOn(writer, 'writeExample')
    .mockImplementationOnce(originalWrite)
    .mockRejectedValueOnce(new Error('Interrupted writer'));
  try {
    await expect(ensureExample(owner, nextWeek)).rejects.toThrow('Interrupted writer');
  } finally {
    write.mockRestore();
  }
  expect((await getPlan(owner, initial.planId!)).active).toBe(true);
  expect(
    await db.selectFrom('plans').select('id').where('owner_id', '=', owner).execute(),
  ).toHaveLength(3);
  expect(
    await db
      .selectFrom('example_plan_editions')
      .select('plan_id')
      .where('owner_id', '=', owner)
      .execute(),
  ).toHaveLength(3);
  expect((await ensureExample(owner, nextWeek)).status).toBe('created');
}, 60000);

it('rolls back new estimates on first-publication failure and respects withdrawn fitness', async () => {
  const owner = await athlete();
  const originalWrite = writer.writeExample;
  const write = vi
    .spyOn(writer, 'writeExample')
    .mockImplementationOnce(originalWrite)
    .mockRejectedValueOnce(new Error('Interrupted writer'));
  try {
    await expect(ensureExample(owner, now)).rejects.toThrow('Interrupted writer');
  } finally {
    write.mockRestore();
  }
  expect((await getPerformance(owner, now)).entries).toEqual([]);
  expect(await db.selectFrom('plans').select('id').where('owner_id', '=', owner).execute()).toEqual(
    [],
  );
  await ensureExample(owner, now);
  const entry = (await getPerformance(owner, now)).entries.find((e) => e.system === 'cycle_power')!;
  await retractCalibration(owner, entry.id);
  expect((await ensureExample(owner, nextWeek)).status).toBe('calibration-required');
  expect((await getPerformance(owner, now)).entries).toHaveLength(3);
}, 60000);

it('checks missing fitness under the athlete lock, preserving a simultaneous real result', async () => {
  const owner = await athlete();
  let seeded: ReturnType<typeof ensureExample> | undefined;
  await db.transaction().execute(async (tx) => {
    await tx.selectFrom('athletes').select('id').where('id', '=', owner).forUpdate().execute();
    seeded = ensureExample(owner, now);
    // Give the other connection a chance to reach the blocked athlete lock.
    for (let i = 0; i < 100; i++) {
      const { rows } = await sql<{
        blocked: boolean;
      }>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%athletes%' AND pid <> pg_backend_pid()) AS blocked`.execute(
        tx,
      );
      if (rows[0]?.blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const { recordCalibrationRows } =
      await import('../../src/modules/performance/performance.service.js');
    await recordCalibrationRows(
      tx,
      owner,
      { system: 'cycle_power', input: { method: 'ftp', watts: 310 } },
      { now },
    );
  });
  expect((await seeded!).addedCalibrations).not.toContain('cycle_power');
  expect(
    (await getPerformance(owner, now)).entries.find((e) => e.system === 'cycle_power')?.input,
  ).toEqual({ method: 'ftp', watts: 310 });
}, 60000);

it('replaces the former managed showcase without duplicating other current blueprints', async () => {
  const owner = await athlete();
  const initial = await ensureExample(owner, now);
  // An untouched published plan with the former revision models the deployed registry.
  await db
    .updateTable('example_plan_editions')
    .set({ blueprint_revision: 'multisport-showcase-v3-legacy' })
    .where('owner_id', '=', owner)
    .where('blueprint_revision', '=', BLUEPRINT_REVISIONS.cycling)
    .execute();
  const next = await ensureExample(owner, now);
  expect(next.plans.map((p) => p.status)).toEqual(['created', 'unchanged', 'unchanged']);
  expect(next.plans.slice(1).map((p) => p.planId)).toEqual(
    initial.plans.slice(1).map((p) => p.planId),
  );
  expect((await getPlan(owner, initial.planId!)).archived).toBe(true);
  expect(
    await db
      .selectFrom('plans')
      .select('id')
      .where('owner_id', '=', owner)
      .where('archived_at', 'is', null)
      .execute(),
  ).toHaveLength(3);
  expect((await ensureExample(owner, now)).status).toBe('unchanged');
}, 60000);

it('can update the gym blueprint without restoring withdrawn endurance fitness', async () => {
  const owner = await athlete();
  const initial = await ensureExample(owner, now);
  const swim = (await getPerformance(owner, now)).entries.find((e) => e.system === 'swim_pace')!;
  await retractCalibration(owner, swim.id);
  await db
    .updateTable('example_plan_editions')
    .set({ blueprint_revision: 'strength-hiit-example-v0' })
    .where('owner_id', '=', owner)
    .where('blueprint_revision', '=', BLUEPRINT_REVISIONS['strength-hiit'])
    .execute();
  const result = await ensureExample(owner, now);
  expect(result.status).toBe('created');
  expect(result.plans.map((p) => p.status)).toEqual(['unchanged', 'unchanged', 'created']);
  expect(result.addedCalibrations).toEqual([]);
  expect(result.plans.slice(0, 2).map((p) => p.planId)).toEqual(
    initial.plans.slice(0, 2).map((p) => p.planId),
  );
  expect(
    (await getPerformance(owner, now)).entries.find((e) => e.id === swim.id)?.retractedAt,
  ).not.toBeNull();
}, 60000);
