import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { getDatabase, closeDatabase } from '../../src/database/client.js';
import {
  cloneContent,
  affectedWorkouts,
  readAggregate,
} from '../../src/modules/plans/plan.aggregate.js';
import {
  createPlan,
  getDraft,
  getPlan,
  organizePlan,
} from '../../src/modules/plans/plan.service.js';

const owner = '00000000-0000-0000-0000-000000000001';
const fixture = '00000000-0000-0000-0000-000000000050';
afterAll(closeDatabase);

it('publishes the fixture with genuine validation and immutable content', async () => {
  const plan = await getPlan(owner, '00000000-0000-0000-0000-000000000010');
  expect(plan.active).toBe(true);
  expect(plan.draft).toBeNull();
  expect(plan.locked?.versionNumber).toBe(1);
  const row = await getDatabase()
    .selectFrom('plan_versions')
    .selectAll()
    .where('id', '=', fixture)
    .executeTakeFirstOrThrow();
  expect(row.validator_version).toBe(4);
  expect(row.content_schema_version).toBe(4);
  // Locked against the fixture athlete's latest race result.
  expect(row.calibration_basis).toEqual([
    expect.objectContaining({ system: 'run_pace', effectiveFrom: '2026-05-21' }),
  ]);
  expect(row.content_hash).toMatch(/^[a-f0-9]{64}$/);
});

it('enforces complete local trees at commit and exposes archived draft content', async () => {
  const db = getDatabase();
  const plan = await createPlan(owner, 'Structure test', randomUUID());
  const id = plan.draft!.id;
  await db.transaction().execute((tx) => cloneContent(tx, fixture, id));
  const root = await db
    .selectFrom('workout_steps')
    .selectAll()
    .where('plan_version_id', '=', id)
    .where('parent_step_id', 'is', null)
    .executeTakeFirstOrThrow();
  const effort = await db
    .selectFrom('workout_steps')
    .selectAll()
    .where('plan_version_id', '=', id)
    .where('kind', '=', 'effort')
    .executeTakeFirstOrThrow();
  await expect(
    db.deleteFrom('step_completions').where('step_id', '=', effort.id).execute(),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db
      .updateTable('workout_steps')
      .set({ parent_step_id: root.id, position: 999 })
      .where('id', '=', root.id)
      .execute(),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db
      .insertInto('step_targets')
      .values({
        plan_version_id: id,
        step_id: root.id,
        position: 1,
        target_type: 'instruction',
        text_value: 'Invalid container target',
      })
      .execute(),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db
      .updateTable('step_completions')
      .set({ completion_type: 'duration', numeric_value: '10', unit: 'metres' })
      .where('step_id', '=', effort.id)
      .execute(),
  ).rejects.toMatchObject({ code: '23514' });
  const before = await readAggregate(db, id);
  await db
    .updateTable('workouts')
    .set({ title: 'Renamed workout' })
    .where('id', '=', effort.workout_id)
    .execute();
  const after = await readAggregate(db, id);
  expect(affectedWorkouts(before, after)).toEqual([
    expect.objectContaining({ title: 'Renamed workout', change: 'changed' }),
  ]);
  await organizePlan(owner, plan.id, 'archive', plan.stateVersion);
  const draft = await getDraft(owner, plan.id);
  expect(draft.version.id).toBe(id);
  expect(draft.content).toEqual(after.semantic);
  await expect(getDraft(randomUUID(), plan.id)).rejects.toMatchObject({ status: 404 });
});

it('keeps deferred structure checks for disconnected cycles and transactional repairs', async () => {
  const db = getDatabase();
  const plan = await createPlan(owner, 'Deferred structure regression', randomUUID());
  const versionId = plan.draft!.id;
  await db.transaction().execute((tx) => cloneContent(tx, fixture, versionId));
  const efforts = await db
    .selectFrom('workout_steps')
    .selectAll()
    .where('plan_version_id', '=', versionId)
    .where('kind', '=', 'effort')
    .orderBy('workout_id')
    .execute();
  const first = efforts.find(
    (step) => efforts.filter((other) => other.workout_id === step.workout_id).length >= 2,
  )!;
  const second = efforts.find(
    (step) => step.workout_id === first.workout_id && step.id !== first.id,
  )!;
  await expect(
    db.transaction().execute(async (tx) => {
      await tx
        .updateTable('workout_steps')
        .set({ parent_step_id: second.id, position: 9001 })
        .where('id', '=', first.id)
        .execute();
      await tx
        .updateTable('workout_steps')
        .set({ parent_step_id: first.id, position: 9002 })
        .where('id', '=', second.id)
        .execute();
    }),
  ).rejects.toMatchObject({ code: '23514', message: 'Workout has disconnected or cyclic steps' });
  const completion = await db
    .selectFrom('step_completions')
    .selectAll()
    .where('step_id', '=', first.id)
    .executeTakeFirstOrThrow();
  await db.transaction().execute(async (tx) => {
    await tx.deleteFrom('step_completions').where('step_id', '=', first.id).execute();
    await tx.insertInto('step_completions').values(completion).execute();
  });
  expect(
    await db
      .selectFrom('step_completions')
      .selectAll()
      .where('step_id', '=', first.id)
      .executeTakeFirstOrThrow(),
  ).toEqual(completion);
  await expect(
    db
      .updateTable('workout_steps')
      .set({ kind: 'sequence', discipline: null })
      .where('id', '=', first.id)
      .execute(),
  ).rejects.toMatchObject({ code: '23514', message: 'Invalid effort or container prescription' });
});
