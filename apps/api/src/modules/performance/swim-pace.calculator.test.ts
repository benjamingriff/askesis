import { describe, expect, it } from 'vitest';
import { calculateSwim, cssPaceFrom, SWIM_ZONE_KEYS } from './swim-pace.calculator.js';

describe('swim-css-v1', () => {
  it('derives CSS pace per 100 m from a 400/200 test', () => {
    // 6:20 and 2:50 give a CSS speed of 200 / 210 m/s, or 1:45 per 100 m.
    expect(cssPaceFrom({ method: 'css_test', t400Seconds: 380, t200Seconds: 170 })).toBe(105);
    expect(calculateSwim({ method: 'css_test', t400Seconds: 380, t200Seconds: 170 }).cssPace).toBe(
      105,
    );
  });
  it('anchors threshold at CSS and orders every band fast to slow', () => {
    const { zones, calculatorVersion } = calculateSwim({
      method: 'css_pace',
      secondsPer100Metres: 105,
    });
    expect(calculatorVersion).toBe('swim-css-v1');
    expect(zones.map((zone) => zone.key)).toEqual([...SWIM_ZONE_KEYS]);
    const threshold = zones.find((zone) => zone.key === 'threshold')!;
    expect(threshold.target).toBe(105);
    // Bands are fractions of speed, so a slower band has a longer time per 100 m.
    expect(zones.find((zone) => zone.key === 'endurance')!.target).toBeCloseTo(116.667, 3);
    for (const zone of zones) {
      expect(zone.fast).toBeLessThan(zone.target);
      expect(zone.target).toBeLessThan(zone.slow);
    }
    for (let i = 1; i < zones.length; i++)
      expect(zones[i]!.target).toBeLessThan(zones[i - 1]!.target);
  });
  it('rejects a test whose 200 was not all-out and paces outside the supported range', () => {
    expect(() => calculateSwim({ method: 'css_test', t400Seconds: 330, t200Seconds: 170 })).toThrow(
      /slower per 100/,
    );
    expect(() => calculateSwim({ method: 'css_pace', secondsPer100Metres: 40 })).toThrow(
      /outside the supported/,
    );
    expect(() => calculateSwim({ method: 'css_pace', secondsPer100Metres: 400 })).toThrow(
      /outside the supported/,
    );
  });
});
