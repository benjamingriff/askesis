import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, signOAuthState, verifyOAuthState } from './secrets.js';

const key = randomBytes(32).toString('base64');
const other = randomBytes(32).toString('base64');

describe('provider secrets', () => {
  it('round-trips tokens without storing plaintext, and rejects another key or tampering', () => {
    const stored = encryptSecret('refresh-token-value', key);
    expect(stored).not.toContain('refresh-token-value');
    expect(encryptSecret('refresh-token-value', key)).not.toBe(stored);
    expect(decryptSecret(stored, key)).toBe('refresh-token-value');
    expect(() => decryptSecret(stored, other)).toThrow();
    const [version, iv, tag, ciphertext] = stored.split('.');
    const flipped = Buffer.from(ciphertext!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      decryptSecret([version, iv, tag, flipped.toString('base64url')].join('.'), key),
    ).toThrow();
  });

  it('binds OAuth state to the athlete, provider and expiry', () => {
    const now = Date.parse('2026-10-13T10:00:00Z');
    const state = signOAuthState(
      { athleteId: 'athlete-a', provider: 'strava', expiresAt: now + 600_000 },
      key,
    );
    const expected = { athleteId: 'athlete-a', provider: 'strava' };
    expect(verifyOAuthState(state, key, expected, now)).toBe(true);
    expect(verifyOAuthState(state, key, { ...expected, athleteId: 'athlete-b' }, now)).toBe(false);
    expect(verifyOAuthState(state, other, expected, now)).toBe(false);
    expect(verifyOAuthState(state, key, expected, now + 600_001)).toBe(false);
    expect(verifyOAuthState(`${state}x`, key, expected, now)).toBe(false);
    expect(verifyOAuthState('nonsense', key, expected, now)).toBe(false);
  });
});
