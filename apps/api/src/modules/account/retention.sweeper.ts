import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import { getApiConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { runRetention, type DeleteIdentity } from './account.service.js';

const INTERVAL_MS = 15 * 60 * 1000;

/**
 * Deletes Clerk users in production only. Local development shares one Clerk verification
 * user across worktrees, so a local purge removes database data and the next sign-in starts
 * an empty account.
 */
export function clerkIdentityDeleter(): DeleteIdentity | undefined {
  const config = getApiConfig();
  if (config.NODE_ENV !== 'production') return undefined;
  const clerk = createClerkClient({
    secretKey: config.CLERK_SECRET_KEY,
    publishableKey: config.CLERK_PUBLISHABLE_KEY,
  });
  return async (clerkUserId) => {
    try {
      await clerk.users.deleteUser(clerkUserId);
    } catch (error) {
      if (isClerkAPIResponseError(error) && error.status === 404) return;
      throw error;
    }
  };
}

/** Purges deleted plans and accounts once their windows close, in every execution mode. */
export function startRetentionSweeper() {
  let stopping = false;
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (stopping || pending) return;
    pending = runRetention({ deleteIdentity: clerkIdentityDeleter() })
      .then((result) => {
        if (result.plans || result.accounts) logger.info(result, 'Retention purge completed.');
      })
      .catch(() => logger.error('Retention pass failed.'))
      .finally(() => {
        pending = undefined;
      });
  };
  const first = setTimeout(tick, 30_000);
  first.unref();
  const interval = setInterval(tick, INTERVAL_MS);
  interval.unref();
  return async () => {
    stopping = true;
    clearTimeout(first);
    clearInterval(interval);
    await pending;
  };
}
