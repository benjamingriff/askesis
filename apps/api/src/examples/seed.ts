import { sql, type Transaction } from 'kysely';
import { getDatabase } from '../database/client.js';
import type { DB } from '../database/generated.js';
import { assertPlanIdle, ChatError } from '../modules/chat/chat.core.js';
import { recordCalibrationRows, readEntries } from '../modules/performance/performance.service.js';
import type { CalibrationInput } from '../modules/performance/performance.schemas.js';
import {
  readBrief,
  saveBriefRows,
  confirmBriefRows,
  recordDraftChange,
} from '../modules/plans/brief.service.js';
import {
  createPlanRows,
  detail,
  preview,
  lockPlanRows,
  unlockPlanRows,
  organizePlanRows,
} from '../modules/plans/plan.service.js';
import { BLUEPRINT_REVISION, EXAMPLE_NAME, buildExample, exampleAnchor } from './blueprint.js';
import { writeExample } from './writer.js';

const estimates: CalibrationInput[] = [
  { system: 'run_pace', input: { method: 'threshold_pace', secondsPerKilometre: 300 } },
  { system: 'cycle_power', input: { method: 'ftp', watts: 245 } },
  { system: 'swim_pace', input: { method: 'css_pace', secondsPer100Metres: 105 } },
];

async function publish(db: Transaction<DB>, owner: string, planId: string) {
  const plan = await detail(db, owner, planId);
  const brief = await readBrief(db, plan.draft!.id);
  await confirmBriefRows(db, brief, {
    expectedHash: brief.hash,
    acknowledgedWarningCodes: brief.findings
      .filter((f) => f.severity === 'warning')
      .map((f) => f.code),
  });
  const review = await preview(db, plan);
  return lockPlanRows(db, owner, planId, {
    expectedStateVersion: review.stateVersion,
    expectedDraftId: review.draftId,
    expectedEditNumber: review.editNumber,
    expectedContentHash: review.contentHash,
    expectedValidationDigest: review.validationDigest,
    acknowledgedWarningCodes: review.findings
      .filter((f) => f.severity === 'warning')
      .map((f) => f.code),
  });
}

/** One atomic, owner-scoped publication. Failure leaves no partial plan or seed marker. */
export async function ensureExample(owner: string, now = new Date()) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`example-plan:${owner}`}, 0))`.execute(
        db,
      );
      const editions = await db
        .selectFrom('example_plan_editions')
        .selectAll()
        .where('owner_id', '=', owner)
        .execute();
      // Normal coaching locks a plan before its athlete. Keep the same order so a
      // simultaneous fitness edit cannot deadlock replacement of an old example.
      if (editions.length)
        await db
          .selectFrom('plans')
          .select('id')
          .where(
            'id',
            'in',
            editions.map((e) => e.plan_id),
          )
          .where('owner_id', '=', owner)
          .orderBy('id')
          .forUpdate()
          .execute();
      const athlete = await db
        .selectFrom('athletes')
        .select(['timezone'])
        .where('id', '=', owner)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const anchor = exampleAnchor(athlete.timezone, now);
      const existing = editions.find(
        (e) => e.blueprint_revision === BLUEPRINT_REVISION && String(e.anchor_date) === anchor,
      );
      if (existing) {
        const current = await detail(db, owner, existing.plan_id);
        return {
          status:
            current.stateVersion === existing.published_state_version
              ? ('unchanged' as const)
              : ('preserved' as const),
          planId: existing.plan_id,
          anchor,
          addedCalibrations: [] as string[],
        };
      }
      const entries = await readEntries(db, owner);
      // A withdrawal is deliberate. Do not resurrect withdrawn example fitness.
      const withdrawn = estimates.filter(
        (estimate) =>
          entries.some((e) => e.system === estimate.system) &&
          !entries.some((e) => e.system === estimate.system && !e.retractedAt),
      );
      if (withdrawn.length)
        return {
          status: 'calibration-required' as const,
          planId: null,
          anchor,
          addedCalibrations: [] as string[],
        };
      const addedCalibrations: string[] = [];
      for (const estimate of estimates) {
        if (entries.some((e) => e.system === estimate.system && !e.retractedAt)) continue;
        await recordCalibrationRows(
          db,
          owner,
          {
            ...estimate,
            provenance: 'user_estimate',
            estimateBasis:
              'Synthetic multisport example estimate, not a measured result. Added only because this sport had no calibration history; replace it with your own fitness input.',
          },
          { now },
        );
        addedCalibrations.push(estimate.system);
      }
      const blueprint = buildExample(anchor);
      const { planId, draftId } = await createPlanRows(db, owner, EXAMPLE_NAME, {
        startDate: anchor,
        endDate: blueprint.endDate,
      });
      await db
        .updateTable('plan_versions')
        .set({
          description:
            'Complete eight-week multisport software showcase, including storage examples beyond the current coaching writer.',
        })
        .where('id', '=', draftId)
        .execute();
      await saveBriefRows(db, await readBrief(db, draftId), blueprint.brief);
      await writeExample(db, draftId, anchor);
      const brief = await readBrief(db, draftId);
      await db
        .insertInto('plan_schedule_coverage')
        .values({
          plan_version_id: draftId,
          start_date: anchor,
          end_date: blueprint.endDate,
          brief_hash: brief.hash,
        })
        .execute();
      let plan = await publish(db, owner, planId);
      // A real second revision demonstrates history, lineage, changes and restore.
      plan = await unlockPlanRows(db, owner, planId, plan.stateVersion);
      const second = plan.draft!.id;
      const workout = await db
        .selectFrom('workouts')
        .select(['id', 'title'])
        .where('plan_version_id', '=', second)
        .where('primary_discipline', '=', 'strength')
        .orderBy('scheduled_date')
        .executeTakeFirstOrThrow();
      await db
        .updateTable('workouts')
        .set({
          title: `${workout.title} · reviewed`,
          purpose:
            'Reviewed supporting strength: keep two repetitions in reserve and prioritise movement quality.',
        })
        .where('id', '=', workout.id)
        .execute();
      await recordDraftChange(db, second, 'edit-only');
      plan = await publish(db, owner, planId);
      plan = await organizePlanRows(db, owner, planId, 'activate', plan.stateVersion);
      const version = await db
        .selectFrom('plan_versions')
        .select('content_hash')
        .where('id', '=', plan.locked!.id)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('example_plan_editions')
        .values({
          owner_id: owner,
          blueprint_revision: BLUEPRINT_REVISION,
          anchor_date: anchor,
          plan_id: planId,
          published_state_version: plan.stateVersion,
          published_content_hash: version.content_hash!,
        })
        .execute();
      for (const edition of editions) {
        const old = await detail(db, owner, edition.plan_id);
        if (
          old.stateVersion !== edition.published_state_version ||
          old.draft ||
          old.archived ||
          !old.locked
        )
          continue;
        const locked = await db
          .selectFrom('plan_versions')
          .select('content_hash')
          .where('id', '=', old.locked.id)
          .executeTakeFirstOrThrow();
        if (locked.content_hash !== edition.published_content_hash) continue;
        try {
          await assertPlanIdle(db, old.id);
        } catch (error) {
          if (error instanceof ChatError && error.code === 'RUN_ACTIVE') continue;
          throw error;
        }
        await organizePlanRows(db, owner, old.id, 'archive', old.stateVersion);
      }
      return { status: 'created' as const, planId, anchor, addedCalibrations };
    });
}
