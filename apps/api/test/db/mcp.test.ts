import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import { requestAccountDeletion } from '../../src/modules/account/account.service.js';
import { emptyBrief } from '../../src/modules/plans/brief.schemas.js';
import { getBrief } from '../../src/modules/plans/brief.service.js';
import { getPlan, lockPlan, previewLock } from '../../src/modules/plans/plan.service.js';
import { callMcpTool } from '../../src/modules/mcp/mcp.service.js';
import type { McpToolName } from '../../src/modules/mcp/mcp.tools.js';

const owner = '00000000-0000-0000-0000-000000000001';
const db = getDatabase();
afterAll(closeDatabase);
const call = async (name: McpToolName, input: unknown) =>
  JSON.parse(await callMcpTool(owner, name, input)) as Record<string, unknown> & {
    editNumber: number;
  };

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
function week(n: number, start: string, end: string, date: string) {
  return {
    blocks: [],
    weeks: [
      {
        key: `week${n}`,
        blockKey: 'foundation',
        weekNumber: n,
        position: n,
        cutback: false,
        title: `Week ${n}`,
        description: null,
        startDate: start,
        endDate: end,
      },
    ],
    workouts: [
      {
        key: `easy${n}`,
        weekKey: `week${n}`,
        date,
        position: 1,
        discipline: 'run',
        title: 'Easy run',
        description: null,
        purpose: 'Build consistency',
        priority: 'medium',
        racePriority: null,
        estimatedDurationSeconds: 1800,
        estimatedDistanceMetres: null,
        tags: ['easy'],
        steps: [
          {
            parentIndex: null,
            kind: 'effort',
            repeatCount: null,
            role: 'main',
            label: 'Easy run',
            instructions: 'Comfortable effort',
            completion: { type: 'duration', value: 1800, unit: 'seconds' },
            targets: [{ type: 'zone', key: 'easy' }],
          },
        ],
      },
    ],
    deleteWorkoutIds: [],
    deleteWeekIds: [],
    deleteBlockIds: [],
    coverage: { startDate: start, endDate: end },
  };
}
const foundation = {
  key: 'foundation',
  title: 'Foundation',
  phase: 'base',
  description: null,
  startDate: '2027-01-04',
  endDate: '2027-01-31',
  position: 1,
};

it('builds a plan over several batches for the athlete and enforces draft edits and locking', async () => {
  const created = await call('create_plan_draft', {
    displayName: `MCP plan ${randomUUID()}`,
    startDate: null,
    endDate: null,
  });
  const planId = (created.plan as { id: string }).id;
  const expectedDraftId = created.draftId as string;
  expect(created.editNumber).toBe(1);
  const listed = await call('list_plans', {});
  expect(listed.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((listed.plans as { id: string }[]).map((p) => p.id)).toContain(planId);

  let { editNumber } = await call('update_plan_brief', {
    planId,
    expectedDraftId,
    expectedEditNumber: 1,
    brief,
    startDate: '2027-01-04',
    endDate: '2027-01-31',
    description: 'First month then reassess',
  });
  expect(editNumber).toBeGreaterThan(1);
  await call('record_performance', {
    system: 'run_pace',
    input: { method: 'threshold_pace', secondsPerKilometre: 330 },
    provenance: 'agent_estimate',
    estimateBasis: 'Estimated from reported easy running.',
    observedOn: null,
  });

  ({ editNumber } = await call('apply_schedule_changes', {
    ...week(1, '2027-01-04', '2027-01-10', '2027-01-05'),
    blocks: [foundation],
    planId,
    expectedDraftId,
    expectedEditNumber: editNumber,
  }));
  await expect(
    callMcpTool(owner, 'apply_schedule_changes', {
      ...week(2, '2027-01-11', '2027-01-17', '2027-01-12'),
      planId,
      expectedDraftId,
      expectedEditNumber: editNumber - 1,
    }),
  ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  // Edit numbers restart in a replacement draft, so a matching number from another draft is stale.
  await expect(
    callMcpTool(owner, 'apply_schedule_changes', {
      ...week(2, '2027-01-11', '2027-01-17', '2027-01-12'),
      planId,
      expectedDraftId: randomUUID(),
      expectedEditNumber: editNumber,
    }),
  ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  const block = (
    (await call('read_schedule', { planId, startDate: null, endDate: null })).training_blocks as {
      id: string;
    }[]
  )[0]!;
  const second = week(2, '2027-01-11', '2027-01-17', '2027-01-12');
  ({ editNumber } = await call('apply_schedule_changes', {
    ...second,
    weeks: [{ ...second.weeks[0]!, blockKey: block.id }],
    planId,
    expectedDraftId,
    expectedEditNumber: editNumber,
  }));

  // Without a run's generation horizon, a later batch keeps the coverage earlier batches saved.
  const plan = await getPlan(owner, planId);
  const coverage = await db
    .selectFrom('plan_schedule_coverage')
    .select(['start_date', 'end_date'])
    .where('plan_version_id', '=', plan.draft!.id)
    .orderBy('start_date')
    .execute();
  expect(coverage.map((c) => [String(c.start_date), String(c.end_date)])).toEqual([
    ['2027-01-04', '2027-01-10'],
    ['2027-01-11', '2027-01-17'],
  ]);
  const schedule = await call('read_schedule', {
    planId,
    startDate: '2027-01-11',
    endDate: null,
  });
  expect((schedule.workouts as unknown[]).length).toBe(1);
  const validated = await call('validate_plan', { planId });
  expect(validated).toMatchObject({ draftId: expectedDraftId, editNumber });
  expect(validated).toHaveProperty('findings');

  const state = await getBrief(owner, planId);
  const review = await previewLock(owner, planId);
  await lockPlan(
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
  await expect(
    callMcpTool(owner, 'update_plan_brief', {
      planId,
      expectedDraftId,
      expectedEditNumber: editNumber,
      brief,
      startDate: '2027-01-04',
      endDate: '2027-01-31',
      description: null,
    }),
  ).rejects.toMatchObject({ code: 'DRAFT_REQUIRED' });
  expect((await call('read_plan_context', { planId })).editNumber).toBeNull();
});
it('keeps other athletes’ plans out of reach', async () => {
  await expect(
    callMcpTool(owner, 'read_plan_context', { planId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
});
it('refuses every tool while the account is scheduled for deletion', async () => {
  const pending = randomUUID();
  await db
    .insertInto('athletes')
    .values({ id: pending, display_name: 'MCP deletion', timezone: 'UTC' })
    .execute();
  await requestAccountDeletion(pending);
  await expect(callMcpTool(pending, 'list_plans', {})).rejects.toMatchObject({
    code: 'ACCOUNT_DELETION_PENDING',
  });
});
