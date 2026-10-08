import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ACCENT_BY_ID,
  accentFill,
  accentStops,
  alpha,
  DEFAULT_ACCENT,
  EFFORT_META,
  EFFORTS,
  isValidHex,
  onFill,
  mix,
  normalizeHex,
  readableOn,
  RETIRED_ACCENTS,
  STATUS_COLORS,
  THEME_BY_ID,
  type ThemeColors,
  type ThemeId,
} from './theme/palette';
import { readStorage, writeStorage } from './lib/storage';
import type { LoadUnits, PoolUnits } from './lib/format';

export type ThemeMode = 'system' | 'dark' | 'light';
/** `plan` follows the unit chosen in each plan's brief. */
export type UnitPreference = 'plan' | 'km' | 'mi';
export type Units = 'km' | 'mi';
export type { LoadUnits, PoolUnits } from './lib/format';

export type Settings = {
  mode: ThemeMode;
  darkTheme: ThemeId;
  lightTheme: ThemeId;
  /** A preset accent id (see ACCENTS) or a custom hex colour. */
  accent: string;
  units: UnitPreference;
  /** Swim paces and distances: per 100 metres or per 100 yards. */
  pool: PoolUnits;
  /** Suggested strength loads. */
  load: LoadUnits;
  showActivity: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: 'dark',
  darkTheme: 'midnight',
  lightTheme: 'paper',
  accent: DEFAULT_ACCENT,
  units: 'plan',
  pool: 'm',
  load: 'kg',
  showActivity: true,
};

const STORAGE_KEY = 'askesis.settings.v1';
/** Saved settings without this version predate accent presets: their accent is always a hex. */
const SETTINGS_VERSION = 2;

export type Theme = {
  isDark: boolean;
  themeId: ThemeId;
  colors: ThemeColors;
  /** The accent as one colour: a blend's midpoint. Used for rings, borders and outlines. */
  accent: string;
  /** Background for accent-filled controls: a gradient for blends. */
  accentFill: string;
  /** The accent's stops, so a blend can wash the page backdrop with both ends. */
  accentStops: string[];
  /** Text/icon colour placed on an accent fill. */
  onAccent: string;
  /** Accent adjusted so it stays legible as text on the page background. */
  accentText: string;
  accentSoft: string;
  accentBorder: string;
};

export function buildTheme(settings: Settings, systemScheme: 'light' | 'dark'): Theme {
  const effective = settings.mode === 'system' ? systemScheme : settings.mode;
  const themeId = effective === 'dark' ? settings.darkTheme : settings.lightTheme;
  const def = THEME_BY_ID[themeId];
  const stops = accentStops(settings.accent, def.mode);
  const accent = stops.length > 1 ? mix(stops[0]!, stops[1]!, 0.5) : stops[0]!;
  return {
    isDark: def.mode === 'dark',
    themeId,
    colors: def.colors,
    accent,
    accentFill: accentFill(stops),
    accentStops: stops,
    onAccent: onFill(stops),
    accentText: readableOn(accent, def.colors.bg),
    accentSoft: alpha(accent, def.mode === 'dark' ? 0.14 : 0.16),
    accentBorder: alpha(accent, def.mode === 'dark' ? 0.35 : 0.5),
  };
}

/**
 * A saved accent as a preset id or custom hex. Retired presets in legacy settings move to their
 * closest successor; a custom hex saved since then is kept even when it matches one.
 */
export function readAccent(value: unknown, legacy = false): string {
  if (typeof value !== 'string') return DEFAULT_ACCENT;
  if (ACCENT_BY_ID[value]) return value;
  if (!isValidHex(value)) return DEFAULT_ACCENT;
  const hex = normalizeHex(value);
  return (legacy && RETIRED_ACCENTS[hex]) || hex;
}

function readSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(readStorage(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
    const value = raw as Partial<Settings> & { version?: unknown };
    return {
      mode: ['system', 'dark', 'light'].includes(value.mode as string)
        ? (value.mode as ThemeMode)
        : DEFAULT_SETTINGS.mode,
      darkTheme:
        value.darkTheme && THEME_BY_ID[value.darkTheme]?.mode === 'dark'
          ? value.darkTheme
          : DEFAULT_SETTINGS.darkTheme,
      lightTheme:
        value.lightTheme && THEME_BY_ID[value.lightTheme]?.mode === 'light'
          ? value.lightTheme
          : DEFAULT_SETTINGS.lightTheme,
      accent: readAccent(value.accent, value.version !== SETTINGS_VERSION),
      units: ['plan', 'km', 'mi'].includes(value.units as string)
        ? (value.units as UnitPreference)
        : DEFAULT_SETTINGS.units,
      pool: value.pool === 'yd' ? 'yd' : 'm',
      load: value.load === 'lb' ? 'lb' : 'kg',
      showActivity:
        typeof value.showActivity === 'boolean'
          ? value.showActivity
          : DEFAULT_SETTINGS.showActivity,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function systemScheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Theme values become CSS custom properties so stylesheets never hard-code colours. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  const c = theme.colors;
  const vars: Record<string, string> = {
    '--bg': c.bg,
    '--surface': c.surface,
    '--surface-raised': c.surfaceRaised,
    '--border': c.border,
    '--text': c.text,
    '--text-dim': c.textDim,
    '--text-muted': c.textMuted,
    '--overlay': c.overlay,
    '--accent': theme.accent,
    '--accent-fill': theme.accentFill,
    '--on-accent': theme.onAccent,
    '--accent-text': theme.accentText,
    '--accent-soft': theme.accentSoft,
    '--accent-border': theme.accentBorder,
    // A faint wash of the accent behind the app, from both ends of a blend.
    '--glow-a': alpha(theme.accentStops[0]!, theme.isDark ? 0.075 : 0.1),
    '--glow-b': alpha(theme.accentStops.at(-1)!, theme.isDark ? 0.055 : 0.08),
    '--locked': readableOn(STATUS_COLORS.locked, c.bg),
    '--locked-soft': alpha(STATUS_COLORS.locked, 0.14),
    '--locked-border': alpha(STATUS_COLORS.locked, 0.35),
    '--warning': readableOn(STATUS_COLORS.warning, c.bg),
    '--warning-soft': alpha(STATUS_COLORS.warning, 0.14),
    '--danger': readableOn(STATUS_COLORS.danger, c.bg),
    '--danger-soft': alpha(STATUS_COLORS.danger, 0.14),
    // Dark themes lift the floating tab bar with a lighter fill and rim; a shadow alone
    // barely shows against a near-black page. The shadow only falls upward so nothing
    // darkens the gap between the pill and the iOS Safari toolbar.
    '--tab-bar-bg': alpha(theme.isDark ? c.surfaceRaised : c.surface, theme.isDark ? 0.78 : 0.72),
    '--tab-bar-border': alpha(c.text, theme.isDark ? 0.16 : 0.12),
    '--tab-bar-active': theme.isDark ? alpha(c.text, 0.1) : c.surfaceRaised,
    '--tab-bar-shadow': theme.isDark
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 -10px 30px -12px rgba(0, 0, 0, 0.6)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 -10px 30px -12px rgba(0, 0, 0, 0.16)',
  };
  for (const effort of EFFORTS)
    vars[`--effort-${effort}`] = EFFORT_META[effort][theme.isDark ? 'dark' : 'light'];
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.style.colorScheme = theme.isDark ? 'dark' : 'light';
  root.dataset.theme = theme.themeId;
}

type SettingsContextValue = {
  settings: Settings;
  theme: Theme;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  theme: buildTheme(DEFAULT_SETTINGS, 'dark'),
  update: () => undefined,
  reset: () => undefined,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(readSettings);
  const [scheme, setScheme] = useState(systemScheme);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!media) return;
    const listener = () => setScheme(systemScheme());
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, []);

  const theme = useMemo(() => buildTheme(settings, scheme), [settings, scheme]);
  useEffect(() => applyTheme(theme), [theme]);

  useEffect(
    () => writeStorage(STORAGE_KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION })),
    [settings],
  );

  const update = useCallback(
    (patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch })),
    [],
  );
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const value = useMemo(
    () => ({ settings, theme, update, reset }),
    [settings, theme, update, reset],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}

export function useTheme() {
  return useContext(SettingsContext).theme;
}

/** Pool and strength-load display units, chosen in settings. */
export function useSportUnits(): { pool: PoolUnits; load: LoadUnits } {
  const { settings } = useSettings();
  return { pool: settings.pool, load: settings.load };
}

/** Display units: the user's override, otherwise the plan brief's unit, otherwise kilometres. */
export function useUnits(planUnit?: 'kilometres' | 'miles' | null): Units {
  const { settings } = useSettings();
  if (settings.units !== 'plan') return settings.units;
  return planUnit === 'miles' ? 'mi' : 'km';
}
