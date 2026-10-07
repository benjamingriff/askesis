import type { CalibrationEntry } from '@askesis/api-client';
import { describe, expect, it } from 'vitest';
import { describeEvidence, formatZoneValue, planSports, systemsForSports } from './sports';
import { formatLoad, formatSwimDistance, formatSwimPace } from './format';

const entry = (input: CalibrationEntry['input'], system: CalibrationEntry['system']) =>
  ({
    id: 'e',
    system,
    method: input.method,
    input,
    calculatorVersion: 'v1',
    provenance: 'user_supplied',
    estimateBasis: null,
    observedOn: null,
    effectiveFrom: '2026-10-07',
    recordedAt: '2026-10-07T08:00:00Z',
    recordedBy: 'athlete',
    conversationId: null,
    retractedAt: null,
    zones: [
      {
        key: 'threshold',
        metric: 'pace',
        unit: 'seconds_per_100_metres',
        minimum: 101,
        target: 105,
        maximum: 106,
      },
    ],
  }) satisfies CalibrationEntry;
const metric = { units: 'km', pool: 'm' } as const;

describe('sport formatting', () => {
  it('formats swim paces and distances in pool units', () => {
    expect(formatSwimPace(105, 'm')).toBe('1:45/100m');
    // 100 yards is 91.44 m, so the same speed takes 96 seconds.
    expect(formatSwimPace(105, 'yd')).toBe('1:36/100yd');
    expect(formatSwimDistance(1500, 'm')).toBe('1,500 m');
    expect(formatSwimDistance(91.44, 'yd')).toBe('100 yd');
    expect(formatZoneValue(250, 'watts', metric)).toBe('250 W');
    expect(formatLoad(60, 'kg')).toBe('60 kg');
    expect(formatLoad(60, 'lb')).toBe('130 lb');
  });
  it('describes the evidence behind each system’s entry', () => {
    expect(describeEvidence(entry({ method: 'ftp', watts: 250 }, 'cycle_power'), metric)).toBe(
      'FTP 250 W',
    );
    expect(
      describeEvidence(
        entry({ method: 'twenty_minute_test', averageWatts: 263 }, 'cycle_power'),
        metric,
      ),
    ).toBe('20-minute test at 263 W → FTP 250 W');
    expect(
      describeEvidence(
        entry({ method: 'css_test', t400Seconds: 380, t200Seconds: 170 }, 'swim_pace'),
        metric,
      ),
    ).toBe('400 in 6:20, 200 in 2:50 → CSS 1:45/100m');
  });
  it('finds the systems a plan’s sports need, in display order', () => {
    expect(systemsForSports(['strength', 'swim', 'run'])).toEqual(['run_pace', 'swim_pace']);
    expect(
      planSports({ sports: [{ sport: 'swim' }] }, [
        { discipline: 'cycle' },
        { discipline: 'swim' },
      ]),
    ).toEqual(['swim', 'cycle']);
  });
});
