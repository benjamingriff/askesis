import { useInfiniteQuery } from '@tanstack/react-query';
import type { paths } from '@askesis/api-client';
import { api } from './api';

export type Conversation =
  paths['/api/v1/conversations/{conversationId}']['get']['responses'][200]['content']['application/json'];
export type Run =
  paths['/api/v1/agent-runs/{runId}']['get']['responses'][200]['content']['application/json'];
export type Target = { versionId: string; editNumber: number } | null;
export class ChatRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function chatResult<T>(response: { data?: T; error?: unknown; response: Response }): T {
  if (response.data !== undefined) return response.data;
  const error = response.error as { error?: { message?: string } } | undefined;
  throw new ChatRequestError(
    error?.error?.message ?? 'The request failed. Try again.',
    response.response.status,
  );
}
export const isActive = (run: Run | null | undefined) =>
  !!run && ['queued', 'running', 'cancelling'].includes(run.status);
export function useConversations(archived = false) {
  return useInfiniteQuery({
    queryKey: ['chat', 'list', archived],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      chatResult(
        await api.GET('/api/v1/conversations', {
          params: {
            query: {
              collection: archived ? 'archive' : 'open',
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
