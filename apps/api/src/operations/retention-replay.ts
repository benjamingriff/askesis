import { readFile } from 'node:fs/promises';
import { closeDatabase } from '../database/client.js';
import { replayDeletionEvents } from '../modules/account/account.service.js';
import { parseDeletionLog } from '../modules/account/retention.js';

/**
 * Re-applies the "Data deletion" log lines (pino JSON, oldest first) recorded after a backup
 * was taken, before a restored database takes traffic. Other log lines are ignored.
 */
try {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: retention:replay <log file with JSON lines, oldest first>');
  const events = parseDeletionLog(await readFile(file, 'utf8'));
  const applied = await replayDeletionEvents(events);
  console.log(JSON.stringify({ events: events.length, applied }));
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith('Usage')
      ? error.message
      : 'Deletion replay failed; check the log file, configuration and migrations.',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
