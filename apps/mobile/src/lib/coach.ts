/**
 * A prompt for the athlete's agent. It names the plan so the agent can call the Waddle tools with
 * an explicit planId; the request may end open (for example `About “Tempo” on …: `). Matches the
 * web app's `agentPrompt()` (apps/web/src/coach.tsx).
 */
export function agentPrompt(request: string, plan?: { id: string; name?: string | undefined }) {
  if (!plan) return `Using Waddle: ${request}`;
  const name = plan.name ? ` “${plan.name}”` : '';
  return `Using Waddle, for my plan${name} (planId ${plan.id}):\n${request}`;
}

/** The request behind every "start a plan" action when there is no plan to name yet. */
export const START_PLAN_REQUEST =
  'Help me build a training plan. List my plans first, then ask me about my goal, my dates and the training I do now.';

/** What the agent is asked once a new plan exists, before it writes any workouts. */
export const NEW_PLAN_REQUEST =
  'I’ve just created this plan. Talk it through with me before writing any workouts: ask about my goal, my current training and when I can train, then save the brief.';

/** The plan menu's request when it has nothing more specific to ask. */
export const REVIEW_PLAN_REQUEST =
  'Help me review and edit this plan. Read the plan context first.';
