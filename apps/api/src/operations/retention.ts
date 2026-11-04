import { parseArgs } from 'node:util';
import { getApiConfig } from '../config.js';
import { closeDatabase } from '../database/client.js';
import { runRetention } from '../modules/account/account.service.js';
import { clerkIdentityDeleter } from '../modules/account/retention.sweeper.js';

/** One retention pass. Outside production, --as-of pretends it is later, to test purges. */
try {
  // pnpm forwards a literal `--` between script and arguments.
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { 'as-of': { type: 'string' } },
  });
  const asOf = values['as-of'];
  if (asOf && getApiConfig().NODE_ENV === 'production')
    throw new Error('--as-of is only available outside production.');
  const now = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('--as-of must be an ISO date or time.');
  console.log(JSON.stringify(await runRetention({ now, deleteIdentity: clerkIdentityDeleter() })));
} catch (error) {
  console.error(
    error instanceof Error &&
      (error.message.startsWith('--as-of') ||
        ('code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')))
      ? error.message
      : 'Retention pass failed; check configuration and migrations.',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
