# Phase 4: persistent conversations and agent runs

## Status and decision authority

**Approved for implementation handoff, 2026-09-10.** This document refines Phase 4 of the [accepted V1 roadmap](./v1-poc-development-plan.md). It records implementation defaults chosen under the user's explicit direction to make reasonable alpha decisions without an exhaustive approval round. The user accepted the overall design; the defaults remain delegated implementation decisions rather than individually reviewed requirements.

The user confirmed that real coaching arrives with the agents in Phase 5. Phase 4 delivers durable conversations and a run lifecycle verified with a development/test executor. No product questions remain open for this handoff.

The aim is a usable prototype whose conversations survive reloads, whose work has an understandable status, and whose plan changes remain attributable. Favor a small implementation that can be revisited after use.

## Existing foundations and Phase 3 handoff

The implementation was reconciled with merged Phase 3 commit `4a83e7e`. The brief/calibration APIs retain explicit version IDs and draft edit numbers; discard still physically deletes the draft. Existing Hono, Kysely, Atlas, the generated OpenAPI client, and account-scoped TanStack Query are reused. Both mock chat surfaces have been replaced.

Phase 3 owns the structured brief, confirmation state, calibration, units, and draft editing rules. Phase 4 references those resources by explicit plan version and draft edit number. Chat is not another authoritative copy of the brief. Phase 5 will extract and update structured context using domain commands; brief confirmation remains human-only, as do lock and unlock.

The older Phase 3 exit criterion requiring conversational brief collection crosses the Phase 4/5 boundaries. Track full conversational collection and generation as an integration milestone after the worker is connected; do not require a temporary second coaching implementation to close the domain work.

## Product behavior

### Conversations and context

- An account owns each conversation. Ownership is derived from authentication; foreign resources return the same hidden 404 behavior as plans.
- A conversation is standalone or belongs to one logical plan. A plan can have many conversations.
- Plan chats use that conversation's own messages and the explicit structured plan context. Other chats are not automatically included as model history. Persisted brief/calibration changes are shared through the plan.
- Binding a standalone conversation to a newly created plan is one-way and transactional with creation. Moving chats between plans, detaching them, or retroactively attributing earlier standalone messages to a plan is deferred.
- On an explicit new-plan conversational action, create the draft and first chat in one transaction. Keep the existing non-conversational creation API working; no backfill is needed for existing plans.
- A plan's Chat action opens its most recently active non-archived conversation. If none exists, create one on that explicit action. Concurrent first-open requests resolve to the same conversation. An explicit New chat action can always create another.
- Navigation to the standalone empty chat page does not create a database row. Its first send creates the conversation, message, and run atomically.
- Use a deterministic title from the first message, truncated to 80 characters, or `New conversation` for an empty plan chat. Users may rename it to a non-empty title of at most 120 characters. Do not spend a model call on naming.
- Show the associated plan and current draft/locked state in the chat header. The browser sends an explicit target version and expected draft edit number; the API never infers it from a browser preference. Default selection is the current draft, otherwise current locked version. Historical versions remain inspectable in the plan UI; historical-target chat is deferred.
- Preserve the selected target while the composer contains text. If plan state changes, reject stale submission and ask the user to refresh context rather than silently retargeting it.

### Messages and user controls

- Messages are text-only for this phase. Attachments, voice, message editing, deletion, response regeneration, conversation branching, and full-text search are deferred. Remove or disable mock controls that imply these features exist.
- Persist user text before execution can begin. A final assistant message and successful run completion commit together.
- Messages have immutable content and a monotonically increasing sequence within their conversation. Ordering uses sequence, not timestamps.
- A temporary browser message may show `Sending` or `Could not send`. A server-accepted message stays accepted even if execution fails. Run failure is shown separately.
- A retry of an uncertain HTTP submission uses its original idempotency key and payload. It must not create a second message or run. A deliberate later message uses a new key.
- Show queued, working, stopping, completed, failed, or cancelled status in plain language, with a Stop action while work is active. Failed runs show a safe reason and allow a new message after termination. No automatic model retry or automatic replay of plan mutations in this phase.
- Changing page or signing out does not cancel accepted work. Returning refetches authoritative messages and run status.
- Use plain text rendering initially. Keep unsent text in component memory; do not persist chat content in browser storage.

