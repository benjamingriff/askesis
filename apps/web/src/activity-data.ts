import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { Activity, Adherence, IntegrationsState, WorkoutActual } from '@askesis/api-client';
import { api } from './api';
import { result } from './lib/result';
import { versionKey, type PlanVersion } from './plan-data';

/** Strava returns here; the API only accepts this path on the app's own origins. */
export const STRAVA_CALLBACK_PATH = '/connections/strava/callback';
/** Opening the app refreshes activities at most this often. */
const AUTO_SYNC_AFTER_MS = 30 * 60 * 1000;

export function useIntegrations() {
  return useQuery<IntegrationsState>({
    queryKey: ['integrations'],
    queryFn: async () => result(await api.GET('/api/v1/integrations')),
  });
}

/** Activity reads are derived from synced data and the athlete's link decisions. */
function useRefreshActivities() {
  const client = useQueryClient();
  return async (state?: IntegrationsState) => {
    if (state) client.setQueryData(['integrations'], state);
    await client.invalidateQueries({ queryKey: ['adherence'] });
  };
}

export function useStravaSync() {
  const refresh = useRefreshActivities();
  return useMutation({
    mutationKey: ['strava-sync'],
    mutationFn: async () => result(await api.POST('/api/v1/integrations/strava/sync')),
    onSuccess: (sync) => refresh(sync.integrations),
  });
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
  const refresh = useRefreshActivities();
  return useMutation({
    mutationFn: async () => result(await api.DELETE('/api/v1/integrations/strava')),
    onSuccess: (state) => refresh(state),
  });
}

/** Sync quietly once per visit when the last sync is older than half an hour. */
export function useAutoSync() {
  const integrations = useIntegrations().data;
  const sync = useStravaSync();
  const started = useRef(false);
  const connection = integrations?.strava.connection;
  useEffect(() => {
    if (started.current || !connection || connection.status !== 'active' || connection.syncing)
      return;
    const last = connection.lastSyncedAt ? Date.parse(connection.lastSyncedAt) : 0;
    if (Date.now() - last < AUTO_SYNC_AFTER_MS) return;
    started.current = true;
    sync.mutate();
  }, [connection, sync]);
}

/** Planned versus actual for the version on screen, once an activity source is connected. */
export function useAdherence(version: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined) {
  const connected = !!useIntegrations().data?.strava.connection;
  return useQuery<Adherence>({
    queryKey: ['adherence', 'plan', ...versionKey(version)],
    enabled: !!version && connected,
    placeholderData: (previous, query) =>
      query?.queryKey.at(-2) === version?.id ? previous : undefined,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/adherence', { params: { query: { planVersionId: version!.id } } }),
      ),
  });
}

export function useWorkoutActual(workoutId: string | null | undefined, enabled = true) {
  return useQuery<WorkoutActual>({
    queryKey: ['adherence', 'workout', workoutId],
    enabled: !!workoutId && enabled,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/workouts/{workoutId}/actual', {
          params: { path: { workoutId: workoutId! } },
        }),
      ),
  });
}

export function useActivityDecision(workoutId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { activityId: string; decision: 'link' | 'reject' }) =>
      result(
        await api.POST('/api/v1/workouts/{workoutId}/activity-links', {
          params: { path: { workoutId } },
          body: input,
        }),
      ),
    onSuccess: async (actual) => {
      client.setQueryData(['adherence', 'workout', workoutId], actual);
      await client.invalidateQueries({ queryKey: ['adherence'] });
    },
  });
}

export type Outcome = Adherence['workouts'][number];
export type AdherenceView = {
  connected: boolean;
  outcomes: Map<string, Outcome>;
  activities: Map<string, Activity>;
  data: Adherence | undefined;
};

const emptyView: AdherenceView = {
  connected: false,
  outcomes: new Map(),
  activities: new Map(),
  data: undefined,
};

/** The schedule's outcomes, shared with workout cards without prop drilling. */
export const AdherenceContext = createContext<AdherenceView>(emptyView);

export function useAdherenceView(data: Adherence | undefined): AdherenceView {
  return useMemo(
    () =>
      data
        ? {
            connected: data.connected,
            outcomes: new Map(data.workouts.map((outcome) => [outcome.workoutId, outcome])),
            activities: new Map(data.activities.map((activity) => [activity.id, activity])),
            data,
          }
        : emptyView,
    [data],
  );
}

export function useOutcome(workoutId: string): Outcome | undefined {
  const view = useContext(AdherenceContext);
  return view.connected ? view.outcomes.get(workoutId) : undefined;
}
