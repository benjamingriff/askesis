import { closeDatabase, getDatabase } from '../database/client.js';
import { getPlan, lockPlan, organizePlan, previewLock } from '../modules/plans/plan.service.js';
import { confirmBrief, getBrief, saveBrief } from '../modules/plans/brief.service.js';
import { emptyBrief } from '../modules/plans/brief.schemas.js';
import { getPerformance, recordCalibration } from '../modules/performance/performance.service.js';

// Explicit development operator command, never part of the production startup path.
async function publish() {
  if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_ID) {
    throw new Error('Development fixture publication is forbidden in production/Railway.');
  }
  const owner = '00000000-0000-0000-0000-000000000001';
  const planId = '00000000-0000-0000-0000-000000000010';
  // The synthetic athlete trains in the UK; its race results set its pace guides.
  await getDatabase()
    .updateTable('athletes')
    .set({ timezone: 'Europe/London' })
    .where('id', '=', owner)
    .execute();
  if (!(await getPerformance(owner)).entries.length) {
    await recordCalibration(
      owner,
      {
        system: 'run_pace',
        input: { method: 'race_result', distanceMetres: 5000, durationSeconds: 1070 },
      },
      new Date('2026-05-11T12:00:00Z'),
    );
    await recordCalibration(
      owner,
      {
        system: 'run_pace',
        input: { method: 'race_result', distanceMetres: 10000, durationSeconds: 2160 },
        observedOn: '2026-05-20',
      },
      new Date('2026-05-21T12:00:00Z'),
    );
  }
  let plan = await getPlan(owner, planId);
  if (!plan.locked) {
    if (plan.draft?.id !== '00000000-0000-0000-0000-000000000050')
      throw new Error('Unexpected development fixture draft.');
    let brief = await getBrief(owner, planId);
    const command = () => ({
      expectedDraftId: brief.versionId,
      expectedEditNumber: brief.editNumber,
    });
    if (!brief.brief.goal)
      brief = await saveBrief(owner, planId, {
        ...command(),
        brief: {
          ...emptyBrief(),
          goal: 'Run Cardiff Half Marathon comfortably and consistently.',
          weeklyDistance: { status: 'known', value: 40000 },
          currentRuns: { status: 'known', value: 5 },
          longestRun: { status: 'known', value: 12000 },
          desiredRuns: 5,
          weekdays: [
            'available',
            'available',
            'available',
            'unavailable',
            'available',
            'preferred',
            'unavailable',
          ],
          context: 'Keep long runs easy. Strength work may accompany running.',
        },
      });
    await confirmBrief(owner, planId, {
      ...command(),
      expectedHash: brief.hash,
      acknowledgedWarningCodes: brief.findings
        .filter((f) => f.severity === 'warning')
        .map((f) => f.code),
    });
    const preview = await previewLock(owner, planId);
    plan = await lockPlan(
      owner,
      planId,
      {
        expectedStateVersion: preview.stateVersion,
        expectedDraftId: preview.draftId,
        expectedEditNumber: preview.editNumber,
        expectedContentHash: preview.contentHash,
        expectedValidationDigest: preview.validationDigest,
        acknowledgedWarningCodes: preview.findings
          .filter((finding) => finding.severity === 'warning')
          .map((finding) => finding.code),
      },
      'cardiff-half-example-v3-publication',
    );
  }
  if (plan.locked?.versionNumber !== 1 || plan.draft || plan.archived)
    throw new Error('Fixture has been edited; refusing to change its lifecycle.');
  await organizePlan(owner, planId, 'activate', plan.stateVersion);
  console.log('Development fixture is locked and active at Version 1.');
}

try {
  await publish();
} catch (error) {
  // No config, SQL parameters, or credentials in operator logs.
  console.error(error instanceof Error ? error.message : 'Fixture publication failed.');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
