import type { ClerkClient } from '@clerk/backend';
import { database } from '../database/client.js';
import type { AuthenticatedAthlete } from './types.js';

const provider = 'clerk';

async function findAthlete(clerkUserId: string): Promise<AuthenticatedAthlete | null> {
  const row = await database
    .selectFrom('athlete_identities')
    .innerJoin('athletes', 'athletes.id', 'athlete_identities.athlete_id')
    .select([
      'athletes.id',
      'athletes.display_name',
      'athlete_identities.id as identity_id',
    ])
    .where('athlete_identities.provider', '=', provider)
    .where('athlete_identities.provider_subject', '=', clerkUserId)
    .executeTakeFirst();

  if (row === undefined) return null;

  await database
    .updateTable('athlete_identities')
    .set({ last_seen_at: new Date() })
    .where('id', '=', row.identity_id)
    .execute();

  return {
    id: row.id,
    displayName: row.display_name,
    clerkUserId,
  };
}

function profileDisplayName(user: Awaited<ReturnType<ClerkClient['users']['getUser']>>): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (fullName.length > 0) return fullName;

  const primaryEmail = user.emailAddresses.find(({ id }) => id === user.primaryEmailAddressId)?.emailAddress;
  return primaryEmail ?? 'Askesis athlete';
}

export async function ensureAthlete(clerk: ClerkClient, clerkUserId: string): Promise<AuthenticatedAthlete> {
  const existing = await findAthlete(clerkUserId);
  if (existing !== null) return existing;

  const clerkUser = await clerk.users.getUser(clerkUserId);
  const displayName = profileDisplayName(clerkUser);

  try {
    return await database.transaction().execute(async (transaction) => {
      const athlete = await transaction
        .insertInto('athletes')
        .values({ display_name: displayName })
        .returning(['id', 'display_name'])
        .executeTakeFirstOrThrow();

      await transaction
        .insertInto('athlete_identities')
        .values({
          athlete_id: athlete.id,
          provider,
          provider_subject: clerkUserId,
        })
        .execute();

      return {
        id: athlete.id,
        displayName: athlete.display_name,
        clerkUserId,
      };
    });
  } catch (error) {
    // A second first request may have provisioned the same Clerk user concurrently.
    const concurrentlyCreated = await findAthlete(clerkUserId);
    if (concurrentlyCreated !== null) return concurrentlyCreated;
    throw error;
  }
}
