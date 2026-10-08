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
import {
  BLUEPRINT_REVISIONS,
  EXAMPLE_KINDS,
  buildExample,
  exampleAnchor,
  type ExampleKind,
} from './blueprint.js';
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
      const existing = EXAMPLE_KINDS.map((kind) =>
        editions.find(
          (e) =>
            e.blueprint_revision === BLUEPRINT_REVISIONS[kind] && String(e.anchor_date) === anchor,
        ),
      );
      const results: {
        kind: ExampleKind;
        status: 'created' | 'unchanged' | 'preserved';
        planId: string;
      }[] = [];
      if (existing.every(Boolean)) {
        for (const [index, edition] of existing.entries()) {
          const current = await detail(db, owner, edition!.plan_id);
          results.push({
            kind: EXAMPLE_KINDS[index]!,
            status:
              current.stateVersion === edition!.published_state_version ? 'unchanged' : 'preserved',
            planId: edition!.plan_id,
          });
        }
        return {
          status: results.some((r) => r.status === 'preserved')
            ? ('preserved' as const)
            : ('unchanged' as const),
          plans: results,
          planId: results[0]!.planId,
          anchor,
          addedCalibrations: [] as string[],
        };
      }
      // Only new blueprints need fitness. A gym-only update must not depend on
      // a deliberately withdrawn endurance calibration used by an existing plan.
      const neededSystems = new Set(
        EXAMPLE_KINDS.flatMap((kind, index) =>
          existing[index]
            ? []
            : kind === 'triathlon'
              ? ['run_pace', 'cycle_power', 'swim_pace']
              : kind === 'cycling'
                ? ['cycle_power']
                : [],
        ),
      );
      const neededEstimates = estimates.filter((estimate) => neededSystems.has(estimate.system));
      const entries = await readEntries(db, owner);
      // A withdrawal is deliberate. Do not resurrect withdrawn example fitness.
      const withdrawn = neededEstimates.filter(
        (estimate) =>
          entries.some((e) => e.system === estimate.system) &&
          !entries.some((e) => e.system === estimate.system && !e.retractedAt),
      );
      if (withdrawn.length)
        return {
          status: 'calibration-required' as const,
          planId: null,
          plans: results,
          anchor,
          addedCalibrations: [] as string[],
        };
      const addedCalibrations: string[] = [];
      for (const estimate of neededEstimates) {
        if (entries.some((e) => e.system === estimate.system && !e.retractedAt)) continue;
        await recordCalibrationRows(
          db,
          owner,
          {
            ...estimate,
            provenance: 'user_estimate',
            estimateBasis:
              'Synthetic training example estimate, not a measured result. Added only because this sport had no calibration history; replace it with your own fitness input.',
          },
          { now },
        );
        addedCalibrations.push(estimate.system);
      }
      for (const [index, kind] of EXAMPLE_KINDS.entries()) {
        const edition = existing[index];
        if (edition) {
          const current = await detail(db, owner, edition.plan_id);
          results.push({
            kind,
            status:
              current.stateVersion === edition.published_state_version ? 'unchanged' : 'preserved',
            planId: edition.plan_id,
          });
          continue;
        }
        const blueprint = buildExample(kind, anchor);
        const { planId, draftId } = await createPlanRows(db, owner, blueprint.name, {
          startDate: anchor,
          endDate: blueprint.endDate,
        });
        await db
          .updateTable('plan_versions')
          .set({ description: blueprint.description })
          .where('id', '=', draftId)
          .execute();
        await saveBriefRows(db, await readBrief(db, draftId), blueprint.brief);
        await writeExample(db, draftId, blueprint);
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
        // Retain real history and restore examples for each plan.
        plan = await unlockPlanRows(db, owner, planId, plan.stateVersion);
        const second = plan.draft!.id;
        const workout = await db
          .selectFrom('workouts')
          .select(['id', 'purpose'])
          .where('plan_version_id', '=', second)
          .where('primary_discipline', '=', 'strength')
          .orderBy('scheduled_date')
          .executeTakeFirstOrThrow();
        await db
          .updateTable('workouts')
          .set({ purpose: `${workout.purpose} Review technique before increasing load.` })
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
            blueprint_revision: BLUEPRINT_REVISIONS[kind],
            anchor_date: anchor,
            plan_id: planId,
            published_state_version: plan.stateVersion,
            published_content_hash: version.content_hash!,
          })
          .execute();
        results.push({ kind, status: 'created', planId });
      }
      for (const edition of editions) {
        if (results.some((r) => r.planId === edition.plan_id)) continue;
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
      return {
        status: 'created' as const,
        plans: results,
        planId: results[0]!.planId,
        anchor,
        addedCalibrations,
      };
    });
}
