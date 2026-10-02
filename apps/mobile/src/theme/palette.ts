export type ThemeId = 'midnight' | 'graphite' | 'forest' | 'dusk' | 'paper' | 'daylight';

export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textDim: string;
  textMuted: string;
  overlay: string;
};

export type ThemeDefinition = {
  id: ThemeId;
  name: string;
  mode: 'dark' | 'light';
  colors: ThemeColors;
};

export const THEMES: ThemeDefinition[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    colors: {
      bg: '#0A0A0B',
      surface: '#141416',
      surfaceRaised: '#1D1D20',
      border: '#26262A',
      text: '#F5F5F6',
      textDim: '#A1A1A8',
      textMuted: '#63636B',
      overlay: 'rgba(0,0,0,0.6)',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    mode: 'dark',
    colors: {
      bg: '#0E1013',
      surface: '#171A1F',
      surfaceRaised: '#20242B',
      border: '#2A2F37',
      text: '#F1F4F8',
      textDim: '#9BA5B4',
      textMuted: '#5E6877',
      overlay: 'rgba(3,6,10,0.65)',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'dark',
    colors: {
      bg: '#0A100C',
      surface: '#121A15',
      surfaceRaised: '#1A261E',
      border: '#25352B',
      text: '#EEF6F0',
      textDim: '#97AB9D',
      textMuted: '#5B6F61',
      overlay: 'rgba(2,8,4,0.65)',
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    mode: 'dark',
    colors: {
      bg: '#0D0B14',
      surface: '#161320',
      surfaceRaised: '#201C2E',
      border: '#2D2840',
      text: '#F3F0FA',
      textDim: '#A59FBA',
      textMuted: '#675F80',
      overlay: 'rgba(6,3,12,0.65)',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    mode: 'light',
    colors: {
      bg: '#F6F4EF',
      surface: '#FFFFFF',
      surfaceRaised: '#EFECE4',
      border: '#E2DED3',
      text: '#16151A',
      textDim: '#5C5A63',
      textMuted: '#9A978F',
      overlay: 'rgba(22,21,26,0.4)',
    },
  },
  {
    id: 'daylight',
    name: 'Daylight',
    mode: 'light',
    colors: {
      bg: '#F3F6F9',
      surface: '#FFFFFF',
      surfaceRaised: '#E9EEF4',
      border: '#DCE3EB',
      text: '#0F1720',
      textDim: '#52606F',
      textMuted: '#93A0AE',
      overlay: 'rgba(15,23,32,0.4)',
    },
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<
  ThemeId,
  ThemeDefinition
>;

export type AccentOption = { id: string; name: string; color: string };

export const ACCENTS: AccentOption[] = [
  { id: 'volt', name: 'Volt', color: '#C8F031' },
  { id: 'ember', name: 'Ember', color: '#FF6B35' },
  { id: 'sky', name: 'Sky', color: '#38BDF8' },
  { id: 'violet', name: 'Violet', color: '#8B7CFF' },
  { id: 'rose', name: 'Rose', color: '#FF5C8A' },
  { id: 'mint', name: 'Mint', color: '#2DD4A8' },
  { id: 'gold', name: 'Gold', color: '#FFC233' },
  { id: 'mono', name: 'Mono', color: '#E8E8EA' },
];

export const DEFAULT_ACCENT = ACCENTS[0].color;

// Workout kinds and intensity zones use fixed hues so a tempo run looks like a tempo run
// regardless of the user's theme or accent.
export const KIND_COLORS = {
  easy: '#34D399',
  recovery: '#5EEAD4',
  long: '#60A5FA',
  tempo: '#FBBF24',
  intervals: '#F87171',
  strength: '#A78BFA',
  race: '#F472B6',
  rest: '#6B7280',
} as const;

export const ZONE_COLORS = {
  recovery: '#7DD3FC',
  easy: '#34D399',
  steady: '#A3E635',
  tempo: '#FBBF24',
  threshold: '#FB923C',
  interval: '#F87171',
} as const;

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Darken (or lighten) an accent until it reads as text on the given background. */
export function readableOn(color: string, bg: string, min = 3.2): string {
  if (contrastRatio(color, bg) >= min) return color;
  const target = luminance(bg) > 0.5 ? '#000000' : '#FFFFFF';
  for (let t = 0.1; t <= 1; t += 0.1) {
    const next = mix(color, target, t);
    if (contrastRatio(next, bg) >= min) return next;
  }
  return target;
}

export function isValidHex(value: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

export function normalizeHex(value: string): string {
  const v = value.trim().replace('#', '');
  const full =
    v.length === 3
      ? v
          .split('')
          .map((c) => c + c)
          .join('')
      : v;
  return `#${full.toUpperCase()}`;
}
