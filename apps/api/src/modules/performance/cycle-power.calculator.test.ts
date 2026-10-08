import { describe, expect, it } from 'vitest';
import { calculatePower, ftpFrom, POWER_ZONE_KEYS } from './cycle-power.calculator.js';
import { nearestZone } from './run-pace.calculator.js';

describe('cycle-power-v1', () => {
  it('derives FTP from each protocol', () => {
    expect(ftpFrom({ method: 'ftp', watts: 250 })).toBe(250);
    expect(ftpFrom({ method: 'twenty_minute_test', averageWatts: 263 })).toBeCloseTo(249.85, 2);
    expect(ftpFrom({ method: 'ramp_test', bestMinuteWatts: 333 })).toBeCloseTo(249.75, 2);
    expect(calculatePower({ method: 'twenty_minute_test', averageWatts: 263 }).ftp).toBe(250);
  });
  it('builds Coggan zones as rounded watts around FTP', () => {
    const { zones, calculatorVersion } = calculatePower({ method: 'ftp', watts: 250 });
    expect(calculatorVersion).toBe('cycle-power-v1');
    expect(zones.map((zone) => zone.key)).toEqual([...POWER_ZONE_KEYS]);
    const zone = (key: string) => zones.find((candidate) => candidate.key === key)!;
    expect(zone('endurance')).toEqual({
      key: 'endurance',
      minimum: 140,
      target: 163,
      maximum: 188,
    });
    expect(zone('threshold')).toEqual({
      key: 'threshold',
      minimum: 228,
      target: 250,
      maximum: 263,
    });
    expect(zone('sweet_spot').minimum).toBe(220);
    for (const band of zones) {
      expect(band.minimum).toBeLessThan(band.target);
      expect(band.target).toBeLessThan(band.maximum);
    }
  });
  it('assigns an explicit power to the zone that contains it', () => {
    const zones = calculatePower({ method: 'ftp', watts: 250 }).zones.map((zone) => ({
      key: zone.key,
      fast: zone.minimum,
      target: zone.target,
      slow: zone.maximum,
    }));
    expect(nearestZone(165, zones)?.key).toBe('endurance');
    expect(nearestZone(300, zones)?.key).toBe('vo2max');
    expect(nearestZone(500, zones)?.key).toBe('anaerobic');
  });
  it('rejects powers outside the supported FTP range', () => {
    expect(() => calculatePower({ method: 'ftp', watts: 30 })).toThrow(/outside the supported/);
    expect(() => calculatePower({ method: 'ramp_test', bestMinuteWatts: 900 })).toThrow(
      /outside the supported/,
    );
    expect(() => calculatePower({ method: 'ftp', watts: Number.NaN })).toThrow(/positive power/);
  });
});
