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
  alpha,
  DEFAULT_ACCENT,
  isValidHex,
  luminance,
  normalizeHex,
  readableOn,
  STATUS_COLORS,
  THEME_BY_ID,
  type ThemeColors,
  type ThemeId,
} from './theme/palette';
import { readStorage, writeStorage } from './lib/storage';

export type ThemeMode = 'system' | 'dark' | 'light';
/** `plan` follows the unit chosen in each plan's brief. */
export type UnitPreference = 'plan' | 'km' | 'mi';
export type Units = 'km' | 'mi';

export type Settings = {
  mode: ThemeMode;
  darkTheme: ThemeId;
  lightTheme: ThemeId;
  accent: string;
  units: UnitPreference;
  showActivity: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: 'dark',
  darkTheme: 'midnight',
  lightTheme: 'paper',
  accent: DEFAULT_ACCENT,
  units: 'plan',
  showActivity: true,
};

const STORAGE_KEY = 'askesis.settings.v1';

export type Theme = {
  isDark: boolean;
  themeId: ThemeId;
  colors: ThemeColors;
  accent: string;
  /** Text/icon colour placed on a solid accent fill. */
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
  const accent = settings.accent;
  return {
    isDark: def.mode === 'dark',
    themeId,
    colors: def.colors,
    accent,
    onAccent: luminance(accent) > 0.38 ? '#0A0A0B' : '#FFFFFF',
    accentText: readableOn(accent, def.colors.bg),
    accentSoft: alpha(accent, def.mode === 'dark' ? 0.14 : 0.16),
    accentBorder: alpha(accent, def.mode === 'dark' ? 0.35 : 0.5),
  };
}

function readSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(readStorage(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
    const value = raw as Partial<Settings>;
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
      accent:
        typeof value.accent === 'string' && isValidHex(value.accent)
          ? normalizeHex(value.accent)
          : DEFAULT_SETTINGS.accent,
      units: ['plan', 'km', 'mi'].includes(value.units as string)
        ? (value.units as UnitPreference)
        : DEFAULT_SETTINGS.units,
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
    '--on-accent': theme.onAccent,
    '--accent-text': theme.accentText,
    '--accent-soft': theme.accentSoft,
    '--accent-border': theme.accentBorder,
    '--locked': readableOn(STATUS_COLORS.locked, c.bg),
    '--locked-soft': alpha(STATUS_COLORS.locked, 0.14),
    '--locked-border': alpha(STATUS_COLORS.locked, 0.35),
    '--warning': readableOn(STATUS_COLORS.warning, c.bg),
    '--warning-soft': alpha(STATUS_COLORS.warning, 0.14),
    '--danger': readableOn(STATUS_COLORS.danger, c.bg),
    '--danger-soft': alpha(STATUS_COLORS.danger, 0.14),
  };
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

  useEffect(() => writeStorage(STORAGE_KEY, JSON.stringify(settings)), [settings]);

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

/** Display units: the user's override, otherwise the plan brief's unit, otherwise kilometres. */
export function useUnits(planUnit?: 'kilometres' | 'miles' | null): Units {
  const { settings } = useSettings();
  if (settings.units !== 'plan') return settings.units;
  return planUnit === 'miles' ? 'mi' : 'km';
}
