import '../instrument.js';
import { closeDatabase } from '../database/client.js';
import { configuredExampleEmail, ExampleError } from '../examples/config.js';
import { seedExampleAccount } from '../examples/command.js';

try {
  const email = configuredExampleEmail(process.env);
  if (email) console.log('Example publication:', JSON.stringify(await seedExampleAccount(email)));
  // Start listeners and background workers only after atomic publication succeeds.
  await import('../server.js');
} catch (error) {
  console.error(
    error instanceof ExampleError
      ? error.message
      : 'API startup failed; check configuration, migrations and example publication.',
  );
  await closeDatabase();
  process.exitCode = 1;
}
