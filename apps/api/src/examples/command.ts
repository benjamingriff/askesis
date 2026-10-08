import { createClerkClient } from '@clerk/backend';
import { getApiConfig } from '../config.js';
import { exampleOwner } from './account.js';
import { exampleEmail } from './config.js';
import { ensureExample } from './seed.js';

export async function seedExampleAccount(email: string) {
  const config = getApiConfig();
  const owner = await exampleOwner(
    createClerkClient({
      secretKey: config.CLERK_SECRET_KEY,
      publishableKey: config.CLERK_PUBLISHABLE_KEY,
    }),
    exampleEmail(email),
  );
  return ensureExample(owner.id);
}
