import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const CLERK_PUBLISHABLE_KEY: string =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  (Constants.expoConfig?.extra?.clerkPublishableKey as string | undefined) ||
  '';

/**
 * Where the API lives. A deployed API is set with EXPO_PUBLIC_API_URL. In development the app
 * calls its own Metro server, which proxies `/api` to the local API (see metro.config.js), so a
 * phone on the same network (or a tunnel) needs no extra address.
 */
export function apiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (Platform.OS === 'web') return '';
  const host = Constants.expoConfig?.hostUri;
  if (!host) return 'http://localhost:8081';
  // A LAN address names Metro's port; a tunnel (`*.exp.direct`) has none and is served over HTTPS.
  return /:\d+$/.test(host) ? `http://${host}` : `https://${host}`;
}
