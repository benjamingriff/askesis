import { createClerkClient } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';
import { getApiConfig } from '../config.js';
import { ensureAthlete } from './athlete-provisioning.js';
import type { AppEnvironment } from './types.js';

export const requireAuthentication: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const config = getApiConfig();
  const clerk = createClerkClient({
    secretKey: config.CLERK_SECRET_KEY,
    publishableKey: config.CLERK_PUBLISHABLE_KEY,
  });
  const authorizedParties = config.clerkAuthorizedParties;
  const requestState =
    authorizedParties === undefined
      ? await clerk.authenticateRequest(context.req.raw, { acceptsToken: 'session_token' })
      : await clerk.authenticateRequest(context.req.raw, {
          acceptsToken: 'session_token',
          authorizedParties,
        });

  if (!requestState.isAuthenticated) {
    return context.json(
      {
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          requestId: context.get('requestId'),
        },
      },
      401,
    );
  }

  const auth = requestState.toAuth();
  const athlete = await ensureAthlete(clerk, auth.userId);
  context.set('athlete', athlete);
  await next();
};
