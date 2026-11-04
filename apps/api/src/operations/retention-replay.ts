import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { closeDatabase } from '../database/client.js';
import { ReplayGapError, replayDeletionEvents } from '../modules/account/account.service.js';
import { parseDeletionLog } from '../modules/account/journal.js';

/**
 * Re-applies the deletion journal entries shipped to the API logs (pino JSON lines, any order,
 * duplicates allowed) to a restored database, before it takes traffic. The logs must cover every
 * entry after the restored journal head up to the journal's end: --through (the damaged database's
 * deletion_journal_head) or the latest logged checkpoint. Otherwise it refuses, unless
 * --allow-gaps accepts the loss.
 */
try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    allowPositionals: true,
    options: {
      'allow-gaps': { type: 'boolean', default: false },
      through: { type: 'string' },
    },
  });
  const file = positionals[0];
  if (!file)
    throw new ReplayGapError(
      'Usage: retention:replay <log file> [--through <sequence>] [--allow-gaps]',
    );
  const through = values.through === undefined ? undefined : Number(values.through);
  if (through !== undefined && !Number.isSafeInteger(through))
    throw new ReplayGapError('--through must be a journal sequence number.');
  const log = parseDeletionLog(await readFile(file, 'utf8'));
  console.log(
    JSON.stringify(await replayDeletionEvents(log, { through, allowGaps: values['allow-gaps'] })),
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
