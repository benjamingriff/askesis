// Shared with the mobile prototype (apps/mobile/src/theme/palette.ts) so both clients read as one
// product. Keep the theme, accent and effort values in step when either side changes.

import type { BlockPhase } from '@askesis/api-client';

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
      textMuted: '#7A7A83',
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
      textMuted: '#768192',
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
      textMuted: '#728A7A',
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
      textMuted: '#80799A',
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
      textMuted: '#76736B',
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
      textMuted: '#6A7787',
      overlay: 'rgba(15,23,32,0.4)',
    },
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<
  ThemeId,
  ThemeDefinition
>;

// ---- Effort ---------------------------------------------------------------------------------
//
// Colour in workout data means one thing: how hard. Every zone system (run paces, cycling power,
// swim paces) and strength's RPE and reps in reserve land on the same six steps, so a hard ride and
// a hard run look equally warm. Cool steps are aerobic and easy; warm steps are quality work.
// Sport is shown with icons, never colour. Light themes use deeper shades so the warm steps still
// read on a pale page.

export const EFFORTS = ['recovery', 'easy', 'steady', 'threshold', 'hard', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export const EFFORT_META: Record<Effort, { label: string; dark: string; light: string }> = {
  recovery: { label: 'Recovery', dark: '#94A3B8', light: '#64748B' },
  easy: { label: 'Easy', dark: '#38BDF8', light: '#0284C7' },
  steady: { label: 'Steady', dark: '#2DD4BF', light: '#0D9488' },
  threshold: { label: 'Threshold', dark: '#FBBF24', light: '#CA8A04' },
  hard: { label: 'Hard', dark: '#FB8A3C', light: '#EA580C' },
  max: { label: 'Max', dark: '#F43F5E', light: '#E11D48' },
};

/** The theme-aware colour for an effort step, as a CSS value. */
export function effortColor(effort: Effort): string {
  return `var(--effort-${effort})`;
}

/** Each zone key, from every system, on the shared effort scale. */
export const ZONE_EFFORT: Record<string, Effort> = {
  recovery: 'recovery',
  easy: 'easy',
  endurance: 'easy',
  marathon: 'steady',
  tempo: 'steady',
  sweet_spot: 'threshold',
  threshold: 'threshold',
  interval: 'hard',
  vo2max: 'hard',
  speed: 'max',
  repetition: 'max',
  anaerobic: 'max',
};

export function zoneEffort(key: string | null | undefined): Effort {
  return (key && ZONE_EFFORT[key]) || 'easy';
}

// ---- Phases -----------------------------------------------------------------------------------
//
// A training phase takes the colour of the effort that defines it: base is easy aerobic volume,
// build is threshold work, peak is the hardest race-specific training, taper keeps some quality
// while volume falls, and recovery is recovery. Phases only colour whole blocks and weeks (the
// timeline, the week chart and labelled pills), never a single workout, so the shared hue reads
// as "this block is about that effort" rather than as a session.

export const PHASE_EFFORT: Record<BlockPhase, Effort> = {
  base: 'easy',
  build: 'threshold',
  peak: 'hard',
  taper: 'steady',
  recovery: 'recovery',
};

/** The theme-aware colour for a phase, or a neutral one for blocks written before phases. */
export function phaseColor(phase: BlockPhase | null | undefined): string {
  return phase ? effortColor(PHASE_EFFORT[phase]) : 'var(--text-muted)';
}

export const STATUS_COLORS = {
  locked: '#22C55E',
  warning: '#FBBF24',
  danger: '#F87171',
} as const;

// ---- Accent -----------------------------------------------------------------------------------
//
// The accent is the app's own colour: buttons, selection, the active tab, "today". It never
// carries data, so every option sits in hues the effort scale leaves free (lime, violet, magenta)
// or is neutral. Blends are two-tone gradients for fills; their midpoint stands in wherever a
// single colour is needed (rings, borders, text).

export type AccentOption = {
  id: string;
  name: string;
  /** Solid accents have one stop; blends have two. */
  stops: [string] | [string, string];
  /** Accents that follow the theme instead of a fixed colour. */
  adaptive?: { dark: string; light: string };
};

export const ACCENTS: AccentOption[] = [
  { id: 'volt', name: 'Volt', stops: ['#C8F031'] },
  { id: 'iris', name: 'Iris', stops: ['#8B7CFF'] },
  { id: 'orchid', name: 'Orchid', stops: ['#D774F2'] },
  {
    id: 'mono',
    name: 'Mono',
    stops: ['#E8E8EA'],
    adaptive: { dark: '#ECECEE', light: '#1A191F' },
  },
  { id: 'acid', name: 'Acid', stops: ['#E4FA5B', '#8EE36A'] },
  { id: 'nebula', name: 'Nebula', stops: ['#8B7CFF', '#E879F9'] },
  { id: 'ultraviolet', name: 'Ultraviolet', stops: ['#6E6BFA', '#B062F5'] },
  { id: 'blossom', name: 'Blossom', stops: ['#C77DFF', '#F78FD8'] },
];

export const ACCENT_BY_ID = Object.fromEntries(ACCENTS.map((a) => [a.id, a])) as Record<
  string,
  AccentOption
>;

export const DEFAULT_ACCENT = 'volt';

/**
 * Earlier presets that shared a hue with workout data, mapped to the closest remaining accent so a
 * saved preference still looks deliberate.
 */
export const RETIRED_ACCENTS: Record<string, string> = {
  '#C8F031': 'volt',
  '#FF6B35': 'blossom',
  '#38BDF8': 'ultraviolet',
  '#8B7CFF': 'iris',
  '#FF5C8A': 'blossom',
  '#2DD4A8': 'acid',
  '#FFC233': 'acid',
  '#E8E8EA': 'mono',
};

/** The colour stops for an accent preference: a preset id or a custom hex. */
export function accentStops(accent: string, mode: 'dark' | 'light'): string[] {
  const preset = ACCENT_BY_ID[accent];
  if (!preset) return [normalizeHex(accent)];
  if (preset.adaptive) return [preset.adaptive[mode]];
  return preset.stops;
}

/** A CSS fill for an accent: a gradient for blends, a flat colour otherwise. */
export function accentFill(stops: string[]): string {
  return stops.length > 1 ? `linear-gradient(135deg, ${stops.join(', ')})` : stops[0]!;
}

// ---- Perceptual distance ----------------------------------------------------------------------

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** OKLab coordinates, where straight-line distance tracks how different two colours look. */
export function oklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function colorDistance(a: string, b: string): number {
  const [al, aa, ab] = oklab(a);
  const [bl, ba, bb] = oklab(b);
  return Math.hypot(al - bl, aa - ba, ab - bb);
}

/** Below this OKLab distance two colours are easily mistaken for each other at a glance. */
export const CLASH_DISTANCE = 0.1;

/** The effort step a custom accent would be confused with, if any. */
export function accentClash(hex: string): Effort | null {
  if (!isValidHex(hex)) return null;
  const color = normalizeHex(hex);
  let nearest: { effort: Effort; distance: number } | null = null;
  for (const effort of EFFORTS) {
    for (const shade of [EFFORT_META[effort].dark, EFFORT_META[effort].light]) {
      const distance = colorDistance(color, shade);
      if (!nearest || distance < nearest.distance) nearest = { effort, distance };
    }
  }
  return nearest && nearest.distance < CLASH_DISTANCE ? nearest.effort : null;
}

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
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ink or white for content on a fill: whichever keeps more contrast at the fill's weakest stop. */
export function onFill(stops: string[]): string {
  const worst = (ink: string) => Math.min(...stops.map((stop) => contrastRatio(ink, stop)));
  return worst('#0A0A0B') >= worst('#FFFFFF') ? '#0A0A0B' : '#FFFFFF';
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
export function readableOn(color: string, bg: string, min = 4.5): string {
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
