import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type {
  Activity,
  Adherence,
  IntegrationsState,
  WorkoutActual,
  WorkoutSummary,
} from '@askesis/api-client';
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

/**
 * Activity reads derive from synced data and the athlete's link decisions. After any connect,
 * sync or disconnect attempt, successful or not (a failed sync can still mark the connection
 * for reauthorization, or have committed summaries before failing on laps), the connection state
 * and activity reads refresh. Without a connection, cached activity reads are dropped so deleted
 * data never stays on screen.
 */
export function useRefreshActivities() {
  const client = useQueryClient();
  return async (state?: IntegrationsState) => {
    if (state) client.setQueryData(['integrations'], state);
    else await client.invalidateQueries({ queryKey: ['integrations'] });
    if (client.getQueryData<IntegrationsState>(['integrations'])?.strava.connection)
      await client.invalidateQueries({ queryKey: ['adherence'] });
    else client.removeQueries({ queryKey: ['adherence'] });
  };
}

export function useStravaSync() {
  const refresh = useRefreshActivities();
  return useMutation({
    mutationKey: ['strava-sync'],
    mutationFn: async () => result(await api.POST('/api/v1/integrations/strava/sync')),
    onSettled: (sync) => refresh(sync?.integrations),
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
    onSettled: (state) => refresh(state),
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

/** Keyed by the version's edit like the prescription it is compared with, so edits refetch it. */
const actualKey = (
  workoutId: string | null | undefined,
  version: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined,
) => ['adherence', 'workout', workoutId, ...versionKey(version)];

export function useWorkoutActual(
  workoutId: string | null | undefined,
  version: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined,
  enabled = true,
) {
  return useQuery<WorkoutActual>({
    queryKey: actualKey(workoutId, version),
    enabled: !!workoutId && enabled,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/workouts/{workoutId}/actual', {
          params: { path: { workoutId: workoutId! } },
        }),
      ),
  });
}

export function useActivityDecision(
  workoutId: string,
  version: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined,
) {
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
      client.setQueryData(actualKey(workoutId, version), actual);
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

export type Volume = { sessions: number; seconds: number; metres: number };
export type RangeAdherence = {
  planned: Volume;
  /** Workouts dated before today, plus later ones already done early. */
  due: Volume;
  /** Linked workouts plus extra activities in the plan's sports. */
  actual: Volume;
  completed: number;
  partial: number;
  missed: number;
  extra: number;
};

/**
 * Planned versus actual over the dates on screen (a Monday–Sunday week), whichever training
 * weeks the plan stores. Linked activities count with their workout; extras on their own date.
 */
export function rangeAdherence(
  view: AdherenceView,
  workouts: WorkoutSummary[],
  start: string,
  end: string,
  today: string,
): RangeAdherence | null {
  if (!view.connected || !view.data) return null;
  const empty = (): Volume => ({ sessions: 0, seconds: 0, metres: 0 });
  const add = (volume: Volume, seconds: number, metres: number) => {
    volume.sessions += 1;
    volume.seconds += seconds;
    volume.metres += metres;
  };
  const range: RangeAdherence = {
    planned: empty(),
    due: empty(),
    actual: empty(),
    completed: 0,
    partial: 0,
    missed: 0,
    extra: 0,
  };
  for (const workout of workouts) {
    if (workout.scheduledDate < start || workout.scheduledDate > end) continue;
    const outcome = view.outcomes.get(workout.id);
    const seconds = workout.estimatedDurationSeconds ?? 0;
    const metres = workout.estimatedDistanceMetres ?? 0;
    const linked = !!outcome?.activityIds.length;
    add(range.planned, seconds, metres);
    if (workout.scheduledDate < today || linked) add(range.due, seconds, metres);
    if (outcome && linked) add(range.actual, outcome.actualSeconds, outcome.actualMetres);
    if (outcome?.status === 'completed') range.completed += 1;
    if (outcome?.status === 'partial') range.partial += 1;
    if (outcome?.status === 'missed') range.missed += 1;
  }
  for (const extra of view.data.extra) {
    const date = view.activities.get(extra.activityId)?.date;
    if (!date || date < start || date > end) continue;
    range.extra += 1;
    if (extra.countsTowardPlan) add(range.actual, extra.seconds, extra.metres);
  }
  return range;
}
