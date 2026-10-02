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

/** The brief, calibrations and prescribed coverage for one version of a plan. */
export function useBriefState(planId: string, version: PlanVersion | null) {
  const draft = version?.state === 'draft';
  return useQuery({
    queryKey: [
      'plans',
      planId,
      'brief',
      draft ? undefined : version?.id,
      // Draft coverage and calibration change with the edit, including edits in other sessions.
      ...(draft ? [version.id, version.editNumber] : []),
    ],
    enabled: !!version,
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
    queryKey: ['plan-workouts', version?.id, version?.editNumber],
    enabled: !!version,
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
    queryKey: ['plan-workouts', 'detail', workoutId, version?.id, version?.editNumber],
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
