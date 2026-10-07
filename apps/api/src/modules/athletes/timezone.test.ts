import { describe, expect, it } from 'vitest';
import { validTimezone, localDate } from './timezone.js';

describe('athlete timezone', () => {
  it('uses the athlete calendar date across midnight and daylight saving', () => {
    const now = new Date('2026-09-09T23:30:00Z');
    expect(localDate('Europe/London', now)).toBe('2026-09-10');
    expect(localDate('America/Los_Angeles', now)).toBe('2026-09-09');
    expect(localDate('Europe/London', new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-01');
  });
  it('accepts IANA names from devices and rejects anything else', () => {
    expect(validTimezone('Europe/London')).toBe('Europe/London');
    expect(validTimezone('UTC')).toBe('UTC');
    expect(validTimezone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    for (const value of [
      undefined,
      null,
      '',
      'Mars/Olympus',
      'Europe/London; drop',
      'x'.repeat(101),
    ])
      expect(validTimezone(value)).toBeNull();
  });
});
