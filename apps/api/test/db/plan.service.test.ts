import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import { cloneContent, readAggregate } from '../../src/modules/plans/plan.aggregate.js';
import { contentHash } from '../../src/modules/plans/plan.canonical.js';
import { listPlans, organizePlan, renamePlan } from '../../src/modules/plans/plan.service.js';
import {
  createPlan,
  discardDraft,
  editDraft,
  getPlan,
  lockPlan,
  previewLock,
  unlockPlan,
} from '../../src/modules/plans/plan.service.js';

const owner = '00000000-0000-0000-0000-000000000001';
afterAll(closeDatabase);

it('organizes plans without altering versions and preserves archived drafts', async () => {
  const initial = await prepared();
  await expect(
    organizePlan(owner, initial.id, 'activate', initial.stateVersion),
  ).rejects.toMatchObject({ code: 'LOCKED_VERSION_REQUIRED' });
  const locked = await lockPlan(owner, initial.id, await confirmation(initial.id), randomUUID());
  const renamed = await renamePlan(owner, initial.id, 'Renamed', locked.stateVersion);
  expect(renamed.locked).toEqual(locked.locked);
  expect(await renamePlan(owner, initial.id, 'Renamed', renamed.stateVersion)).toEqual(renamed);
  await expect(renamePlan(owner, initial.id, 'Stale', locked.stateVersion)).rejects.toMatchObject({
    code: 'STALE_PLAN',
  });
  const active = await organizePlan(owner, initial.id, 'activate', renamed.stateVersion);
  expect(await organizePlan(owner, initial.id, 'activate', renamed.stateVersion)).toEqual(active);
  const unlocked = await unlockPlan(owner, initial.id, active.stateVersion);
  expect(unlocked.active).toBe(true);
  const archived = await organizePlan(owner, initial.id, 'archive', unlocked.stateVersion);
  expect(archived.active).toBe(false);
  expect(archived.draft).toEqual(unlocked.draft);
  expect(archived.locked).toEqual(unlocked.locked);
  expect(await organizePlan(owner, initial.id, 'archive', unlocked.stateVersion)).toEqual(archived);
  expect((await listPlans(owner)).some((p) => p.id === initial.id)).toBe(false);
  expect((await listPlans(owner, 'archive')).some((p) => p.id === initial.id)).toBe(true);
  await expect(
    renamePlan(owner, initial.id, 'Forbidden', archived.stateVersion),
  ).rejects.toMatchObject({ code: 'PLAN_ARCHIVED' });
  await expect(
    organizePlan(owner, initial.id, 'activate', archived.stateVersion),
  ).rejects.toMatchObject({ code: 'PLAN_ARCHIVED' });
  for (const action of ['activate', 'deactivate', 'archive', 'unarchive'] as const) {
    await expect(
      organizePlan(randomUUID(), initial.id, action, archived.stateVersion),
    ).rejects.toMatchObject({ status: 404 });
  }
  const restored = await organizePlan(owner, initial.id, 'unarchive', archived.stateVersion);
  expect(restored.active).toBe(false);
  expect(restored.draft).toEqual(unlocked.draft);
  expect(restored.locked).toEqual(unlocked.locked);
  const another = await prepared();
  const otherLocked = await lockPlan(
    owner,
    another.id,
    await confirmation(another.id),
    randomUUID(),
  );
  await organizePlan(owner, another.id, 'activate', otherLocked.stateVersion);
  await organizePlan(owner, initial.id, 'activate', restored.stateVersion);
  const activeIds = (await listPlans(owner, 'active')).map((p) => p.id);
  expect(activeIds).toEqual(expect.arrayContaining([initial.id, another.id]));
});

