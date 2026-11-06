import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { components } from '../lib/api-types';
import { api } from '../lib/api';
import { result } from '../lib/result';

// Ported from apps/web/src/activity-data.ts; keep the two in step.

export type IntegrationsState = components['schemas']['IntegrationsState'];
export type ActivityLink = components['schemas']['ActivityLink'];
export type ActivitySummary = components['schemas']['ActivitySummary'];
export type ActivityDetail = components['schemas']['ActivityDetail'];

/** Strava returns here; the API only accepts this path. */
export const STRAVA_CALLBACK_PATH = '/connections/strava/callback';
/**
 * Activity details come live from Strava each time and are never stored by Waddle. The app
 * keeps them only while they're on screen and for a few minutes afterwards.
 */
const STRAVA_STALE_MS = 5 * 60 * 1000;

/**
 * Where Strava sends the athlete back. The web build uses its own origin, as the web app does.
 * Native builds use the app's scheme with the web app's host, because Strava checks the host
 * against the application's callback domain (localhost always passes). Set
 * EXPO_PUBLIC_STRAVA_CALLBACK_HOST to the deployed web host for release builds. Expo Go opens
 * `exp://` links only, so connecting needs a development or release build.
 */
export function stravaRedirectUri(): string {
  if (Platform.OS === 'web') return `${window.location.origin}${STRAVA_CALLBACK_PATH}`;
  const scheme = (Constants.expoConfig?.scheme as string | undefined) ?? 'waddle';
  const host = process.env.EXPO_PUBLIC_STRAVA_CALLBACK_HOST || 'localhost';
  return `${scheme}://${host}${STRAVA_CALLBACK_PATH}`;
}

export function useIntegrations() {
  return useQuery<IntegrationsState>({
    queryKey: ['integrations'],
    queryFn: async () => result(await api.GET('/api/v1/integrations')),
  });
}

/** Connected and usable; a revoked grant needs reconnecting before anything can be read. */
export function useStravaReady() {
  const connection = useIntegrations().data?.strava.connection;
  return { connected: !!connection, active: connection?.status === 'active' };
}

/**
 * After a connect or disconnect attempt the connection state refreshes. Without a connection,
 * Strava reads and links are dropped so nothing from a revoked account stays on screen.
 */
export function useRefreshIntegrations() {
  const client = useQueryClient();
  return async (state?: IntegrationsState | null) => {
    if (state) client.setQueryData(['integrations'], state);
    else await client.invalidateQueries({ queryKey: ['integrations'] });
    const connected = !!client.getQueryData<IntegrationsState>(['integrations'])?.strava.connection;
    for (const queryKey of [['strava'], ['activity-links']])
      if (connected) await client.invalidateQueries({ queryKey });
      else client.removeQueries({ queryKey });
  };
}

/** Strava codes are single-use: the auth session and a deep link must not both spend one. */
const attempted = new Set<string>();

export type StravaReturn = { code?: string; state?: string; scope?: string; error?: string };

/** Finishes a connection from Strava's return parameters; null when nothing is left to do. */
export async function completeStravaConnection(
  params: StravaReturn,
): Promise<IntegrationsState | null> {
  if (params.error === 'access_denied') throw new Error('Strava wasn’t connected.');
  if (!params.code) throw new Error('Strava didn’t return a connection. Try again.');
  if (attempted.has(params.code)) return null;
  attempted.add(params.code);
  return result(
    await api.POST('/api/v1/integrations/strava/connect', {
      body: { code: params.code, state: params.state ?? '', scope: params.scope ?? '' },
    }),
  );
}

function returnParams(url: string): StravaReturn {
  const query = Linking.parse(url).queryParams ?? {};
  const read = (name: string) => {
    const value = query[name];
    return typeof value === 'string' ? value : undefined;
  };
  return { code: read('code'), state: read('state'), scope: read('scope'), error: read('error') };
}

/**
 * Connect (or reconnect) Strava. Native builds open Strava in an in-app browser and finish when
 * it returns to the app; the web build leaves for Strava and finishes on the callback route.
 * Resolves to null when the athlete closes the browser without connecting.
 */
