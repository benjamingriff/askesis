import { randomUUID } from 'node:crypto';
import type { ClerkClient } from '@clerk/backend';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { ensureAthlete } from '../../src/auth/athlete-provisioning.js';
import { closeDatabase, getDatabase } from '../../src/database/client.js';

const database = getDatabase();
import { getWorkoutDetail, listWorkouts } from '../../src/modules/workouts/workout.repository.js';

const fixtureOwnerId = '00000000-0000-0000-0000-000000000001';
const fixturePlanId = '00000000-0000-0000-0000-000000000010';
const hillWorkoutId = '10000000-0000-0000-0000-000000000103';

afterAll(async () => {
  await closeDatabase();
});

describe('database readiness', () => {
  it('reports ready after all required migrations are applied', async () => {
    const response = await app.request('/api/ready');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ready' });
  });
});

describe('workout repository authorization', () => {
  it('lists workouts for the plan owner', async () => {
    const workouts = await listWorkouts(fixtureOwnerId);

    expect(workouts).toHaveLength(10);
    expect(workouts[0]?.planId).toBe(fixturePlanId);
  });

  it('hides workouts from an unrelated athlete', async () => {
    await expect(listWorkouts(randomUUID())).resolves.toEqual([]);
    await expect(getWorkoutDetail(randomUUID(), hillWorkoutId)).resolves.toBeNull();
  });

  it('grants access through plan membership', async () => {
    const athleteId = randomUUID();
    await database
      .insertInto('athletes')
      .values({ id: athleteId, display_name: 'Member' })
      .execute();
    await database
      .insertInto('plan_memberships')
      .values({ athlete_id: athleteId, plan_id: fixturePlanId, role: 'viewer' })
      .execute();

    await expect(listWorkouts(athleteId)).resolves.toHaveLength(10);
    await expect(getWorkoutDetail(athleteId, hillWorkoutId)).resolves.not.toBeNull();
  });
});

describe('lazy athlete provisioning', () => {
  it('is idempotent when first requests arrive concurrently', async () => {
    const clerkUserId = `user_${randomUUID()}`;
    const clerk = {
      users: {
        getUser: async () => ({
          firstName: 'Test',
          lastName: 'Runner',
          primaryEmailAddressId: null,
          emailAddresses: [],
        }),
      },
    } as unknown as ClerkClient;

    const athletes = await Promise.all([
      ensureAthlete(clerk, clerkUserId),
      ensureAthlete(clerk, clerkUserId),
    ]);

    expect(athletes[0]?.id).toBe(athletes[1]?.id);
    expect(athletes[0]?.displayName).toBe('Test Runner');
    const identities = await database
      .selectFrom('athlete_identities')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('provider_subject', '=', clerkUserId)
      .executeTakeFirstOrThrow();
    expect(Number(identities.count)).toBe(1);
  });
});

describe('workout detail assembly', () => {
  it('assembles repeats and resolves effective-dated zones', async () => {
    const workout = await getWorkoutDetail(fixtureOwnerId, hillWorkoutId);

    expect(workout?.prescription.kind).toBe('sequence');
    const repeat = workout?.prescription.steps.find((step) => step.kind === 'repeat');
    expect(repeat?.repeatCount).toBe(6);
    expect(repeat?.steps.map((step) => step.label)).toEqual(['Run uphill', 'Walk or jog back']);
    const resolvedTargets = workout?.prescription.steps
      .flatMap((step) => [step, ...step.steps])
      .flatMap((step) => step.targets)
      .filter((target) => target.resolvedZone !== null);
    expect(resolvedTargets?.length).toBeGreaterThan(0);
  });
});
