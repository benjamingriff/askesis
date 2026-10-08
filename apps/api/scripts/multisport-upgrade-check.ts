// Rehearsal helper for scripts/test-multisport-upgrade.sh; never part of the application.
import { closeDatabase, getDatabase } from '../src/database/client.js';
import { contentHash, type SemanticValue } from '../src/modules/plans/plan.canonical.js';
import { readBrief } from '../src/modules/plans/brief.service.js';

const unanswered = { status: 'unanswered', value: null };
const weekdays = Array<string>(7).fill('available');
/** Hashes as the pre-migration brief service computed them for the rehearsal's briefs. */
const legacy = (brief: Record<string, unknown>) =>
  contentHash({
    brief: { context: '', weekdays, ...brief },
    startDate: '2026-05-11',
    endDate: '2026-10-04',
  } as unknown as SemanticValue);
const locked = legacy({
  goal: 'Locked goal',
  weeklyDistance: { status: 'known', value: 40000 },
  currentRuns: { status: 'known', value: 5 },
  longestRun: { status: 'unknown', value: null },
  desiredRuns: 5,
});
const draft = legacy({
  goal: 'Draft goal',
  weeklyDistance: unanswered,
  currentRuns: unanswered,
  longestRun: unanswered,
  desiredRuns: 4,
});

try {
  if (process.argv[2] === 'hashes') console.log(`${locked} ${draft}`);
  else {
    const db = getDatabase();
    for (const id of [
      '00000000-0000-0000-0000-000000000050',
      '00000000-0000-0000-0000-000000000051',
    ]) {
      const state = await readBrief(db, id);
      if (!state.confirmed || state.coverage.some((range) => !range.current))
        throw new Error(`Brief ${id} lost its confirmation or coverage in the migration.`);
    }
    console.log('Migrated briefs keep their confirmations and current coverage.');
  }
} finally {
  await closeDatabase();
}
