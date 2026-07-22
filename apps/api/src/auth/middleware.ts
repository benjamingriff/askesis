import { createClerkClient } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';
import { ensureAthlete } from './athlete-provisioning.js';
import type { AppEnvironment } from './types.js';

function configuredAuthorizedParties(): string[] | undefined {
  const value = process.env.CLERK_AUTHORIZED_PARTIES;
  if (value === undefined || value.trim().length === 0) return undefined;
  return value.split(',').map((party) => party.trim()).filter(Boolean);
}

export const requireAuthentication: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (secretKey === undefined || secretKey.length === 0 || publishableKey === undefined || publishableKey.length === 0) {
    console.error('Clerk API keys are not configured');
    return context.json({ error: 'Authentication is not configured' }, 503);
  }

  const clerk = createClerkClient({ secretKey, publishableKey });
  const authorizedParties = configuredAuthorizedParties();
  const requestState = authorizedParties === undefined
    ? await clerk.authenticateRequest(context.req.raw, { acceptsToken: 'session_token' })
    : await clerk.authenticateRequest(context.req.raw, {
        acceptsToken: 'session_token',
        authorizedParties,
      });

  if (!requestState.isAuthenticated) {
    return context.json({ error: 'Authentication required' }, 401);
  }

  const auth = requestState.toAuth();
  const athlete = await ensureAthlete(clerk, auth.userId);
  context.set('athlete', athlete);
  await next();
};
