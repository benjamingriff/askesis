import { Navigate, Outlet } from 'react-router';
import { useAccount } from './account';

/**
 * Whether this deployment offers the in-app coach. When it is hidden, athletes plan with their own
 * agent over MCP and every chat entry point asks that agent instead.
 */
export function useInAppCoach() {
  // RequireAuthentication loads the account before any signed-in page renders; this only reads it.
  return useAccount(false).data?.features.inAppCoach ?? true;
}

/** Chat is part of the in-app coach; without it, old chat links land on Today. */
export function RequireInAppCoach() {
  return useInAppCoach() ? <Outlet /> : <Navigate to="/today" replace />;
}

/** Who edits drafts and answers questions: the in-app coach or the athlete's connected agent. */
export function useCoachWord() {
  return useInAppCoach() ? 'coach' : 'agent';
}

/**
 * A prompt for the athlete's agent. It names the plan so the agent can call the Askesis tools with
 * an explicit planId; the request may end open (for example `About “Tempo” on …: `).
 */
export function agentPrompt(request: string, plan?: { id: string; name?: string | undefined }) {
  if (!plan) return `Using Askesis: ${request}`;
  const name = plan.name ? ` “${plan.name}”` : '';
  return `Using Askesis, for my plan${name} (planId ${plan.id}):\n${request}`;
}
