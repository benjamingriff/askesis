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
import {
  saveBrief,
  getBrief,
  addCalibration,
  confirmBrief,
  useCalibration,
} from '../../src/modules/plans/brief.service.js';
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
      timezone: 'Europe/London',
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
  expect(state.findings.map((f) => f.code)).toContain('brief.calibration_required');
  let s = await addCalibration(
    owner,
    plan.id,
    { ...cmd(state), input: { method: 'threshold_pace', secondsPerKilometre: 300 } },
    new Date('2026-05-01T12:00:00Z'),
  );
  expect((await previewLock(owner, plan.id)).findings.map((f) => f.code)).toContain(
    'brief.confirmation_required',
  );
  s = await confirmBrief(owner, plan.id, {
    ...cmd(s),
    expectedHash: s.hash,
    acknowledgedWarningCodes: [],
  });
  expect(s.confirmed).toBe(true);
  expect(
    await addCalibration(owner, plan.id, {
      ...cmd(s),
      input: { method: 'threshold_pace', secondsPerKilometre: 300 },
    }),
  ).toEqual(s);
  const hash = s.hash;
  s = await saveBrief(owner, plan.id, { ...cmd(s), brief: { ...s.brief, unit: 'miles' } });
  expect(s.confirmed).toBe(true);
  expect(s.hash).toBe(hash);
  s = await saveBrief(owner, plan.id, { ...cmd(s), brief: { ...s.brief, desiredRuns: 7 } });
  expect(s.confirmed).toBe(false);
  expect(s.findings.map((f) => f.code)).toContain('brief.desired_frequency_exceeds_capacity');
});
it('preserves past guides, replaces same-day updates, reuses history, and safely retries', async () => {
  const { plan, state } = await prepared();
  let s = await addCalibration(
    owner,
    plan.id,
    { ...cmd(state), input: { method: 'threshold_pace', secondsPerKilometre: 300 } },
    new Date('2026-05-02T12:00:00Z'),
  );
  const first = s.calibrations[0]!;
  expect(first.effectiveFrom).toBe('2026-05-01');
  const request = {
    ...cmd(s),
    idempotencyKey: randomUUID(),
    input: { method: 'threshold_pace' as const, secondsPerKilometre: 290 },
  };
  s = await addCalibration(owner, plan.id, request, new Date('2026-06-01T23:30:00Z'));
  expect(s.calibrations[0]!.effectiveUntil).toBe('2026-06-02');
  expect(s.calibrations[1]!.effectiveFrom).toBe('2026-06-02');
  expect(await addCalibration(owner, plan.id, request)).toEqual(s);
  await expect(
    addCalibration(owner, plan.id, {
      ...request,
      input: { method: 'threshold_pace', secondsPerKilometre: 280 },
    }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  s = await addCalibration(
    owner,
    plan.id,
    { ...cmd(s), input: { method: 'threshold_pace', secondsPerKilometre: 285 } },
    new Date('2026-06-02T12:00:00Z'),
  );
  expect(s.calibrations).toHaveLength(2);
  expect(s.calibrations[0]!.zones).toEqual(first.zones);
  s = await useCalibration(owner, plan.id, cmd(s), first.id, new Date('2026-06-03T12:00:00Z'));
  expect(s.calibrations).toHaveLength(3);
  expect(s.calibrations[2]!.zones).toEqual(first.zones);
  expect(s.calibrations[2]!.id).toBe(first.id);
  await expect(getBrief(randomUUID(), plan.id)).rejects.toMatchObject({ status: 404 });
  await expect(
    saveBrief(owner, plan.id, { ...cmd(state), brief: state.brief }),
  ).rejects.toMatchObject({ code: 'STALE_DRAFT' });
});
it('clones confirmed briefs and stored pace history while locked rows reject edits', async () => {
  const { plan, state } = await prepared();
  let s = await addCalibration(owner, plan.id, {
    ...cmd(state),
    input: { method: 'race_result', distanceMetres: 5000, durationSeconds: 1500 },
  });
  s = await confirmBrief(owner, plan.id, {
    ...cmd(s),
    expectedHash: s.hash,
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
  expect(clone.calibrations[0]!.id).not.toBe(s.calibrations[0]!.id);
  expect(clone.calibrations[0]!.zones).toEqual(s.calibrations[0]!.zones);
});
it('replaces the initial profile before a future plan starts', async () => {
  const { plan, state } = await prepared('2026-10-01');
  let s = await addCalibration(
    owner,
    plan.id,
    { ...cmd(state), input: { method: 'threshold_pace', secondsPerKilometre: 300 } },
    new Date('2026-09-01T12:00:00Z'),
  );
  s = await addCalibration(
    owner,
    plan.id,
    { ...cmd(s), input: { method: 'threshold_pace', secondsPerKilometre: 290 } },
    new Date('2026-09-02T12:00:00Z'),
  );
  expect(s.calibrations).toHaveLength(1);
  expect(s.calibrations[0]!.effectiveFrom).toBe('2026-10-01');
});
