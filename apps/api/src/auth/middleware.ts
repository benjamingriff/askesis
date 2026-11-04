import { createClerkClient } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';
import { getApiConfig } from '../config.js';
import { ensureAthlete, syncAthleteTimezone } from './athlete-provisioning.js';
import type { AppEnvironment } from './types.js';

/** Clients report the device's IANA timezone on every request. */
export const TIMEZONE_HEADER = 'X-Askesis-Timezone';

/**
 * Whether a bearer session token names the origin it was issued to (`azp`). Browsers always send
 * one, so Clerk records it; Clerk's native SDKs (the Expo app) send no origin and their tokens
 * carry none. Only the claim's presence is read here, to choose how the token is verified.
 */
export function namesAuthorizedParty(request: Request): boolean {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return true;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    return !!claims && typeof claims === 'object' && 'azp' in claims;
  } catch {
    return true;
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
  // the claim can't be added or removed without invalidating the signature.
  const authorizedParties = namesAuthorizedParty(context.req.raw)
    ? config.clerkAuthorizedParties
    : undefined;
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
  const athlete = await syncAthleteTimezone(
    await ensureAthlete(clerk, auth.userId),
    context.req.header(TIMEZONE_HEADER),
  );
  context.set('athlete', athlete);
  await next();
};
