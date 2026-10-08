import { parseArgs } from 'node:util';
import { closeDatabase } from '../database/client.js';
import { seedExampleAccount } from './command.js';
import { ExampleError, exampleEmail } from './config.js';

try {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  console.log(JSON.stringify(await seedExampleAccount(exampleEmail(values.email))));
} catch (error) {
  // Clerk/SQL error payloads may contain credentials or complete rows.
  console.error(
    error instanceof ExampleError
      ? error.message
      : 'Example publication failed; check migrations, Clerk configuration and plan validation. No partial example was committed.',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
