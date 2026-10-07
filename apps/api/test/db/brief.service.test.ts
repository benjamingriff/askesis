import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { sql } from 'kysely';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import {
  createPlan,
  previewLock,
  lockPlan,
  unlockPlan,
} from '../../src/modules/plans/plan.service.js';
import { saveBrief, getBrief, confirmBrief } from '../../src/modules/plans/brief.service.js';
import { emptyBrief, type BriefState } from '../../src/modules/plans/brief.schemas.js';
const owner = '00000000-0000-0000-0000-000000000001';
const cmd = (s: BriefState) => ({ expectedDraftId: s.versionId, expectedEditNumber: s.editNumber });
async function prepared(startDate = '2026-05-01') {
  const plan = await createPlan(owner, 'Phase 3 test', randomUUID(), {
    startDate,
    endDate: '2026-12-31',
  });
  const empty = await getBrief(owner, plan.id);
  const state = await saveBrief(owner, plan.id, {
    ...cmd(empty),
    brief: {
      ...emptyBrief(),
      goal: 'Run consistently',
      desiredRuns: 6,
      weeklyDistance: { status: 'unknown', value: null },
      currentRuns: { status: 'known', value: 5 },
      longestRun: { status: 'unknown', value: null },
      weekdays: [
        'preferred',
        'available',
        'available',
        'unavailable',
        'unavailable',
        'unavailable',
        'unavailable',
      ],
    },
  });
  return { plan, state };
}
afterAll(closeDatabase);
it('requires human confirmation, preserves it across unit conversion, and clears it for changed facts', async () => {
  const { plan, state } = await prepared();
  expect(state.scheduleReviewRequired).toBe(false);
  // Calibration belongs to the athlete, so it is not a brief fact or confirmation input.
  expect(state.findings.map((f) => f.code)).not.toContain('brief.calibration_required');
  expect((await previewLock(owner, plan.id)).findings.map((f) => f.code)).toContain(
    'brief.confirmation_required',
  );
  let s = await confirmBrief(owner, plan.id, {
    ...cmd(state),
    expectedHash: state.hash,
    acknowledgedWarningCodes: [],
  });
  expect(s.confirmed).toBe(true);
  expect(s.editNumber).toBe(state.editNumber);
  expect(await saveBrief(owner, plan.id, { ...cmd(s), brief: s.brief })).toEqual(s);
  const hash = s.hash;
  const editNumber = s.editNumber;
  s = await saveBrief(owner, plan.id, { ...cmd(s), brief: { ...s.brief, unit: 'miles' } });
  expect(s.confirmed).toBe(true);
  expect(s.hash).toBe(hash);
  expect(s.editNumber).toBe(editNumber + 1);
  s = await saveBrief(owner, plan.id, { ...cmd(s), brief: { ...s.brief, desiredRuns: 7 } });
  expect(s.confirmed).toBe(false);
  expect(s.editNumber).toBe(editNumber + 2);
  expect(s.scheduleReviewRequired).toBe(false);
  expect(s.findings.map((f) => f.code)).toContain('brief.desired_frequency_exceeds_capacity');
});
it('clones confirmed briefs while locked rows reject edits', async () => {
  const { plan, state } = await prepared();
  const s = await confirmBrief(owner, plan.id, {
    ...cmd(state),
    expectedHash: state.hash,
    acknowledgedWarningCodes: [],
  });
  const preview = await previewLock(owner, plan.id);
  const locked = await lockPlan(
    owner,
    plan.id,
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
  await expect(
    sql`UPDATE plan_briefs SET goal_text = 'forbidden' WHERE plan_version_id = ${s.versionId}::uuid`.execute(
      getDatabase(),
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await unlockPlan(owner, plan.id, locked.stateVersion);
  const clone = await getBrief(owner, plan.id);
  expect(clone.confirmed).toBe(true);
  expect(clone.hash).toBe(s.hash);
  await expect(getBrief(randomUUID(), plan.id)).rejects.toMatchObject({ status: 404 });
  await expect(
    saveBrief(owner, plan.id, { ...cmd(state), brief: state.brief }),
  ).rejects.toMatchObject({ code: 'STALE_DRAFT' });
});
