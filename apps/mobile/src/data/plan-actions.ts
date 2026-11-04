import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { newRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { usePlanSelection } from '../state/plan-selection';
import { writePlan, type Plan } from './plan-data';

/** Opens (or reuses) the plan's coaching conversation, optionally with a message to finish. */
export function useOpenPlanChat(planId: string) {
  return useMutation({
    mutationFn: async (prefill?: string) => ({
      conversation: result(
        await api.POST('/api/v1/plans/{planId}/conversations/open', {
          params: { path: { planId } },
        }),
      ),
      prefill,
    }),
    onSuccess: ({ conversation, prefill }) =>
      router.push({
        pathname: '/chat/[id]',
        params: { id: conversation.id, ...(prefill ? { prefill } : {}) },
      }),
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
