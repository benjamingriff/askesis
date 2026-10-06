import { describe, expect, it } from 'vitest';
import { calculatePaces, nearestZone, planToday } from './pace.calculator.js';

describe('run-pace-v1', () => {
  it('matches the published 38:46 10K reference scalar of approximately 53.9', () => {
    expect(
      calculatePaces({ method: 'race_result', distanceMetres: 10000, durationSeconds: 2326 })
        .fitness,
    ).toBeCloseTo(53.9, 0);
  });
  it('round trips a threshold anchor without changing its target', () => {
    for (const pace of [180, 240, 360, 480]) {
      const result = calculatePaces({ method: 'threshold_pace', secondsPerKilometre: pace });
      expect(result.zones[2]!.target).toBeCloseTo(pace, 3);
      for (const zone of result.zones) {
        expect(zone.fast).toBeLessThan(zone.target);
        expect(zone.target).toBeLessThan(zone.slow);
      }
      expect(result.zones[0]!.slow - result.zones[0]!.fast).toBeGreaterThan(
        result.zones[4]!.slow - result.zones[4]!.fast,
      );
    }
  });
  it('supports all distances and improves every guide for faster race results', () => {
    for (const distance of [1609.344, 5000, 8046.72, 10000, 21097.5, 42195]) {
      const slow = calculatePaces({
        method: 'race_result',
        distanceMetres: distance,
        durationSeconds: Math.round(distance * 0.3),
      });
      const fast = calculatePaces({
        method: 'race_result',
        distanceMetres: distance,
        durationSeconds: Math.round(distance * 0.25),
      });
      fast.zones.forEach((zone, i) => expect(zone.target).toBeLessThan(slow.zones[i]!.target));
    }
  });
  it('rejects unsupported distances and impossible inputs', () => {
    for (const distance of [0, 1600, 50000, NaN])
      expect(() =>
        calculatePaces({ method: 'race_result', distanceMetres: distance, durationSeconds: 1200 }),
      ).toThrow();
    for (const pace of [0, -1, NaN, Infinity, 1])
      expect(() =>
        calculatePaces({ method: 'threshold_pace', secondsPerKilometre: pace }),
      ).toThrow();
  });
  it('assigns explicit paces to the containing zone, else the nearest target', () => {
    const { zones } = calculatePaces({ method: 'threshold_pace', secondsPerKilometre: 270 });
    const zone = (key: string) => zones.find((z) => z.key === key)!;
    for (const z of zones) {
      expect(nearestZone(z.target, zones)?.key).toBe(z.key);
      expect(nearestZone(z.fast, zones)?.key).toBe(z.key);
    }
    // A few seconds off a zone's range still reads as that zone.
    expect(nearestZone(zone('interval').fast - 3, zones)?.key).toBe('interval');
    expect(nearestZone(zone('easy').slow + 60, zones)?.key).toBe('easy');
    expect(nearestZone(zone('repetition').fast - 30, zones)?.key).toBe('repetition');
    expect(nearestZone(300, [])).toBeNull();
  });
  it('uses the plan calendar date across midnight and daylight saving', () => {
    const now = new Date('2026-09-09T23:30:00Z');
    expect(planToday('Europe/London', now)).toBe('2026-09-10');
    expect(planToday('America/Los_Angeles', now)).toBe('2026-09-09');
    expect(planToday('Europe/London', new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-01');
  });
});