it('archives an initial draft and serializes conflicting metadata commands', async () => {
  const plan = await prepared();
  const results = await Promise.allSettled([
    renamePlan(owner, plan.id, 'Concurrent rename', plan.stateVersion),
    organizePlan(owner, plan.id, 'archive', plan.stateVersion),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const current = await getPlan(owner, plan.id);
  const archived = await organizePlan(owner, plan.id, 'archive', current.stateVersion);
  expect(archived.draft).toEqual(plan.draft);
  expect(archived.locked).toBeNull();
});

async function prepared() {
  const plan = await createPlan(owner, 'Lifecycle test', randomUUID());
  const edited = await editDraft(owner, plan.id, {
    expectedDraftId: plan.draft!.id,
    expectedEditNumber: plan.draft!.editNumber,
    description: 'Test plan',
    startDate: '2026-05-11',
    endDate: '2026-10-04',
  });
  expect(edited.draft?.startDate).toBe('2026-05-11');
  expect(edited.draft?.endDate).toBe('2026-10-04');
  return edited;
}
async function confirmation(id: string) {
  const preview = await previewLock(owner, id);
  return {
    expectedStateVersion: preview.stateVersion,
    expectedDraftId: preview.draftId,
    expectedEditNumber: preview.editNumber,
    expectedContentHash: preview.contentHash,
    expectedValidationDigest: preview.validationDigest,
    acknowledgedWarningCodes: preview.findings
      .filter((f) => f.severity === 'warning')
      .map((f) => f.code),
  };
}

it('serializes duplicate creation and rejects reuse with different input', async () => {
  const key = randomUUID();
  const [a, b] = await Promise.all([
    createPlan(owner, 'Duplicate', key),
    createPlan(owner, 'Duplicate', key),
  ]);
  expect(a.id).toBe(b.id);
  await expect(createPlan(owner, 'Different', key)).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await expect(getPlan(randomUUID(), a.id)).rejects.toMatchObject({ status: 404 });
});

it('requires current validation and warning acknowledgement, and preserves immutable versions', async () => {
  const plan = await prepared();
  const input = await confirmation(plan.id);
  await expect(
    lockPlan(owner, plan.id, { ...input, acknowledgedWarningCodes: [] }, randomUUID()),
  ).rejects.toMatchObject({ code: 'WARNINGS_UNACKNOWLEDGED' });
  const key = randomUUID();
  const locked = await lockPlan(owner, plan.id, input, key);
  expect(locked.locked?.versionNumber).toBe(1);
  expect(await lockPlan(owner, plan.id, input, key)).toEqual(locked);
  const unlocked = await unlockPlan(owner, plan.id, locked.stateVersion);
  expect((await previewLock(owner, plan.id)).hasChanges).toBe(false);
  expect((await unlockPlan(owner, plan.id, locked.stateVersion)).draft?.id).toBe(
    unlocked.draft?.id,
  );
  await expect(
    lockPlan(owner, plan.id, await confirmation(plan.id), randomUUID()),
  ).rejects.toMatchObject({ code: 'NO_CHANGES' });
  const oldConfirmation = await confirmation(plan.id);
  const edited = await editDraft(owner, plan.id, {
    expectedDraftId: unlocked.draft!.id,
    expectedEditNumber: unlocked.draft!.editNumber,
    description: 'Changed description',
    startDate: '2026-05-11',
    endDate: '2026-10-04',
  });
  await expect(lockPlan(owner, plan.id, oldConfirmation, randomUUID())).rejects.toMatchObject({
    code: 'STALE_DRAFT',
  });
  expect(edited.locked?.description).toBe('Test plan');
  const discarded = await discardDraft(owner, plan.id, await confirmation(plan.id), randomUUID());
  expect(discarded.draft).toBeNull();
  expect(discarded.locked).toEqual(locked.locked);
  const secondDraft = await unlockPlan(owner, plan.id, discarded.stateVersion);
  await editDraft(owner, plan.id, {
    expectedDraftId: secondDraft.draft!.id,
    expectedEditNumber: secondDraft.draft!.editNumber,
    description: 'Version two',
    startDate: '2026-05-11',
    endDate: '2026-10-04',
  });
  const second = await lockPlan(owner, plan.id, await confirmation(plan.id), randomUUID());
  expect(second.locked?.versionNumber).toBe(2);
  expect(second.locked?.supersedesVersionId).toBe(locked.locked?.id);
  const original = await getDatabase()
    .selectFrom('plan_versions')
    .select('description')
    .where('id', '=', locked.locked!.id)
    .executeTakeFirstOrThrow();
  expect(original.description).toBe('Test plan');
});

it('clones the complete fixture with new physical IDs, retained lineage and identical semantics', async () => {
  const plan = await prepared();
  const db = getDatabase();
  await db
    .transaction()
    .execute((tx) => cloneContent(tx, '00000000-0000-0000-0000-000000000050', plan.draft!.id));
  const locked = await lockPlan(owner, plan.id, await confirmation(plan.id), randomUUID());
  const before = await readAggregate(db, locked.locked!.id);
  const unlocked = await unlockPlan(owner, plan.id, locked.stateVersion);
  const after = await readAggregate(db, unlocked.draft!.id);
  expect(contentHash(after.semantic)).toBe(contentHash(before.semantic));
  const oldRows = await db
    .selectFrom('workouts')
    .select(['id', 'lineage_id'])
    .where('plan_version_id', '=', locked.locked!.id)
    .execute();
  const newRows = await db
    .selectFrom('workouts')
    .select(['id', 'lineage_id'])
    .where('plan_version_id', '=', unlocked.draft!.id)
    .execute();
  expect(newRows).toHaveLength(10);
  expect(newRows.map((r) => r.lineage_id).sort()).toEqual(oldRows.map((r) => r.lineage_id).sort());
  expect(newRows.some((r) => oldRows.some((old) => old.id === r.id))).toBe(false);
  expect((await previewLock(owner, plan.id)).hasChanges).toBe(false);
});
