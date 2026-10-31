import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { paths } from '@askesis/api-client';
import { api } from './api';
import { agentPrompt, useInAppCoach } from './coach';
import { useAskAgent } from './components/AskAgent';
import { result } from './lib/result';
import { useRequestKey } from './lib/use-request-key';
import { useLiveState, FALLBACK_REFRESH_MS } from './live';
export type WorkoutLog =
  paths['/api/v1/plans/{planId}/workouts/{lineageId}/log']['put']['responses'][200]['content']['application/json'];
export type LogInput =
  paths['/api/v1/plans/{planId}/workouts/{lineageId}/log']['put']['requestBody']['content']['application/json'];
export type CheckInInput =
  paths['/api/v1/check-ins']['post']['requestBody']['content']['application/json'];
export type FeedbackReferenceInput =
  { type: 'workout_log'; logId: string } | { type: 'check_in'; checkInId: string };
export function useTrainingLog(planId: string, from?: string, to?: string) {
  const live = useLiveState();
  return useQuery({
    queryKey: ['training-log', planId, from, to],
    enabled: !!planId,
    refetchInterval: live === 'live' ? false : FALLBACK_REFRESH_MS,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/training-log', {
          params: { query: { planId, ...(from ? { from } : {}), ...(to ? { to } : {}) } },
        }),
      ),
  });
}
export function useSaveLog(planId: string, lineageId: string) {
  const client = useQueryClient(),
    key = useRequestKey();
  return useMutation({
    mutationFn: async (input: LogInput) => {
      const saved = result(
        await api.PUT('/api/v1/plans/{planId}/workouts/{lineageId}/log', {
          params: { path: { planId, lineageId }, header: { 'idempotency-key': key(input) } },
          body: input,
        }),
      );
      key.settle(input);
      return saved;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['training-log'] }),
  });
}
export function useClearLog(planId: string, lineageId: string) {
  const client = useQueryClient(),
    key = useRequestKey();
  return useMutation({
    mutationFn: async () => {
      const response = result(
        await api.DELETE('/api/v1/plans/{planId}/workouts/{lineageId}/log', {
          params: {
            path: { planId, lineageId },
            header: { 'idempotency-key': key({ planId, lineageId }) },
          },
        }),
      );
      key.settle({ planId, lineageId });
      return response;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['training-log'] }),
  });
}
/**
 * Only this explicit action sends a coaching message; a log save never invokes the model. Without the
 * in-app coach, it hands the request to the athlete's own agent and resolves to null.
 */
export function useDiscussFeedback(planId: string) {
  const key = useRequestKey();
  const coach = useInAppCoach();
  const askAgent = useAskAgent();
  return useMutation({
    mutationFn: async ({
      content,
      reference,
    }: {
      content: string;
      reference: FeedbackReferenceInput;
    }): Promise<string | null> => {
      if (!coach) {
        // The agent finds the saved log or check-in through read_training_log.
        askAgent(agentPrompt(`${content}\nRead my training log first.`, { id: planId }));
        return null;
      }
      const conversation = result(
        await api.POST('/api/v1/plans/{planId}/conversations/open', {
          params: { path: { planId } },
        }),
      );
      const input = { content, target: conversation.context, references: [reference] };
      result(
        await api.POST('/api/v1/conversations/{conversationId}/messages', {
          params: {
            path: { conversationId: conversation.id },
            header: { 'idempotency-key': key(input) },
          },
          body: input,
        }),
      );
      key.settle(input);
      return conversation.id;
    },
  });
}
export const LOG_LABELS = { done: 'Done', changed: 'Changed it', skipped: 'Skipped' } as const;
export const REASON_LABELS = {
  poor_sleep: 'Poor sleep',
  heavy_legs: 'Heavy legs',
  under_fuelled: 'Under-fuelled',
  ill: 'Feeling ill',
  pain: 'Pain or niggle',
  heat: 'Heat',
  terrain: 'Terrain',
  stress: 'Life stress',
  time: 'Short on time',
  equipment: 'Equipment',
  other: 'Other',
} as const;
export function effortFlag(
  log: Pick<WorkoutLog, 'rpe' | 'plannedRpe' | 'status'> & Partial<Pick<WorkoutLog, 'placeholder'>>,
) {
  if (log.status === 'skipped' || log.rpe === null || log.plannedRpe === null) return null;
  // A placeholder's effort was only expected, never planned.
  const basis = log.placeholder ? 'expected' : 'planned';
  return log.rpe - log.plannedRpe >= 2
    ? `Harder than ${basis}`
    : log.plannedRpe - log.rpe >= 3
      ? `Easier than ${basis}`
      : null;
}
export function fullFeedback(
  workout: {
    priority?: string;
    racePriority?: string | null;
    sessionType?: string | null;
    placeholder?: boolean;
  },
  status: LogInput['status'],
  rpe?: number | null,
  planned?: number | null,
) {
  return (
    // Only the athlete knows what a placeholder turned out to be.
    !!workout.placeholder ||
    workout.priority === 'high' ||
    !!workout.racePriority ||
    ['test', 'race'].includes(workout.sessionType ?? '') ||
    status !== 'done' ||
    (rpe != null && planned != null && (rpe - planned >= 2 || planned - rpe >= 3))
  );
}
