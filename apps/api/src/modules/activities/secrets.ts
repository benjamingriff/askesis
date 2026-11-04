import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Separate keys per purpose, derived from the one configured integration key. */
function derive(masterKey: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(masterKey, 'base64'), '', purpose, 32));
}

/** AES-256-GCM, stored as `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function encryptSecret(plaintext: string, masterKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(masterKey, 'askesis-token-v1'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptSecret(stored: string, masterKey: string): string {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined)
    throw new Error('Unrecognized secret format.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derive(masterKey, 'askesis-token-v1'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

type OAuthState = { athleteId: string; provider: string; expiresAt: number };

/**
 * A signed, expiring OAuth `state` bound to the athlete who started the connection. Only that
 * athlete's authenticated session can complete it, so a forged callback cannot attach someone
 * else's provider account.
 */
export function signOAuthState(state: OAuthState, masterKey: string): string {
  const body = Buffer.from(
    JSON.stringify({ ...state, nonce: randomBytes(12).toString('base64url') }),
  ).toString('base64url');
  const signature = createHmac('sha256', derive(masterKey, 'askesis-oauth-state-v1'))
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}

export function verifyOAuthState(
  value: string,
  masterKey: string,
  expected: { athleteId: string; provider: string },
  now = Date.now(),
): boolean {
  const [body, signature] = value.split('.');
  if (!body || !signature) return false;
  const actual = Buffer.from(signature, 'base64url');
  const wanted = createHmac('sha256', derive(masterKey, 'askesis-oauth-state-v1'))
    .update(body)
    .digest();
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return false;
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
    return (
      state.athleteId === expected.athleteId &&
      state.provider === expected.provider &&
      typeof state.expiresAt === 'number' &&
      state.expiresAt > now
    );
  } catch {
    return false;
  }
}
