import type { ClerkClient } from '@clerk/backend';
import { ensureAthlete } from '../auth/athlete-provisioning.js';
import { ExampleError, exampleEmail } from './config.js';

/** Resolve an exact verified email in this API's Clerk instance; never remap identities. */
export async function exampleOwner(clerk: ClerkClient, email: string) {
  const normalized = exampleEmail(email);
  const users = await clerk.users.getUserList({ emailAddress: [normalized], limit: 2 });
  if (users.data.length !== 1 || users.totalCount !== 1)
    throw new ExampleError('Expected exactly one existing Clerk account for the example owner.');
  const user = users.data[0]!;
  if (
    !user.emailAddresses.some(
      (address) =>
        address.emailAddress.toLowerCase() === normalized &&
        address.verification?.status === 'verified',
    )
  )
    throw new ExampleError('The example owner must have a verified matching email.');
  return ensureAthlete(clerk, user.id);
}
