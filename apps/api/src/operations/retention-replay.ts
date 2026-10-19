import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { closeDatabase } from '../database/client.js';
import { ReplayGapError, replayDeletionEvents } from '../modules/account/account.service.js';
import { parseDeletionLog } from '../modules/account/journal.js';

/**
 * Re-applies the deletion journal entries shipped to the API logs (pino JSON lines, any order,
 * duplicates allowed) to a restored database, before it takes traffic. Refuses when entries after
 * the restored journal head are missing, unless --allow-gaps accepts that loss.
 */
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'allow-gaps': { type: 'boolean', default: false } },
  });
  const file = positionals[0];
  if (!file) throw new ReplayGapError('Usage: retention:replay <log file> [--allow-gaps]');
  const events = parseDeletionLog(await readFile(file, 'utf8'));
  console.log(
    JSON.stringify(await replayDeletionEvents(events, { allowGaps: values['allow-gaps'] })),
  );
} catch (error) {
  console.error(
    error instanceof ReplayGapError
      ? error.message
      : 'Deletion replay failed; check the log file, configuration and migrations.',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
