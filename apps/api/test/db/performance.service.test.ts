import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, expect, it } from 'vitest';
import { closeDatabase, getDatabase } from '../../src/database/client.js';
import { syncAthleteTimezone } from '../../src/auth/athlete-provisioning.js';
import { cloneContent } from '../../src/modules/plans/plan.aggregate.js';
import { createPlan, previewLock } from '../../src/modules/plans/plan.service.js';
import { getWorkoutDetail, listWorkouts } from '../../src/modules/workouts/workout.repository.js';
import type { WorkoutStep } from '../../src/modules/workouts/workout.schemas.js';
import {
  getPerformance,
  previewCalibrationFor,
  recordCalibration,
  retractCalibration,
} from '../../src/modules/performance/performance.service.js';

const db = getDatabase();
const fixtureVersion = '00000000-0000-0000-0000-000000000050';
afterAll(closeDatabase);

async function athlete(timezone = 'Europe/London') {
  const row = await db
    .insertInto('athletes')
    .values({ display_name: 'Performance test', timezone })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
const threshold = (secondsPerKilometre: number) => ({
  system: 'run_pace' as const,
  input: { method: 'threshold_pace' as const, secondsPerKilometre },
});
const at = (instant: string) => new Date(instant);
/** A plan whose draft holds the fixture's dated workouts with easy-zone targets. */
async function fixturePlan(owner: string) {
  const plan = await createPlan(owner, 'Zones', randomUUID(), {
    startDate: '2026-05-11',
    endDate: '2026-10-04',
  });
  await db.transaction().execute((tx) => cloneContent(tx, fixtureVersion, plan.draft!.id));
  return plan;
}
function easyTargets(step: WorkoutStep): number[] {
  return [
    ...step.targets
      .filter((target) => target.zoneKey === 'easy')
      .map((target) => target.resolvedZone?.targetValue ?? NaN),
    ...step.steps.flatMap(easyTargets),
  ];
}
async function easyPaceOn(owner: string, versionId: string, date: string) {
  const workout = (await listWorkouts(owner, versionId)).find((w) => w.scheduledDate === date)!;
  return easyTargets((await getWorkoutDetail(owner, workout.id))!.prescription)[0];
}

it('keeps an append-only timeline that applies from today in the athlete timezone', async () => {
  const owner = await athlete();
  let state = await recordCalibration(owner, threshold(300), at('2026-05-02T12:00:00Z'));
  const first = state.current[0]!;
  expect(first).toMatchObject({ effectiveFrom: '2026-05-02', recordedBy: 'athlete' });
  expect(first.zones.map((zone) => zone.key)).toEqual([
    'easy',
    'marathon',
    'threshold',
    'interval',
    'repetition',
  ]);
  // Repeating today's entry never stacks a duplicate.
  expect(await recordCalibration(owner, threshold(300), at('2026-05-02T18:00:00Z'))).toEqual(state);
  // 23:30 UTC is already the next day in London.
  state = await recordCalibration(owner, threshold(290), at('2026-06-01T23:30:00Z'));
  expect(state.today).toBe('2026-06-02');
  expect(state.current[0]).toMatchObject({ effectiveFrom: '2026-06-02' });
  expect(state.entries.map((entry) => entry.effectiveFrom)).toEqual(['2026-06-02', '2026-05-02']);
  // A later same-day entry supersedes; retracting it restores the previous one.
  state = await recordCalibration(owner, threshold(285), at('2026-06-02T12:00:00Z'));
  const mistaken = state.current[0]!;
  expect(mistaken.input).toEqual({ method: 'threshold_pace', secondsPerKilometre: 285 });
  state = await retractCalibration(owner, mistaken.id, undefined, at('2026-06-02T13:00:00Z'));
  expect(state.current[0]!.input).toEqual({ method: 'threshold_pace', secondsPerKilometre: 290 });
  expect(state.entries.find((entry) => entry.id === mistaken.id)!.retractedAt).not.toBeNull();
  expect(
    await retractCalibration(owner, mistaken.id, undefined, at('2026-06-02T13:00:00Z')),
  ).toEqual(state);
  await expect(retractCalibration(owner, randomUUID())).rejects.toMatchObject({
    code: 'CALIBRATION_NOT_FOUND',
  });
  await expect(retractCalibration(await athlete(), mistaken.id)).rejects.toMatchObject({
    code: 'CALIBRATION_NOT_FOUND',
  });
});

it('validates evidence, previews without saving and replays idempotent requests', async () => {
  const owner = await athlete();
  const now = at('2026-09-10T12:00:00Z');
  const race = {
    system: 'run_pace' as const,
    input: { method: 'race_result' as const, distanceMetres: 21097.5, durationSeconds: 5880 },
  };
  const preview = await previewCalibrationFor(owner, race, now);
  expect(preview).toMatchObject({ system: 'run_pace', method: 'race_result', current: null });
  expect((await getPerformance(owner, now)).entries).toEqual([]);
  await expect(
    recordCalibration(owner, { ...race, observedOn: '2026-09-11' }, now),
  ).rejects.toMatchObject({ code: 'OBSERVED_IN_FUTURE' });
  await expect(
    recordCalibration(
      owner,
      { system: 'run_pace', input: { method: 'threshold_pace', secondsPerKilometre: 1 } },
      now,
    ),
  ).rejects.toMatchObject({ code: 'CALIBRATION_INVALID' });
  const request = { ...race, observedOn: '2026-09-06', idempotencyKey: randomUUID() };
  const recorded = await recordCalibration(owner, request, now);
  expect(recorded.current[0]).toMatchObject({
    observedOn: '2026-09-06',
    effectiveFrom: '2026-09-10',
    provenance: 'user_supplied',
    zones: preview.zones,
  });
  expect(await recordCalibration(owner, request, now)).toEqual(recorded);
  await expect(
    recordCalibration(owner, { ...request, observedOn: '2026-09-07' }, now),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect((await getPerformance(owner, now)).entries).toHaveLength(1);
});

it('applies one timeline to every plan by workout date without editing plan content', async () => {
  const owner = await athlete();
  const [a, b] = [await fixturePlan(owner), await fixturePlan(owner)];
  // Without fitness, zones cannot resolve and the plan cannot lock.
  const blocked = (await previewLock(owner, a.id)).findings.map((f) => f.code);
  expect(blocked).toContain('performance.run_pace_required');
  expect(blocked).toContain('ZONE_UNRESOLVED');
  expect(await easyPaceOn(owner, a.draft!.id, '2026-05-12')).toBeNaN();

  // The first entry also covers dates before it, so a plan already under way resolves.
  const first = await recordCalibration(owner, threshold(300), at('2026-05-15T12:00:00Z'));
  const firstEasy = first.current[0]!.zones[0]!.target;
  const beforeUpdate = await previewLock(owner, a.id);
  expect(beforeUpdate.findings.map((f) => f.code)).not.toContain('ZONE_UNRESOLVED');
  expect(beforeUpdate.findings.map((f) => f.code)).not.toContain('performance.run_pace_required');
  for (const plan of [a, b])
    expect(await easyPaceOn(owner, plan.draft!.id, '2026-05-12')).toBe(firstEasy);

  // A faster result applies from its day in every plan; earlier workouts keep their paces.
  const second = await recordCalibration(owner, threshold(280), at('2026-05-19T12:00:00Z'));
  const secondEasy = second.current[0]!.zones[0]!.target;
  expect(secondEasy).toBeLessThan(firstEasy);
  for (const plan of [a, b]) {
    expect(await easyPaceOn(owner, plan.draft!.id, '2026-05-18')).toBe(firstEasy);
    expect(await easyPaceOn(owner, plan.draft!.id, '2026-05-19')).toBe(secondEasy);
  }
  const afterUpdate = await previewLock(owner, a.id);
  expect(afterUpdate.contentHash).toBe(beforeUpdate.contentHash);
  expect(afterUpdate.editNumber).toBe(beforeUpdate.editNumber);
  // Another athlete's fitness never resolves this athlete's workouts.
  await recordCalibration(await athlete(), threshold(200), at('2026-05-19T12:00:00Z'));
  expect(await easyPaceOn(owner, a.draft!.id, '2026-05-19')).toBe(secondEasy);
});

it('follows a valid device timezone and protects calibration history in the database', async () => {
  const owner = await athlete('UTC');
  const identity = { id: owner, displayName: 'Device', clerkUserId: 'user', timezone: 'UTC' };
  expect(await syncAthleteTimezone(identity, 'not a timezone')).toEqual(identity);
  expect(await syncAthleteTimezone(identity, 'Pacific/Auckland')).toMatchObject({
    timezone: 'Pacific/Auckland',
  });
  const state = await recordCalibration(owner, threshold(300), at('2026-03-01T12:00:00Z'));
  expect(state).toMatchObject({ timezone: 'Pacific/Auckland', today: '2026-03-02' });
  const id = state.current[0]!.id;
  for (const statement of [
    sql`UPDATE athlete_calibrations SET effective_from = '2026-01-01' WHERE id = ${id}::uuid`,
    sql`DELETE FROM athlete_calibrations WHERE id = ${id}::uuid`,
    sql`UPDATE athlete_calibration_zones SET target_value = 1 WHERE calibration_id = ${id}::uuid`,
  ])
    await expect(statement.execute(db)).rejects.toMatchObject({ code: '23514' });
  const events = await db
    .selectFrom('live_events')
    .select(['type', 'metadata'])
    .where('owner_id', '=', owner)
    .execute();
  expect(events).toEqual([{ type: 'performance.changed', metadata: { system: 'run_pace' } }]);
});