### Concurrency and lifecycle actions

- Allow one nonterminal run per conversation and, for plan conversations, one nonterminal run across the entire plan. Serialize even read-only plan chats for alpha; distinguishing read-only and mutating runs can come later.
- While a run is active, retain newly typed text locally but disable Send. Another tab's submission receives `RUN_ACTIVE` without persisting a message. There is no queue of follow-up user messages.
- Cancellation is cooperative: stop future operations; completed operations remain committed. A running cancellation request stays nonterminal until acknowledged or timed out. The UI must not imply that Stop undoes work.
- Lock, unlock, discard, restore, archive of the plan, and archive of the running conversation return `RUN_ACTIVE` while relevant work is nonterminal. The user can stop the run and retry. This avoids publishing, removing, or hiding context under active work.
- Renaming and activation changes may continue subject to existing lifecycle checks. Draft edits remain governed by Phase 3 optimistic concurrency. A changed draft before execution starts fails the run with `STALE_CONTEXT`; never silently choose a different version. Future tool writes must still use current edit-number checks.
- Locking and unlocking remain explicit human actions. The old roadmap's sample `lock_plan` agent tool conflicts with the accepted lifecycle contract and must not be implemented as an agent permission.

### Archive semantics

- Store a conversation's individual archive timestamp. Effective archive state is `conversation individually archived OR associated plan archived`.
- Archiving a plan therefore makes all associated chats read-only immediately, through the same committed plan state. Do not overwrite their individual archive timestamps.
- Unarchiving the plan restores chats that were previously open; independently archived chats remain archived. This implements the existing product contract without maintaining a second restoration ledger.
- A chat cannot be unarchived while its plan is archived. Read and archive-list endpoints use effective archive state consistently.
- Archived content remains readable. No user-facing permanent deletion endpoint is introduced.

## Relational contract

Exact SQL names may follow existing repository conventions. Required constraints and transaction semantics are the contract.

| Resource                | Required data and constraints                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations`         | UUID; owner; nullable plan; title; individual archive timestamp; metadata version; next message sequence; created and activity timestamps. Same-owner association enforced by a composite reference to the plan's ID and owner.                                                                                                                                                                                                       |
| `conversation_messages` | UUID; conversation; positive sequence; user/assistant role; text; nullable producing run; immutable context provenance; creation time. Unique `(conversation_id, sequence)` and at most one final assistant message per run.                                                                                                                                                                                                          |
| `agent_runs`            | UUID; owner and conversation; triggering user message; nullable plan; immutable initial context; status; cancellation request/start/finish timestamps; safe failure code; nullable provider/model/usage/cost metadata. Unique triggering message; partial unique constraints on conversation and non-null plan for nonterminal runs. Relationships must prohibit linking a message, run, or plan from a different owner/conversation. |
| `agent_run_events`      | Run; positive per-run sequence; controlled event type; bounded JSONB metadata; creation time. Unique `(run_id, sequence)`. Append-only. Events describe execution; they do not replace authoritative plan or message state.                                                                                                                                                                                                           |

Use the existing `api_idempotency_keys` storage pattern for create/send commands. Refactor the current plan-specific helper only as needed to accept typed results without changing existing plan behavior. Enforce keys per authenticated owner and command scope, hash input, and commit the response in the same transaction. Retain keys through alpha. An identical accepted retry returns its original result even if the resource is now archived; fresh reads provide current status.

Default limits: 32,000 characters per submitted message, 120 per title, 50 conversations or messages per page with a maximum of 100, and at most 100 events per page. Bound event JSON to 16 KiB; store message text in message rows rather than event payloads. These are replaceable implementation limits, not core product requirements.

### Provenance survives discarded drafts

The current `deleteDraftContent` implementation physically deletes the draft's `plan_versions` row. A required foreign key from messages or runs to that row would break discard or lose history through a cascade.

Store an immutable scalar provenance snapshot containing the observed version UUID, observed state, version number if locked, and observed edit number. Validate its same-plan ownership transactionally when accepted, but do not place a foreign key on the snapshot's version UUID. Keep a normal foreign key to the logical plan. A deleted draft is displayed as an unavailable/discarded draft; its original UUID and edit number remain recorded.

This preserves attribution, not a reconstructable snapshot of every draft edit. Do not copy the entire plan into every message or promise exact historical replay. Locking can promote the same draft UUID, but must not rewrite what earlier messages observed. Assistant messages record their completion context as well as a producing-run link; the run's initial context stays immutable. Worker tool events can record before/after edit numbers in Phase 5.

### Run state machine

```text
queued ──→ running ──→ completed
  │           ├─────→ failed
  │           └─────→ cancelling ──→ cancelled
  │                                  or failed (timeout)
  ├──────→ cancelled
  └──────→ failed
