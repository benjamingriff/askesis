import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { agentPrompt, REVIEW_PLAN_REQUEST } from '../lib/coach';
import { newRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { usePlanSelection } from '../state/plan-selection';
import { useAskAgent, useInAppCoach } from './account';
import { writePlan, type Plan, type PlanSummary } from './plan-data';

/**
 * Opens (or reuses) the plan's coaching conversation, optionally with a message to finish. Without
 * the in-app coach, it hands the same request to the athlete's own agent instead.
 */
export function useOpenPlanChat(plan: { id: string; displayName: string }) {
  const coach = useInAppCoach();
  const askAgent = useAskAgent();
  return useMutation({
    mutationFn: async (prefill?: string) => {
      if (!coach) {
        askAgent(
          agentPrompt(prefill || REVIEW_PLAN_REQUEST, { id: plan.id, name: plan.displayName }),
        );
        return null;
      }
      return {
        conversation: result(
          await api.POST('/api/v1/plans/{planId}/conversations/open', {
            params: { path: { planId: plan.id } },
          }),
        ),
        prefill,
      };
    },
    onSuccess: (opened) => {
      if (opened)
        router.push({
          pathname: '/chat/[id]',
          params: {
            id: opened.conversation.id,
            ...(opened.prefill ? { prefill: opened.prefill } : {}),
          },
        });
    },
  });
}

export type LifecycleAction =
  'unlock' | 'discard' | 'archive' | 'unarchive' | 'activate' | 'deactivate';

/**
 * Human-only lifecycle commands. Each sends the plan state the user was looking at, so a change
 * made elsewhere in the meantime is refused rather than overwritten. Locking has its own review.
 */
export function usePlanLifecycle(plan: Plan) {
  const client = useQueryClient();
  const { select } = usePlanSelection();
  return useMutation({
    mutationFn: async (action: LifecycleAction): Promise<Plan> => {
      const params = { path: { planId: plan.id } };
      if (
        action === 'activate' ||
        action === 'deactivate' ||
        action === 'archive' ||
        action === 'unarchive'
      )
        return result(
          await api.POST(`/api/v1/plans/{planId}/${action}`, {
            params,
            body: { expectedStateVersion: plan.stateVersion },
          }),
        );
      const body = {
        expectedStateVersion: plan.stateVersion,
        ...(plan.draft
          ? { expectedDraftId: plan.draft.id, expectedEditNumber: plan.draft.editNumber }
          : {}),
      };
      if (action === 'unlock')
        return result(await api.POST('/api/v1/plans/{planId}/unlock', { params, body }));
      return result(
        await api.POST('/api/v1/plans/{planId}/discard', {
          params: { ...params, header: { 'idempotency-key': newRequestKey() } },
          body,
        }),
      );
    },
    onSuccess: async (updated, action) => {
      if (action === 'unlock' || action === 'activate')
        select({ planId: updated.id, view: updated.draft ? 'draft' : 'locked' });
      if (action === 'discard') select({ planId: updated.id, view: 'locked' });
      writePlan(client, updated);
      // Let screens re-render with the new identities before anything refetches.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['plan-workouts'] }),
      ]);
    },
    // A conflict means the plan changed elsewhere; fetch it so the next attempt is current.
    onError: () => void client.invalidateQueries({ queryKey: ['plans'] }),
  });
}

/** What deleting a plan takes with it, for the confirmation sheet. */
export function useDeletionImpact(planId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['plans', planId, 'deletion-impact'],
    enabled,
    // Coaching or logging elsewhere changes the counts; always show the current ones.
    staleTime: 0,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/plans/{planId}/deletion-impact', { params: { path: { planId } } }),
      ),
  });
}

/**
 * Deletes a plan with its conversations, training log and check-ins. It stays restorable from
 * Recently deleted for 30 days, then it is purged. Takes the state version the athlete reviewed,
 * so a change made elsewhere in the meantime is refused.
 */
export function useDeletePlan(plan: Pick<Plan, 'id'>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (reviewedStateVersion: number) =>
      result(
        await api.POST('/api/v1/plans/{planId}/delete', {
          params: { path: { planId: plan.id } },
          body: { expectedStateVersion: reviewedStateVersion },
        }),
      ),
    onSuccess: () => {
      // Leave the lists at once, so screens showing the plan move on before its reads 404.
      client.setQueriesData<PlanSummary[]>({ queryKey: ['plans', 'collection'] }, (plans) =>
        plans?.filter((item) => item.id !== plan.id),
      );
      // Not awaited: the caller navigates away now. Its chats leave every list too.
      void client.invalidateQueries({ queryKey: ['plans'] });
      void client.invalidateQueries({ queryKey: ['chat'] });
    },
    onError: () => void client.invalidateQueries({ queryKey: ['plans'] }),
  });
}

/** Restores a recently deleted plan to Archived, with its history. */
export function useRestorePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) =>
      result(await api.POST('/api/v1/plans/{planId}/undelete', { params: { path: { planId } } })),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['chat'] }),
      ]);
    },
  });
}
