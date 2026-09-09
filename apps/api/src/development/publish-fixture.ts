import { closeDatabase } from '../database/client.js';
import { getPlan, lockPlan, organizePlan, previewLock } from '../modules/plans/plan.service.js';

// Explicit development operator command, never part of the production startup path.
async function publish() {
  if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_ID) {
    throw new Error('Development fixture publication is forbidden in production/Railway.');
  }
  const owner = '00000000-0000-0000-0000-000000000001';
  const planId = '00000000-0000-0000-0000-000000000010';
  let plan = await getPlan(owner, planId);
  if (!plan.locked) {
    if (plan.draft?.id !== '00000000-0000-0000-0000-000000000050')
      throw new Error('Unexpected development fixture draft.');
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
      'cardiff-half-example-v2-publication',
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