```

`queued`, `running`, and `cancelling` hold the active-run slot. Terminal states are immutable. Cancel on a queued run is immediately terminal; cancel on a running run requests cancellation. Cancel on a terminal run returns its existing state.

Every transition locks the run, validates its source state, and appends an event in the same transaction. Completion and cancellation racing for that lock have a deterministic winner: committed completion makes later cancel a no-op; committed cancellation request prevents a later successful completion or final assistant message. Duplicate completion cannot create a duplicate message. Safe partial work remains described by events; no incomplete assistant message is promoted to a final reply.

Initial event types are `queued`, `started`, `cancel_requested`, `completed`, `failed`, and `cancelled`. They store resource IDs, codes, and bounded summary metadata. Raw model reasoning, credentials, complete prompts, and token-by-token output are not event data.

### Transaction and execution boundaries

1. Authorize and lock the plan if associated, then the conversation. Revalidate effective archive state and explicit context.
2. Check active-run constraints; allocate the next message sequence.
3. Insert the user message, queued run, initial event, and idempotency result in one transaction.
4. Commit before any executor can claim the run. The database run row is the durable work record; execution must never rely exclusively on an in-memory callback after the HTTP request.
5. Complete through the same domain service, allocating the assistant sequence and committing its message, terminal status, and terminal event together.

Use a consistent resource lock order: plan, conversation, run. Submission, terminal writes, cancel, and plan lifecycle integration must follow it. Recheck ownership/state within mutations; uniqueness constraints provide a final concurrency backstop.

Run reads and writes go through the core API boundary in the future worker architecture. Phase 5 will specify scoped machine credentials, claim leases, heartbeat/fencing, and restart recovery before executing real plan tools. Phase 4 must not expose unauthenticated claim/complete endpoints or give browsers run-transition authority.

## HTTP and browser contract

```http
GET    /api/v1/conversations?collection=open|archive&planId=...&cursor=...
POST   /api/v1/conversations
GET    /api/v1/conversations/:conversationId
PATCH  /api/v1/conversations/:conversationId
POST   /api/v1/conversations/:conversationId/archive
POST   /api/v1/conversations/:conversationId/unarchive
GET    /api/v1/conversations/:conversationId/messages?beforeSequence=...
POST   /api/v1/conversations/:conversationId/messages
POST   /api/v1/plans/:planId/conversations/open
GET    /api/v1/agent-runs/:runId
GET    /api/v1/agent-runs/:runId/events?afterSequence=...
POST   /api/v1/agent-runs/:runId/cancel
```

Conversation creation accepts an optional existing plan ID and optional initial message. Extend new-plan creation with an explicit `createConversation` option so draft/chat creation is atomic and old callers retain their behavior. Standalone-to-new-plan binding belongs to the eventual conversational creation command, never a generic `PATCH planId`. It reuses the same transaction helper and does not reattribute old history.

Send responses return `202` with the accepted message and run. Creation returns `201` with created resources, including the run when an initial message was accepted. Conversation detail includes metadata, current effective context, and active/latest run summaries; message pages are separate. Do not return unbounded transcripts.

Conversation lists sort by activity descending with UUID tie-breaking and an opaque keyset cursor. Message and event pagination use immutable sequence cursors. Lists deduplicate by ID and refetch their first page after activity; concurrent activity may shift a conversation across list pages, an acceptable alpha limitation.

Metadata changes use a conversation version and desired-state archive semantics, following the existing plan API pattern. Errors distinguish hidden `NOT_FOUND`, `CONVERSATION_ARCHIVED`, `PLAN_ARCHIVED`, `RUN_ACTIVE`, `STALE_CONTEXT`, `STALE_CONVERSATION`, `IDEMPOTENCY_CONFLICT`, and `AGENT_UNAVAILABLE`. Do not reveal foreign ownership through error variants.

Use the existing account-scoped TanStack Query provider and generated client. Initially poll active run status every two seconds while the page is visible, refetch on focus, invalidate messages on terminal status, and stop polling terminal runs. No SSE connection or token streaming is needed to observe this phase's durable state; Phase 6 owns live synchronization.

Reuse `/chat` and `/chat/:conversationId`, add `/chat/archive` before the dynamic route, and replace both mock conversation lists. Show archive controls in conversation options and a plan Chat action in plan detail. Archived views disable composing and explain how to restore access. Retain the familiar layout; search and attachment affordances must not pretend to work.

## Accepted execution boundary

User decision, 2026-09-10: real coaching arrives in Phase 5 with the agent implementation. Provider calls, Pi deployment, machine credentials, and real plan tools remain in Phase 5.

Phase 4 uses an explicitly enabled development/test executor that consumes committed runs through the internal services, returns clearly labelled test output, and exercises completion, failure, cancellation, and timeout. It makes no model calls or plan mutations. Production configuration must reject enabling it.

Expose execution availability through an authenticated capabilities endpoint (`GET /api/v1/chat-capabilities`, returning `executionAvailable` and `mode: unavailable|test`). In production, disable Send and explain that coaching is not available yet. Conversation creation without an initial message, history, rename, and archive/restore remain usable. A fresh send or create-with-initial-message request when execution is unavailable returns `503 AGENT_UNAVAILABLE` before persisting any conversation, message, or run for that command. Already accepted idempotent retries still return their stored result.

The test executor must have bounded work and a sweep that fails overdue nonterminal runs, including after restart. It must reject late completion of a terminal run. Use a small local harness rather than building the Phase 5 distributed worker infrastructure. Verification must cover unavailable production behavior as well as the simulated execution lifecycle. Passing these checks satisfies Phase 4's execution gate; real coaching is a Phase 5 gate.

## Decision ledger

| Decision                                               | Source and reason                                                 | Revisit when                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------- |
| Durable chat, observable cancellation, account privacy | Existing accepted roadmap                                         | Product direction changes                          |
| Routine implementation choices delegated to the model  | User instruction, 2026-09-10                                      | A choice materially changes product scope          |
| Real coaching in Phase 5; test execution in Phase 4    | Explicit user decision, 2026-09-10                                | Agent implementation in Phase 5                    |
| One active run per plan; reject further sends          | Model default: simplest understandable concurrency behavior       | Parallel plan discussion is needed                 |
| Own transcript plus shared structured plan             | Model default: separate topics without implicit cross-chat memory | Users expect recall across conversations           |
| Block disruptive lifecycle actions during runs         | Model default: clear stop-then-act behavior                       | Usage shows this is obstructive                    |
| Effective archive derived from chat and plan           | Model default implementing accepted restoration semantics         | Archive model grows beyond two causes              |
| Scalar version provenance survives draft deletion      | Model default compatible with current discard behavior            | Exact edit replay becomes a requirement            |
| Text-only, deterministic titles, polling               | Model defaults limiting alpha scope                               | Real use or Phase 6 requires richer interaction    |
| Existing PostgreSQL/API/client stack                   | Existing architecture, reused                                     | Evidence justifies changing it                     |
| No automatic execution retries                         | Model default avoiding duplicate or surprising work               | Worker recovery has explicit idempotency semantics |

These defaults can be revisited after prototype use. Implementers should record material deviations here rather than silently changing the product contract or reopening minor choices for user approval.
