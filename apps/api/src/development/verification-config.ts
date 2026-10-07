export const verificationEmail = 'askesis-verification+clerk_test@example.com';
export const fixtureOwner = '00000000-0000-0000-0000-000000000001';
export class LocalVerificationError extends Error {}

export function verificationConfig(environment: NodeJS.ProcessEnv) {
  if (
    environment.NODE_ENV === 'production' ||
    Object.keys(environment).some((key) => key.startsWith('RAILWAY_'))
  )
    throw new LocalVerificationError('Local verification is forbidden in production/Railway.');
  const secretKey = environment.CLERK_SECRET_KEY;
  const publishableKey =
    environment.CLERK_PUBLISHABLE_KEY ?? environment.VITE_CLERK_PUBLISHABLE_KEY;
  if (
    !secretKey?.startsWith('sk_test_') ||
    !publishableKey?.startsWith('pk_test_') ||
    /replace_me/.test(secretKey + publishableKey)
  )
    throw new LocalVerificationError(
      'Local verification requires real Clerk development keys (pk_test_/sk_test_).',
    );
  let database: URL;
  let web: URL;
  try {
    database = new URL(environment.DATABASE_URL ?? '');
    web = new URL(
      environment.LOCAL_WEB_URL ?? `http://localhost:${environment.WEB_PORT ?? '5173'}`,
    );
  } catch {
    throw new LocalVerificationError(
      'Configure DATABASE_URL and LOCAL_WEB_URL for local verification.',
    );
  }
  const isLoopback = (host: string) =>
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !isLoopback(database.hostname) ||
    database.pathname !== '/askesis' ||
    database.username !== 'askesis'
  )
    throw new LocalVerificationError(
      'Local verification requires a loopback Askesis development database.',
    );
  // pg gives connection-string query options precedence over the URL authority.
  // Allow only the TLS mode used by local setup so the checked target cannot change.
  if ([...database.searchParams.keys()].some((key) => key !== 'sslmode'))
    throw new LocalVerificationError(
      'Local verification DATABASE_URL supports only the sslmode query parameter.',
    );
  if (
    web.protocol !== 'http:' ||
    !isLoopback(web.hostname) ||
    web.username ||
    web.password ||
    web.search ||
    web.hash ||
    web.pathname !== '/'
  )
    throw new LocalVerificationError('LOCAL_WEB_URL must be a loopback HTTP origin.');
  const authorizedParties = environment.CLERK_AUTHORIZED_PARTIES?.split(',').map((party) =>
    party.trim(),
  );
  if (!authorizedParties?.includes(web.origin))
    throw new LocalVerificationError('CLERK_AUTHORIZED_PARTIES must include LOCAL_WEB_URL.');
  return { secretKey, publishableKey, webOrigin: web.origin };
}
