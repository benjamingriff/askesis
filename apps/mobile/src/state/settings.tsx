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
import {
  alpha,
  DEFAULT_ACCENT,
  luminance,
  readableOn,
  THEME_BY_ID,
  type ThemeColors,
  type ThemeId,
} from '../theme/palette';

export type ThemeMode = 'system' | 'dark' | 'light';
export type Units = 'km' | 'mi';

export type Settings = {
  mode: ThemeMode;
  darkTheme: ThemeId;
  lightTheme: ThemeId;
  accent: string;
  units: Units;
  haptics: boolean;
  showActivity: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: 'dark',
  darkTheme: 'midnight',
  lightTheme: 'paper',
  accent: DEFAULT_ACCENT,
  units: 'km',
  haptics: true,
  showActivity: true,
};

const STORAGE_KEY = 'askesis.settings.v1';

export type Theme = {
  isDark: boolean;
  themeId: ThemeId;
  colors: ThemeColors;
  accent: string;
  /** Text/icon colour to place on top of a solid accent fill. */
  onAccent: string;
  /** Accent adjusted so it stays legible as text on the page background. */
  accentText: string;
  accentSoft: string;
  accentBorder: string;
};

type SettingsContextValue = {
  settings: Settings;
  theme: Theme;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

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
    accentSoft: alpha(accent, def.mode === 'dark' ? 0.16 : 0.14),
    accentBorder: alpha(accent, 0.4),
  };
}

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
        if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
      })
      .catch(() => undefined)
      .finally(() => {
        setHydrated(true);
        onReady?.();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((next: Settings) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    persist(DEFAULT_SETTINGS);
  }, [persist]);

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
