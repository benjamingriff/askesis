import { randomUUID } from 'node:crypto';
import type { ClerkClient } from '@clerk/backend';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { ensureAthlete } from '../../src/auth/athlete-provisioning.js';
import { closeDatabase, getDatabase } from '../../src/database/client.js';

const database = getDatabase();
import {
  getWorkoutDetail,
  listBlocks,
  listWorkouts,
} from '../../src/modules/workouts/workout.repository.js';

const fixtureOwnerId = '00000000-0000-0000-0000-000000000001';
const fixturePlanId = '00000000-0000-0000-0000-000000000010';
const fixtureVersionId = '00000000-0000-0000-0000-000000000050';
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
    const workouts = await listWorkouts(fixtureOwnerId, fixtureVersionId);

    expect(workouts).toHaveLength(10);
    expect(workouts[0]?.planId).toBe(fixturePlanId);
  });

  it('lists blocks and their weeks for the plan owner, leaving older blocks unclassified', async () => {
    await expect(listBlocks(fixtureOwnerId, fixtureVersionId)).resolves.toEqual([
      {
        id: '00000000-0000-0000-0000-000000000020',
        position: 1,
        title: 'Foundation',
        description: 'Establish the weekly routine, build the aerobic base, and introduce hills.',
        phase: null,
        startDate: '2026-05-11',
        endDate: '2026-06-07',
        weeks: [
          { weekNumber: 1, startDate: '2026-05-11', endDate: '2026-05-17', cutback: false },
          { weekNumber: 2, startDate: '2026-05-18', endDate: '2026-05-24', cutback: false },
        ],
      },
    ]);
  });

  it('hides workouts from an unrelated athlete', async () => {
    await expect(listWorkouts(randomUUID(), fixtureVersionId)).resolves.toEqual([]);
    await expect(listBlocks(randomUUID(), fixtureVersionId)).resolves.toEqual([]);
    await expect(getWorkoutDetail(randomUUID(), hillWorkoutId)).resolves.toBeNull();
  });

  it('does not grant another account access', async () => {
    const athleteId = randomUUID();
    await database
      .insertInto('athletes')
      .values({ id: athleteId, display_name: 'Member' })
      .execute();
    await expect(listWorkouts(athleteId, fixtureVersionId)).resolves.toEqual([]);
    await expect(listBlocks(athleteId, fixtureVersionId)).resolves.toEqual([]);
    await expect(getWorkoutDetail(athleteId, hillWorkoutId)).resolves.toBeNull();
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
