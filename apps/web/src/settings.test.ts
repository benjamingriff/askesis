import { describe, expect, it } from 'vitest';
import { buildTheme, DEFAULT_SETTINGS, readAccent } from './settings';

describe('accent preference', () => {
  it('keeps presets and custom colours, and moves retired presets to their successors', () => {
    expect(readAccent('nebula')).toBe('nebula');
    expect(readAccent('#123abc')).toBe('#123ABC');
    expect(readAccent('#FFC233')).toBe('acid');
    expect(readAccent('#38bdf8')).toBe('ultraviolet');
    expect(readAccent(42)).toBe('volt');
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
