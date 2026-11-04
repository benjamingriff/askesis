import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import type { MiddlewareHandler } from 'hono';
import { getApiConfig } from '../config.js';
import { ensureAthlete, syncAthleteTimezone } from './athlete-provisioning.js';
import type { AppEnvironment } from './types.js';

/** Clients report the device's IANA timezone on every request. */
export const TIMEZONE_HEADER = 'X-Askesis-Timezone';

/**
 * A native app's session token: a bearer token whose claims name no origin (`azp`). Browsers
 * always send one, so Clerk records it; Clerk's native SDKs (the Expo app) send no origin and
 * their tokens carry none. Only the claim's presence is read here, to choose how to verify.
 */
export function nativeSessionToken(request: Request): string | null {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    return !!claims && typeof claims === 'object' && !('azp' in claims) ? token : null;
  } catch {
    return null;
  }
}

export const requireAuthentication: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const config = getApiConfig();
  const clerk = createClerkClient({
    secretKey: config.CLERK_SECRET_KEY,
    publishableKey: config.CLERK_PUBLISHABLE_KEY,
  });
  // Authorized parties restrict which browser origins a token may come from. A native app's
  // token has no origin to check, so it is verified (signature, expiry, issuer) without the list;
  // the claim can't be added or removed without invalidating the signature. Clerk gets only that
  // token, with no cookies, so the exemption covers exactly the token it verifies.
  const nativeToken = nativeSessionToken(context.req.raw);
  const authorizedParties = config.clerkAuthorizedParties;
  const requestState = nativeToken
    ? await clerk.authenticateRequest(
        new Request(context.req.url, { headers: { Authorization: `Bearer ${nativeToken}` } }),
        { acceptsToken: 'session_token' },
      )
    : authorizedParties === undefined
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
  let provisioned;
  try {
    provisioned = await ensureAthlete(clerk, auth.userId);
  } catch (error) {
    // A session token can outlive its user for a minute after an account purge.
    if (isClerkAPIResponseError(error) && error.status === 404)
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
    throw error;
  }
  const athlete = await syncAthleteTimezone(provisioned, context.req.header(TIMEZONE_HEADER));
  context.set('athlete', athlete);
  // During the grace period the athlete can only review, export or cancel the deletion.
  if (athlete.deletionPending && !context.req.path.startsWith('/api/v1/account')) {
    return context.json(
      {
        error: {
          code: 'ACCOUNT_DELETION_PENDING',
          message: 'This account is scheduled for deletion. Cancel the deletion to continue.',
          requestId: context.get('requestId'),
        },
      },
      403,
    );
  }
  await next();
};
