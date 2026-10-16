import { getDatabase } from '../../database/client.js';
import { PlanError } from '../plans/plan.common.js';
import { ActivityLinksSchema } from './activity.schemas.js';
import { verifyStravaActivity } from './integration.service.js';
import { stravaActivityUrl } from './strava.mapping.js';

async function ownedPlan(owner: string, planId: string) {
  const plan = await getDatabase()
    .selectFrom('plans')
    .select(['id', 'archived_at'])
    .where('id', '=', planId)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!plan) throw new PlanError('PLAN_NOT_FOUND', 'Plan not found.', 404);
  return plan;
}

/** The athlete's links for one plan. Activity details are fetched separately, when shown. */
export async function readActivityLinks(owner: string, planId: string) {
  await ownedPlan(owner, planId);
  const rows = await getDatabase()
    .selectFrom('workout_activity_links')
    .select(['workout_lineage_id', 'provider_activity_id', 'linked_at'])
    .where('athlete_id', '=', owner)
    .where('plan_id', '=', planId)
    .orderBy('linked_at')
    .execute();
  return ActivityLinksSchema.parse({
    links: rows.map((row) => ({
      lineageId: row.workout_lineage_id,
      provider: 'strava',
      activityId: row.provider_activity_id,
      url: stravaActivityUrl(row.provider_activity_id),
      linkedAt: new Date(row.linked_at).toISOString(),
    })),
  });
}

/**
 * Link an activity to a workout, replacing the workout's previous link. An activity belongs to
 * one workout per plan, so linking it elsewhere moves it. Strava confirms the activity is on the
 * athlete's account first; nothing it returns is kept.
 */
export async function linkActivity(
  owner: string,
  planId: string,
  lineageId: string,
  activityId: string,
  now = new Date(),
) {
  const plan = await ownedPlan(owner, planId);
  if (plan.archived_at)
    throw new PlanError('PLAN_ARCHIVED', 'Unarchive the plan before linking activities.');
  const workout = await getDatabase()
    .selectFrom('workouts')
    .innerJoin('plan_versions', 'plan_versions.id', 'workouts.plan_version_id')
    .select('workouts.id')
    .where('plan_versions.plan_id', '=', planId)
    .where('workouts.lineage_id', '=', lineageId)
    .executeTakeFirst();
  if (!workout) throw new PlanError('WORKOUT_NOT_FOUND', 'Workout not found in this plan.', 404);
  const connection = await verifyStravaActivity(owner, activityId, now);
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      await db
        .deleteFrom('workout_activity_links')
        .where('plan_id', '=', planId)
        .where((eb) =>
          eb.or([
            eb('workout_lineage_id', '=', lineageId),
            eb.and([
              eb('connection_id', '=', connection.id),
              eb('provider_activity_id', '=', activityId),
            ]),
          ]),
        )
        .execute();
      await db
        .insertInto('workout_activity_links')
        .values({
          athlete_id: owner,
          plan_id: planId,
          workout_lineage_id: lineageId,
          connection_id: connection.id,
          provider_activity_id: activityId,
          linked_at: now,
        })
        .execute();
    });
  return readActivityLinks(owner, planId);
}

export async function unlinkActivity(owner: string, planId: string, lineageId: string) {
  const plan = await ownedPlan(owner, planId);
  if (plan.archived_at)
    throw new PlanError('PLAN_ARCHIVED', 'Unarchive the plan before changing its links.');
  await getDatabase()
    .deleteFrom('workout_activity_links')
    .where('athlete_id', '=', owner)
    .where('plan_id', '=', planId)
    .where('workout_lineage_id', '=', lineageId)
    .execute();
  return readActivityLinks(owner, planId);
}
