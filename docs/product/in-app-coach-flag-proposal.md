# In-app coach flag and "Ask your agent"

**Status:** accepted and implemented, 2026-10-31. It covers the "chat hidden behind a flag" item in Phase 4 of the MCP server plan (`docs/product/mcp-server-plan.md`, added in PR #95). Owner decisions are recorded at the end.

## Why

The first release to friends uses MCP: athletes plan with Claude or another agent they already pay for. Askesis does not host a coaching agent for them. The web app stays the place to review, lock and train. The in-app coach keeps being developed, but it should not appear in that release.

Askesis stays one app with one codebase. The chat code, its tests and the coaching worker stay in place. A server setting decides whether athletes see the coach. While it is hidden, every place that opens a chat today offers **Ask your agent** instead. The athlete gets the same "talk this through" action, aimed at the MCP-connected agent.

## Current behavior

- `CHAT_EXECUTION_MODE` (`unavailable` | `test` | `agent`, default `unavailable`) controls whether a run can execute. `GET /api/v1/chat-capabilities` reports `executionAvailable`, which is also false when the worker is down. When it is false, the chat page stays visible and shows "Coaching is not available yet".
- The web app always shows the chat. Besides the `/chat/*` routes, it opens a chat from:

| Entry point          | Code                                                       | Current action                                                        |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Shell navigation     | `AppShell.tsx`                                             | Coach tab, New chat, recent chats                                     |
| No-plan empty states | `today.tsx`, `active-plans.tsx`                            | "Talk to your coach"                                                  |
| Plan draft           | `PlanLifecycle.tsx` (`/plans/{planId}/conversations/open`) | Opens the plan's coach conversation                                   |
| Workout dialog       | `Workout.tsx`, `Schedule.tsx`, `today.tsx` (`onAskCoach`)  | "Ask your coach about this" with a prefilled message                  |
| Workout feedback     | `TrainingLog.tsx` (`useDiscussFeedback`)                   | Saves the log, sends a message referencing it and opens the chat      |
| Not feeling 100%     | `TrainingLog.tsx` (`useDiscussFeedback`)                   | Saves the check-in, sends a message referencing it and opens the chat |
| Performance          | `performance.tsx`                                          | New chat button, "Recorded by your coach" links                       |

- About a dozen strings say "your coach" (for example `PlanView.tsx`, `PlanWidgets.tsx`, `PlanChanges.tsx`, `LockReviewDialog.tsx`, `plans.tsx`, `TrainingResult.tsx`).
- `RequireAuthentication` in `router.tsx` loads `GET /api/v1/account` before any signed-in page renders.
- The MCP tools (`list_plans`, `read_plan_context`, `read_schedule`, `read_training_log`, and others) take an explicit `planId`. `read_training_log` returns logs and check-ins, so an agent can find what the athlete just saved.

## Design

### 1. A separate setting for whether the coach is shown

Add `IN_APP_COACH` (`enabled` | `hidden`, default `enabled`) to the API config.

Keep it separate from `CHAT_EXECUTION_MODE`. Execution mode reports whether the worker is reachable right now, and that can change during an outage. Visibility is a product choice. If the two were combined, a worker outage would hide the whole coach. Production for the first release sets `IN_APP_COACH=hidden` and `CHAT_EXECUTION_MODE=unavailable` and runs no coaching workers. Development keeps the coach visible by default.

### 2. The account response carries it

Extend `AccountSchema`:

```ts
features: z.object({ inAppCoach: z.boolean() });
```

The account query already loads before any signed-in page renders, so the shell never shows the Coach tab and then removes it. If the account cannot load, the app shows an error with Retry, rather than rendering pages without knowing which features are offered. A per-user allowlist could later change this value for some accounts without changing the client. The existing `chat-capabilities` endpoint keeps reporting whether a run can execute.

### 3. The API rejects chat writes while the coach is hidden

When `IN_APP_COACH=hidden`, these routes return `403 COACH_NOT_OFFERED`:

- `POST /api/v1/conversations`
- `POST /api/v1/plans/{planId}/conversations/open`
- `POST /api/v1/conversations/{conversationId}/messages`

`POST /api/v1/plans` still creates the plan, but ignores `createConversation` while hidden. Reads, archive, export and deletion keep working. Conversations created while the coach was visible stay in the data export and in deletion counts. Worker-facing agent routes are unaffected. This keeps the server authoritative: an old client, or a stale tab after the setting changes, cannot start runs.

### 4. The web app reads one hook

```ts
export function useInAppCoach(): boolean; // account.data.features.inAppCoach
```

When it returns false:

- **Shell:** hide the Coach tab, New chat and recent chats. An **Agent** link to the Settings connection page arrives with that page in MCP Phase 4.
- **Settings:** hide **Show coach activity**. Performance history keeps "Recorded by your coach" for results the in-app coach recorded, without the link to the conversation.
- **Routes:** `/chat/*` redirects to `/today`.
- **Copy:** a small `useCoachTerms()` helper returns "your coach" or "your agent". It replaces the hard-coded strings, so drafts say, for example, "Your agent can edit this", and locking says "Only you can confirm and lock".
- **Entry points:** each one becomes an **Ask your agent** action (next section).

Coach-only text (live generation, interrupted output) only appears when an in-app run exists, so it needs no change.

### 5. Ask your agent

Askesis cannot send a message into the athlete's Claude session. The action instead saves what the athlete entered and hands them a prompt that their agent can act on with the MCP tools:

1. Save first, as today: the log, check-in or nothing extra.
2. Build a short prompt. It names the plan, its `planId` and the record the athlete just saved, so the agent can read it with the tools.
3. Open the **Ask your agent** dialog. It tries to copy the prompt straight away and shows the text, so the athlete can check it or copy it by hand. The clipboard can refuse a write that follows a slow save, so a toast alone would not be enough. **Copy prompt** retries the copy.

Every prompt starts with `Using Askesis, for my plan “{name}” (planId {id}):` on its own line, followed by the request the in-app coach would have received:

| Entry point                                     | Request                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| No plan (Today, Plan)                           | Help me build a training plan. List my plans first, then ask me about my goal, my dates and the training I do now. (no plan prefix) |
| New plan                                        | I’ve just created this plan. Talk it through with me before writing any workouts…                                                   |
| Plan toolbar (**Agent**)                        | Help me review and edit this plan. Read the plan context first.                                                                     |
| Unplanned weeks                                 | Plan the remaining weeks                                                                                                            |
| Workout dialog                                  | About “{title}” on {date}:                                                                                                          |
| Workout feedback (**Save and talk it through**) | The existing feedback message, then `Read my training log first (workout log {id}).`                                                |
| Not feeling 100% (**Ask my agent to adjust**)   | The existing check-in message, then `Read my training log first (check-in {id}).`                                                   |
| Performance (**Update with my agent**)          | Help me update my {pace guides or zones}. Read my performance first, then ask me about recent results. (no plan prefix)             |

Two hooks are the switch points, so every caller changes at once: `useOpenPlanChat` and `useDiscussFeedback`. While hidden, they call `useAskAgent()` instead of the conversation routes, and resolve to `null` instead of a conversation. Only a real conversation navigates to `/chat`. The provider sits in the app shell. A dialog that closes beneath it (the check-in sheet) no longer takes focus back from it.

When the agent saves a change, the database triggers already send live events, so the open page refreshes. The athlete sees the change appear and then reviews and locks it in Askesis, as with the in-app coach.

The prompts include only what the athlete just entered and plan identifiers. No tokens or Askesis URLs go to the clipboard.

### 6. Mobile

The mobile prototype does not call the API. When it does, it reads the same `features.inAppCoach` and uses the same prompts.

## Delivery

One PR on top of the MCP work, or right after it:

1. API: `IN_APP_COACH` setting, `features` on the account response, `COACH_NOT_OFFERED` checks and regenerated client types.
2. Web: `useInAppCoach`, shell and route changes, `useCoachTerms`.
3. Web: the `useAskAgent` dialog and the entry points above.
4. Docs: update this proposal into a behavior contract, the [operations runtime notes](../operations/phase-6-runtime.md) and local development (how to run with the coach hidden).

The Settings connection page (connector URL, connected clients) and the shell link to it belong to MCP Phase 4.

## Tests

- API: the account response reflects the setting; each chat write returns `COACH_NOT_OFFERED` when hidden; reads and export still work.
- Web: shell, Today and Plan empty states, workout dialog, feedback and check-in render correctly in both modes; `/chat` redirects when hidden; the dialog copies the expected prompt, falls back to manual copying, and saving happens first.
- Browser check in both modes: hide the coach, log feedback, copy the prompt and make an edit through the dev MCP endpoint. Confirm that the plan updates live.

## Owner decisions

Recorded 2026-10-31.

1. **Copy now, open later.** The first release copies the prompt. Opening the agent directly (for example a prefilled-prompt link) is wanted and will be revisited once the MCP connection works end to end and Settings knows which client is connected.
2. **No per-user override.** The owner's account uses the same setting; the in-app coach is on hold for a few weeks. The `features` field leaves room for an override later.
3. **History is hidden.** Existing conversations are not shown while the coach is hidden. They stay in the data export and deletion; this can be refined later.
4. **Naming.** "Your agent" for now.
5. **Agent inbox: try in the future.** Instead of copying a prompt, the app would record an open request ("athlete asked to adjust after a check-in"), and the MCP server would surface it in `read_plan_context` or an MCP prompt, so the athlete could just say "check Askesis". This fits after MCP Phase 2.
6. **Attribution** for MCP writes ("Recorded by your coach" needs an external-agent label) stays with MCP Phase 4.
