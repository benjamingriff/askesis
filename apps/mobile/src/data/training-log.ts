import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { paths, WorkoutSummary } from '../lib/api-types';
import { api } from '../lib/api';
import { agentPrompt } from '../lib/coach';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { FALLBACK_REFRESH_MS, useLiveState } from '../state/live';
import { useAskAgent, useInAppCoach } from './account';

// Ported from apps/web/src/training-log.ts; keep the two in step.

export type WorkoutLog =
  paths['/api/v1/plans/{planId}/workouts/{lineageId}/log']['put']['responses'][200]['content']['application/json'];
export type LogInput =
  paths['/api/v1/plans/{planId}/workouts/{lineageId}/log']['put']['requestBody']['content']['application/json'];
export type LogStatus = LogInput['status'];
export type CheckInInput =
  paths['/api/v1/check-ins']['post']['requestBody']['content']['application/json'];
export type FeedbackReferenceInput =
  { type: 'workout_log'; logId: string } | { type: 'check_in'; checkInId: string };

export function useTrainingLog(planId: string | null | undefined, from?: string, to?: string) {
  const live = useLiveState();
  return useQuery({
    queryKey: ['training-log', planId, from, to],
    enabled: !!planId,
    refetchInterval: live === 'live' ? false : FALLBACK_REFRESH_MS,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/training-log', {
          params: { query: { planId: planId!, ...(from ? { from } : {}), ...(to ? { to } : {}) } },
        }),
      ),
  });
}

export function useSaveLog(planId: string, lineageId: string) {
  const client = useQueryClient();
  const key = useRequestKey();
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
  const client = useQueryClient();
  const key = useRequestKey();
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

export function useCreateCheckIn() {
  const client = useQueryClient();
  const key = useRequestKey();
  return useMutation({
    mutationFn: async (input: CheckInInput) => {
      const response = result(
        await api.POST('/api/v1/check-ins', {
          params: { header: { 'idempotency-key': key(input) } },
          body: input,
        }),
      );
      key.settle(input);
      return response;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['training-log'] }),
  });
}

/**
 * Only this explicit action sends a coaching message; a log save never invokes the model. Without
 * the in-app coach, it hands the request to the athlete's own agent and resolves to null.
 * `open` decides when to show the conversation, so a sheet can close first.
 */
export function useDiscussFeedback(plan: { id: string; name: string }) {
  const planId = plan.id;
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
        // The agent finds the saved log or check-in by its id through read_training_log.
        const record =
          reference.type === 'workout_log'
            ? `workout log ${reference.logId}`
            : `check-in ${reference.checkInId}`;
        askAgent(agentPrompt(`${content}\nRead my training log first (${record}).`, plan));
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

export const openConversation = (id: string) =>
  router.push({ pathname: '/chat/[id]', params: { id } });

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
export const CHECK_IN_LABELS = {
  ill: 'Feeling ill',
  pain: 'Pain or injury',
  run_down: 'Run down',
  busy: 'Busy or travelling',
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

/** Whether a quick log should go on to the full feedback form. */
export function fullFeedback(
  workout: {
    priority?: string;
    racePriority?: string | null;
    sessionType?: string | null;
    placeholder?: boolean;
  },
  status: LogStatus,
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

/** A saved log as input, with changes applied, so a quick edit keeps everything else. */
export function logInput(log: WorkoutLog, changes: Partial<LogInput> = {}): LogInput {
  return {
    status: log.status,
    performedOn: log.performedOn,
    actualDurationSeconds: log.actualDurationSeconds,
    actualDistanceMetres: log.actualDistanceMetres,
    rpe: log.rpe,
    feel: log.feel,
    reasons: log.reasons,
    answers: log.answers,
    note: log.note,
    ...(log.placeholder ? { actualSessionType: log.actualSessionType } : {}),
    ...changes,
  };
}

/** The workout a log was made against, from its saved snapshot (it may no longer be scheduled). */
export function loggedWorkout(log: WorkoutLog, current?: WorkoutSummary): WorkoutSummary {
  return {
    id: current?.id ?? log.lineageId,
    lineageId: log.lineageId,
    planId: log.planId,
    planVersionId: log.loggedVersionId,
    planTitle: current?.planTitle ?? '',
    weekNumber: current?.weekNumber ?? 1,
    scheduledDate: log.scheduledOn,
    title: log.title,
    description: null,
    purpose: null,
    discipline: log.discipline,
    priority: log.keySession ? 'high' : 'medium',
    racePriority: log.sessionType === 'race' ? 'C' : null,
    sessionType: log.sessionType,
    plannedRpe: log.plannedRpe,
    estimatedDurationSeconds: log.plannedDurationSeconds,
    estimatedDistanceMetres: log.plannedDistanceMetres,
    placeholder: log.placeholder,
    expectedRpe: log.placeholder ? (current?.expectedRpe ?? null) : null,
  };
}
