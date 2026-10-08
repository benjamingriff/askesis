import { describe, expect, it } from 'vitest';
import { ACCENTS, accentStops, contrastRatio } from './theme/palette';
import { buildTheme, DEFAULT_SETTINGS, readAccent } from './settings';

describe('accent preference', () => {
  it('keeps presets and custom colours, and moves retired presets to their successors', () => {
    expect(readAccent('nebula')).toBe('nebula');
    expect(readAccent('#123abc')).toBe('#123ABC');
    expect(readAccent('#FFC233', true)).toBe('acid');
    expect(readAccent('#38bdf8', true)).toBe('ultraviolet');
    expect(readAccent(42)).toBe('volt');
  });

  it('keeps a custom colour saved since presets, even one matching a retired preset', () => {
    expect(readAccent('#38bdf8')).toBe('#38BDF8');
  });

  it('keeps text on every accent fill readable at its weakest stop', () => {
    for (const accent of ACCENTS) {
      for (const mode of ['dark', 'light'] as const) {
        const { onAccent } = buildTheme({ ...DEFAULT_SETTINGS, mode, accent: accent.id }, mode);
        const worst = Math.min(
          ...accentStops(accent.id, mode).map((stop) => contrastRatio(onAccent, stop)),
        );
        expect(worst, `${accent.name} on ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('fills controls with a gradient for blends and one colour otherwise', () => {
    const blend = buildTheme({ ...DEFAULT_SETTINGS, accent: 'nebula' }, 'dark');
    expect(blend.accentFill).toMatch(/^linear-gradient/);
    expect(blend.accentStops).toHaveLength(2);
    const solid = buildTheme({ ...DEFAULT_SETTINGS, accent: 'volt' }, 'dark');
    expect(solid.accentFill).toBe('#C8F031');
    expect(solid.onAccent).toBe('#0A0A0B');
  });

  it('turns Mono to ink on light themes so it still reads', () => {
    const light = buildTheme({ ...DEFAULT_SETTINGS, mode: 'light', accent: 'mono' }, 'dark');
    expect(light.accent).toBe('#1A191F');
    expect(light.onAccent).toBe('#FFFFFF');
  });
});
