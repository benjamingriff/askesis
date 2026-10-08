import { createClerkClient } from '@clerk/backend';
import { closeDatabase } from '../database/client.js';
import { ensureAthlete } from '../auth/athlete-provisioning.js';
import {
  LocalVerificationError,
  verificationConfig,
  verificationEmail,
} from './verification-config.js';

async function main() {
  const config = verificationConfig(process.env);
  const mode = process.argv[2];
  if (mode === 'check') {
    console.log(`Local verification configuration is valid. Browser: ${config.webOrigin}`);
    return;
  }
  if (mode !== 'prepare' && mode !== 'login')
    throw new LocalVerificationError('Expected check, prepare or login.');
  const clerk = createClerkClient(config);
  const users = await clerk.users.getUserList({ emailAddress: [verificationEmail], limit: 2 });
  if (users.data.length > 1)
    throw new LocalVerificationError('Multiple verification users found; refusing to choose.');
  let user = users.data[0];
  if (!user && mode === 'prepare') {
    user = await clerk.users.createUser({
      emailAddress: [verificationEmail],
      firstName: 'Local',
      lastName: 'Verification',
      skipPasswordRequirement: true,
    });
  }
  if (!user)
    throw new LocalVerificationError('Run pnpm dev:setup to prepare the verification account.');
  const userId = user.id;
  await ensureAthlete(clerk, userId);
  if (mode === 'prepare') {
    console.log(
      'Dedicated Clerk development account is ready. Fresh databases start with no plans.',
    );
    return;
  }
  const task = await clerk.agentTasks.create({
    onBehalfOf: { userId },
    permissions: '*',
    agentName: 'askesis-local-verification',
    taskDescription: 'Verify local Askesis UI and capture screenshots/video.',
    redirectUrl: `${config.webOrigin}/plan`,
    sessionMaxDurationInSeconds: 1800,
  });
  // This URL is a login credential; use it in the browser, never in evidence or commits.
  console.log(
    JSON.stringify({ url: task.url, agentTaskId: task.agentTaskId, webOrigin: config.webOrigin }),
  );
}

try {
  await main();
} catch (error) {
  // Clerk error payloads can contain sensitive request details; never log them.
  console.error(
    error instanceof LocalVerificationError
      ? error.message
      : 'Local verification failed. Check development keys, database readiness and Clerk Agent Tasks availability.',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
