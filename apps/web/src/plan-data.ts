import { useQuery } from '@tanstack/react-query';
import type { paths, WorkoutDetail } from '@askesis/api-client';
import { api } from './api';
import { result } from './lib/result';

export type Plan =
  paths['/api/v1/plans/{planId}']['get']['responses'][200]['content']['application/json'];
export type PlanVersion = NonNullable<Plan['draft']>;
export type BriefState =
  paths['/api/v1/plans/{planId}/draft/brief']['get']['responses'][200]['content']['application/json'];
export type Calibration = BriefState['calibrations'][number];
export type Preview =
  paths['/api/v1/plans/{planId}/validate']['post']['responses'][200]['content']['application/json'];
export type PlanView = 'locked' | 'draft';

export function planVersion(plan: Plan, view: PlanView): PlanVersion | null {
  return view === 'draft' ? (plan.draft ?? plan.locked) : (plan.locked ?? plan.draft);
}

/**
 * Query-key segment for one saved state of a version. Draft edits advance `editNumber`, so any
 * query keyed by it refetches after coach, human or other-session edits.
 */
export function versionKey(version: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined) {
  return [version?.id, version?.editNumber] as const;
}

export type DraftChanges =
  paths['/api/v1/plans/{planId}/draft/changes']['get']['responses'][200]['content']['application/json'];

/** One plan's metadata and current draft/locked identities. Live updates refresh this key. */
export function usePlan(planId: string | null) {
  return useQuery({
    queryKey: ['plans', planId],
    enabled: !!planId,
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}', { params: { path: { planId: planId! } } })),
  });
}

/**
 * Net differences between the current draft and the locked version. Keyed by the draft's edit,
 * so a response for an older edit is never shown against a newer schedule.
 */
export function useDraftChanges(planId: string, draft: PlanVersion | null) {
  const changes = useQuery({
    queryKey: ['plans', planId, 'draft-changes', ...versionKey(draft)],
    enabled: !!draft,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/plans/{planId}/draft/changes', { params: { path: { planId } } }),
      ),
  });
  const current = changes.data && changes.data.editNumber === draft?.editNumber;
  return { ...changes, data: current ? changes.data : undefined };
}

/** The brief, calibrations and prescribed coverage for one version of a plan. */
export function useBriefState(planId: string, version: PlanVersion | null) {
  const draft = version?.state === 'draft';
  return useQuery({
    // A draft is locked in place (same id and editNumber) but read from a different endpoint,
    // so the state is part of the key.
    queryKey: ['plans', planId, 'brief', version?.state, ...versionKey(version)],
    enabled: !!version,
    placeholderData: (previous, query) =>
      query?.queryKey.at(-2) === version?.id ? previous : undefined,
    // Locked versions never change, and draft changes advance editNumber (part of the key).
    refetchOnWindowFocus: false,
    queryFn: async () =>
      draft
        ? result(
            await api.GET('/api/v1/plans/{planId}/draft/brief', { params: { path: { planId } } }),
          )
        : result(
            await api.GET('/api/v1/plans/{planId}/revisions/{revisionId}/brief', {
              params: { path: { planId, revisionId: version!.id } },
            }),
          ),
  });
}

export function useWorkouts(version: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined) {
  return useQuery({
    queryKey: ['plan-workouts', ...versionKey(version)],
    enabled: !!version,
    placeholderData: (previous, query) =>
      query?.queryKey.at(-2) === version?.id ? previous : undefined,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/workouts', { params: { query: { planVersionId: version!.id } } }),
      ).workouts,
  });
}

export function useWorkoutDetail(
  workoutId: string | null | undefined,
  version?: Pick<PlanVersion, 'id' | 'editNumber'> | null,
) {
  return useQuery<WorkoutDetail>({
    // Under 'plan-workouts' so coach edits and calibration updates invalidate resolved paces.
    queryKey: ['plan-workouts', 'detail', workoutId, ...versionKey(version)],
    enabled: !!workoutId,
    staleTime: 60_000,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/workouts/{workoutId}', {
          params: { path: { workoutId: workoutId! } },
        }),
      ),
  });
}

/**
 * Recorded schedule coverage, or `null` when it is unknown (legacy plans). Once generation has been
 * attempted, an empty list is known coverage: nothing is fully prescribed yet.
 */
export function knownCoverage(
  state: Pick<BriefState, 'coverage' | 'generations'>,
): BriefState['coverage'] | null {
  return state.coverage.length || state.generations?.length ? state.coverage : null;
}

export function latestCalibration(state: BriefState | undefined): Calibration | undefined {
  return state?.calibrations.at(-1);
}

export function isEstimate(calibration: Calibration): boolean {
  return (
    calibration.provenance === 'agent_estimate' ||
    calibration.provenance === 'user_estimate' ||
    calibration.method === 'threshold_pace'
  );
}
