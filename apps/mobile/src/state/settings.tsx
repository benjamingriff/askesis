import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import type { LoadUnits, PoolUnits, Units } from '../lib/format';
import {
  ACCENT_BY_ID,
  accentStops,
  alpha,
  DEFAULT_ACCENT,
  EFFORT_META,
  EFFORTS,
  isValidHex,
  mix,
  normalizeHex,
  onFill,
  readableOn,
  RETIRED_ACCENTS,
  STATUS_COLORS,
  THEME_BY_ID,
  type Effort,
  type ThemeColors,
  type ThemeId,
} from '../theme/palette';

export type ThemeMode = 'system' | 'dark' | 'light';
/** `plan` follows the unit chosen in each plan's brief. */
export type UnitPreference = 'plan' | 'km' | 'mi';
export type { LoadUnits, PoolUnits, Units } from '../lib/format';

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
  haptics: boolean;
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
  haptics: true,
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
  /** The accent's stops: blends fill controls with a gradient between them. */
  accentStops: string[];
  /** Text/icon colour placed on an accent fill. */
  onAccent: string;
  /** Accent adjusted so it stays legible as text on the page background. */
  accentText: string;
  accentSoft: string;
  accentBorder: string;
  /** Effort colours for this theme's mode. */
  efforts: Record<Effort, string>;
  locked: string;
  lockedSoft: string;
  lockedBorder: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
};

export function buildTheme(settings: Settings, systemScheme: 'light' | 'dark'): Theme {
  const effective = settings.mode === 'system' ? systemScheme : settings.mode;
  const themeId = effective === 'dark' ? settings.darkTheme : settings.lightTheme;
  const def = THEME_BY_ID[themeId];
  const dark = def.mode === 'dark';
  const stops = accentStops(settings.accent, def.mode);
  const accent = stops.length > 1 ? mix(stops[0]!, stops[1]!, 0.5) : stops[0]!;
  return {
    isDark: dark,
    themeId,
    colors: def.colors,
    accent,
    accentStops: stops,
    onAccent: onFill(stops),
    accentText: readableOn(accent, def.colors.bg),
    // On light backgrounds a bright accent washes out, so its tint is stronger and its outlines
    // use the readable (darker) accent.
    accentSoft: alpha(accent, dark ? 0.14 : 0.3),
    accentBorder: dark ? alpha(accent, 0.35) : alpha(readableOn(accent, def.colors.bg), 0.7),
    efforts: Object.fromEntries(
      EFFORTS.map((effort) => [effort, EFFORT_META[effort][dark ? 'dark' : 'light']]),
    ) as Record<Effort, string>,
    locked: readableOn(STATUS_COLORS.locked, def.colors.bg),
    lockedSoft: alpha(STATUS_COLORS.locked, 0.14),
    lockedBorder: alpha(STATUS_COLORS.locked, 0.35),
    warning: readableOn(STATUS_COLORS.warning, def.colors.bg),
    warningSoft: alpha(STATUS_COLORS.warning, 0.14),
    danger: readableOn(STATUS_COLORS.danger, def.colors.bg),
    dangerSoft: alpha(STATUS_COLORS.danger, 0.14),
  };
}

/** An effort's colour, or the quiet neutral used for rest days and unphased blocks. */
export function effortTint(theme: Theme, effort: Effort | null | undefined): string {
  return effort ? theme.efforts[effort] : theme.colors.textMuted;
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

function readSettings(raw: unknown): Settings {
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
    haptics: typeof value.haptics === 'boolean' ? value.haptics : DEFAULT_SETTINGS.haptics,
    showActivity:
      typeof value.showActivity === 'boolean' ? value.showActivity : DEFAULT_SETTINGS.showActivity,
  };
}

type SettingsContextValue = {
  settings: Settings;
  theme: Theme;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady?: () => void;
}) {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setSettings(readSettings(JSON.parse(raw)));
      })
      .catch(() => undefined)
      .finally(() => {
        setHydrated(true);
        onReady?.();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...settings, version: SETTINGS_VERSION }),
    ).catch(() => undefined);
  }, [settings, hydrated]);

  const update = useCallback(
    (patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch })),
    [],
  );
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const theme = useMemo(() => buildTheme(settings, scheme), [settings, scheme]);
  const value = useMemo(
    () => ({ settings, theme, update, reset }),
    [settings, theme, update, reset],
  );

  if (!hydrated) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}

export function useTheme() {
  return useSettings().theme;
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
