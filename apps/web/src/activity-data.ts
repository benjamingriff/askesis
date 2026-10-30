import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityLink, IntegrationsState } from '@askesis/api-client';
import { api } from './api';
import { result } from './lib/result';

/** Strava returns here; the API only accepts this path on the app's own origins. */
export const STRAVA_CALLBACK_PATH = '/connections/strava/callback';
/**
 * Activity details come live from Strava each time and are never stored by Askesis. The
 * browser keeps them only while they're on screen and for a few minutes afterwards.
 */
const STRAVA_STALE_MS = 5 * 60 * 1000;

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
  return async (state?: IntegrationsState) => {
    if (state) client.setQueryData(['integrations'], state);
    else await client.invalidateQueries({ queryKey: ['integrations'] });
    const connected = !!client.getQueryData<IntegrationsState>(['integrations'])?.strava.connection;
    for (const queryKey of [['strava'], ['activity-links']])
      if (connected) await client.invalidateQueries({ queryKey });
      else client.removeQueries({ queryKey });
  };
}

export function useConnectStrava() {
  return useMutation({
    mutationFn: async () => {
      const { url } = result(
        await api.POST('/api/v1/integrations/strava/authorize', {
          body: { redirectUri: `${window.location.origin}${STRAVA_CALLBACK_PATH}` },
        }),
      );
      window.location.assign(url);
    },
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

/** Live Strava reads; a revoked grant refreshes the connection so Settings offers Reconnect. */
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
