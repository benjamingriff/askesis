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
import { BriefSchema, emptyBrief, type BriefState } from '../../src/modules/plans/brief.schemas.js';
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
      sports: [
        {
          sport: 'run',
          currentSessions: { status: 'known', value: 5 },
          desiredSessions: 6,
          weeklyDistance: { status: 'unknown', value: null },
          longestDistance: { status: 'unknown', value: null },
        },
      ],
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
  s = await saveBrief(owner, plan.id, {
    ...cmd(s),
    brief: { ...s.brief, sports: [{ ...s.brief.sports[0]!, desiredSessions: 7 }] },
  });
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
it('holds one baseline per sport, validates each and keeps lineage across saves and versions', async () => {
  const { plan, state } = await prepared();
  const triathlon = {
    ...state.brief,
    goal: 'Finish an Olympic triathlon',
    weekdays: [
      'available',
      'available',
      'available',
      'available',
      'available',
      'preferred',
      'preferred',
    ] as BriefState['brief']['weekdays'],
    sports: [
      {
        sport: 'strength' as const,
        currentSessions: { status: 'known' as const, value: 0 },
        desiredSessions: 1,
      },
      {
        sport: 'swim' as const,
        currentSessions: { status: 'known' as const, value: 1 },
        desiredSessions: 2,
        weeklyDistance: { status: 'known' as const, value: 2000 },
        longestDistance: { status: 'known' as const, value: 2500 },
      },
      {
        sport: 'cycle' as const,
        currentSessions: { status: 'unanswered' as const, value: null },
        desiredSessions: 3,
        weeklyDuration: { status: 'known' as const, value: 10800 },
        longestDuration: { status: 'known' as const, value: 5400 },
      },
      state.brief.sports[0]!,
    ],
  };
  let s = await saveBrief(owner, plan.id, { ...cmd(state), brief: triathlon });
  // Stored and returned in run, cycle, swim, strength order.
  expect(s.brief.sports.map((sport) => sport.sport)).toEqual(['run', 'cycle', 'swim', 'strength']);
  const codes = s.findings.map((f) => f.code);
  expect(codes).toContain('brief.cycle.current_sessions_unanswered');
  expect(codes).toContain('brief.swim.longest_exceeds_weekly');
  expect(codes).not.toContain('brief.strength.weekly_volume_unanswered');
  // 6 + 3 + 2 + 1 desired sessions fit two per day across seven days.
  expect(codes).not.toContain('brief.desired_frequency_exceeds_capacity');
  const lineage = async () =>
    (
      await sql<{
        sport: string;
        lineage_id: string;
      }>`SELECT sport, lineage_id FROM plan_brief_sports
        WHERE plan_version_id = ${s.versionId}::uuid ORDER BY sport`.execute(getDatabase())
    ).rows;
  const before = await lineage();
  s = await saveBrief(owner, plan.id, {
    ...cmd(s),
    brief: {
      ...s.brief,
      sports: s.brief.sports
        .filter((sport) => sport.sport !== 'strength')
        .map((sport) =>
          sport.sport === 'cycle'
            ? { ...sport, currentSessions: { status: 'known' as const, value: 2 } }
            : sport,
        ),
    },
  });
  expect(s.brief.sports.map((sport) => sport.sport)).toEqual(['run', 'cycle', 'swim']);
  const after = await lineage();
  expect(after).toEqual(before.filter((row) => row.sport !== 'strength'));
  const empty = await saveBrief(owner, plan.id, { ...cmd(s), brief: { ...s.brief, sports: [] } });
  expect(empty.findings.map((f) => f.code)).toContain('brief.sport_required');
  expect(
    BriefSchema.safeParse({ ...empty.brief, sports: [s.brief.sports[0], s.brief.sports[0]] })
      .success,
  ).toBe(false);
});