export function useConnectStrava() {
  const refresh = useRefreshIntegrations();
  return useMutation({
    mutationFn: async (): Promise<IntegrationsState | null> => {
      const redirectUri = stravaRedirectUri();
      const { url } = result(
        await api.POST('/api/v1/integrations/strava/authorize', { body: { redirectUri } }),
      );
      if (Platform.OS === 'web') {
        window.location.assign(url);
        return null;
      }
      const session = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (session.type !== 'success') return null;
      return completeStravaConnection(returnParams(session.url));
    },
    onSettled: (state) => refresh(state),
  });
}

export function useDisconnectStrava() {
  const refresh = useRefreshIntegrations();
  return useMutation({
    mutationFn: async () => result(await api.DELETE('/api/v1/integrations/strava')),
    onSettled: (state) => refresh(state),
  });
}

/** Like `result`, keeping the API's error code so a revoked grant can be told apart. */
class StravaReadError extends Error {
  constructor(
    message: string,
    public code: string | undefined,
  ) {
    super(message);
  }
}
function read<T>(response: { data?: T; error?: unknown }): T {
  if (response.data !== undefined) return response.data;
  const body = response.error as { error?: { code?: string; message?: string } } | undefined;
  throw new StravaReadError(
    body?.error?.message ?? 'The request failed. Check your connection and try again.',
    body?.error?.code,
  );
}

/** Live Strava reads; a revoked grant refreshes the connection so You offers Reconnect. */
function useStravaRead<T>(key: unknown[], enabled: boolean, fetch: () => Promise<T>) {
  const { active } = useStravaReady();
  const client = useQueryClient();
  return useQuery<T>({
    queryKey: ['strava', ...key],
    enabled: enabled && active,
    staleTime: STRAVA_STALE_MS,
    gcTime: STRAVA_STALE_MS,
    retry: false,
    queryFn: async () => {
      try {
        return await fetch();
      } catch (error) {
        if (error instanceof StravaReadError && error.code === 'STRAVA_REAUTHORIZATION_REQUIRED')
          void client.invalidateQueries({ queryKey: ['integrations'] });
        throw error;
      }
    },
  });
}

export function useStravaActivities(around: string, enabled = true) {
  return useStravaRead(['activities', around], enabled, async () =>
    read(
      await api.GET('/api/v1/integrations/strava/activities', { params: { query: { around } } }),
    ),
  );
}

export function useStravaActivity(activityId: string | null | undefined, enabled = true) {
  return useStravaRead(['activity', activityId], !!activityId && enabled, async () =>
    read(
      await api.GET('/api/v1/integrations/strava/activities/{activityId}', {
        params: { path: { activityId: activityId! } },
      }),
    ),
  );
}

/** The athlete's links for a plan: identifiers only, so this is cheap and always available. */
export function useActivityLinks(planId: string | null | undefined) {
  const { connected } = useStravaReady();
  return useQuery<{ links: ActivityLink[] }>({
    queryKey: ['activity-links', planId],
    enabled: !!planId && connected,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/plans/{planId}/activity-links', {
          params: { path: { planId: planId! } },
        }),
      ),
  });
}

export function useActivityLink(planId: string, lineageId: string) {
  return useActivityLinks(planId).data?.links.find((link) => link.lineageId === lineageId);
}

export function useLinkActivity(planId: string, lineageId: string) {
  const client = useQueryClient();
  const params = { path: { planId, lineageId } };
  const settle = (data: { links: ActivityLink[] }) =>
    client.setQueryData(['activity-links', planId], data);
  return {
    link: useMutation({
      mutationFn: async (activityId: string) =>
        result(
          await api.PUT('/api/v1/plans/{planId}/workouts/{lineageId}/activity-link', {
            params,
            body: { provider: 'strava', activityId },
          }),
        ),
      onSuccess: settle,
    }),
    unlink: useMutation({
      mutationFn: async () =>
        result(
          await api.DELETE('/api/v1/plans/{planId}/workouts/{lineageId}/activity-link', {
            params,
          }),
        ),
      onSuccess: settle,
    }),
  };
}
