import { describe, expect, it } from 'vitest';
import {
  accentClash,
  accentStops,
  ACCENTS,
  CLASH_DISTANCE,
  colorDistance,
  EFFORT_META,
  EFFORTS,
  phaseColor,
  RETIRED_ACCENTS,
  STATUS_COLORS,
  ZONE_EFFORT,
} from './palette';

const shades = EFFORTS.flatMap((effort) => [EFFORT_META[effort].dark, EFFORT_META[effort].light]);
const nearestEffort = (color: string) =>
  Math.min(...shades.map((shade) => colorDistance(color, shade)));

describe('colour language', () => {
  it('colours each phase by the effort that defines it, warming towards the peak', () => {
    expect(phaseColor('base')).toBe('var(--effort-easy)');
    expect(phaseColor('build')).toBe('var(--effort-threshold)');
    expect(phaseColor('peak')).toBe('var(--effort-hard)');
    expect(phaseColor('taper')).toBe('var(--effort-steady)');
    expect(phaseColor('recovery')).toBe('var(--effort-recovery)');
    expect(phaseColor(null)).toBe('var(--text-muted)');
  });

  it('keeps every accent, blend end and the locked status apart from the effort colours', () => {
    const colors = [
      ...ACCENTS.flatMap((accent) => [
        ...accent.stops,
        ...(accent.adaptive ? [accent.adaptive.dark, accent.adaptive.light] : []),
      ]),
      STATUS_COLORS.locked,
    ];
    for (const color of colors) expect(nearestEffort(color)).toBeGreaterThan(CLASH_DISTANCE);
  });

  it('keeps neighbouring effort steps distinguishable in dark and light themes', () => {
    for (const mode of ['dark', 'light'] as const)
      for (let i = 1; i < EFFORTS.length; i++) {
        const a = EFFORT_META[EFFORTS[i - 1]!][mode];
        const b = EFFORT_META[EFFORTS[i]!][mode];
        expect(colorDistance(a, b)).toBeGreaterThan(CLASH_DISTANCE);
      }
  });

  it('places comparable zones from every system on the same effort step', () => {
    expect(ZONE_EFFORT.threshold).toBe('threshold');
    expect(ZONE_EFFORT.sweet_spot).toBe('threshold');
    expect([ZONE_EFFORT.easy, ZONE_EFFORT.endurance]).toEqual(['easy', 'easy']);
    expect([ZONE_EFFORT.interval, ZONE_EFFORT.vo2max]).toEqual(['hard', 'hard']);
    expect([ZONE_EFFORT.repetition, ZONE_EFFORT.anaerobic, ZONE_EFFORT.speed]).toEqual([
      'max',
      'max',
      'max',
    ]);
  });

  it('maps every retired preset onto an accent that still exists', () => {
    const ids = new Set(ACCENTS.map((accent) => accent.id));
    for (const id of Object.values(RETIRED_ACCENTS)) expect(ids.has(id)).toBe(true);
  });

  it('flags a custom accent that would blend into workouts', () => {
    expect(accentClash('#FBBF24')).toBe('threshold');
    expect(accentClash('#38bdf8')).toBe('easy');
    expect(accentClash('#8B7CFF')).toBeNull();
    expect(accentClash('not a colour')).toBeNull();
  });

  it('resolves presets, adaptive accents and custom colours to their stops', () => {
    expect(accentStops('nebula', 'dark')).toHaveLength(2);
    expect(accentStops('mono', 'light')).not.toEqual(accentStops('mono', 'dark'));
    expect(accentStops('#abcdef', 'dark')).toEqual(['#ABCDEF']);
  });
});
