import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { api } from '../lib/api';
import { result } from '../lib/result';

export const ACCOUNT_KEY = ['account'] as const;

export function useAccount(enabled = true) {
  return useQuery({
    queryKey: ACCOUNT_KEY,
    enabled,
    queryFn: async () => result(await api.GET('/api/v1/account')),
  });
}

/**
 * Whether this deployment offers the in-app coach. When it is hidden, athletes plan with their own
 * agent over MCP and every chat entry point asks that agent instead.
 */
export function useInAppCoach() {
  // AccountGate loads the account before any signed-in screen renders; this only reads it.
  return useAccount(false).data?.features.inAppCoach ?? true;
}

/** Who edits drafts and answers questions: the in-app coach or the athlete's connected agent. */
export function useCoachWord(): 'coach' | 'agent' {
  return useInAppCoach() ? 'coach' : 'agent';
}

/** Hands a prompt to the athlete's own agent: the Ask your agent sheet copies it and shows it. */
export function useAskAgent() {
  return useCallback(
    (prompt: string) => router.push({ pathname: '/ask-agent', params: { prompt } }),
    [],
  );
}
