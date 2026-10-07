import { createClerkClient } from '@clerk/backend';
import { closeDatabase, getDatabase } from '../database/client.js';
import {
  fixtureOwner,
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
  const db = getDatabase();
  await db.transaction().execute(async (tx) => {
    // Serialize first-time linking and refuse to replace any existing identity.
    const owner = await tx
      .selectFrom('athletes')
      .select('id')
      .where('id', '=', fixtureOwner)
      .forUpdate()
      .executeTakeFirst();
    if (!owner)
      throw new LocalVerificationError('Development seed is missing. Run pnpm dev:setup.');
    const identities = await tx
      .selectFrom('athlete_identities')
      .select(['athlete_id', 'provider_subject'])
      .where('provider', '=', 'clerk')
      .where((eb) =>
        eb.or([eb('athlete_id', '=', fixtureOwner), eb('provider_subject', '=', userId)]),
      )
      .execute();
    if (
      identities.some(
        (identity) => identity.athlete_id !== fixtureOwner || identity.provider_subject !== userId,
      )
    )
      throw new LocalVerificationError(
        'Verification identity is already linked elsewhere; refusing to reassign it. Use a fresh local database.',
      );
    if (!identities.length) {
      if (mode !== 'prepare')
        throw new LocalVerificationError('Run pnpm dev:setup to link the sample athlete.');
      await tx
        .insertInto('athlete_identities')
        .values({ athlete_id: fixtureOwner, provider: 'clerk', provider_subject: userId })
        .execute();
    }
  });
  if (mode === 'prepare') {
    console.log('Dedicated Clerk development account is linked to the local sample athlete.');
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
