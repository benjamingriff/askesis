# Phase 4 implementation plan

## Status

**Approved for implementation handoff, 2026-09-10.** Implements the [Phase 4 design](./phase-4-design.md). The user accepted the plan and confirmed that real coaching arrives with the Phase 5 agents. Phase 4 verifies execution through a controlled development/test executor. No product questions remain open; ordinary alpha implementation choices are delegated as recorded in the design.

This is a planning artifact, not authorization to merge or deploy implementation. Do not treat unexecuted checks below as verification results.

**Implementation checkpoint:** implemented locally on 2026-09-10 and accepted by the user on 2026-09-11 at <http://localhost:5175/chat>. `pnpm check`, `pnpm test:db`, `pnpm smoke`, and the populated Phase 3 migration preservation rehearsal passed. See [the current handoff](./current-handoff.md#phase-4-acceptance-and-release-preparation--2026-09-11) for final verification and pending deployment steps. The stages below retain the implementation contract; they do not indicate remaining product questions.

## Stage 1: reconcile the Phase 3 handoff

Implementation checkpoint: merged Phase 3 commit `4a83e7e` has been reconciled. Its brief/calibration commands increment draft edit numbers and its discard path still deletes the draft version. Migration `20260910120000` adds chat without changing Phase 3 content. The remaining text in this section records the original implementation checklist.

Before implementation, read the merged Phase 3 design and inspect its actual schema, routes, and draft edit behavior. The branch inspected during planning contains no Phase 3 design document. Confirm:

- The current version and edit-number response shapes.
- Brief confirmation and calibration mutation commands.
- Which edits increment the draft edit number.
- Whether draft discard still physically deletes the version row.
- The latest Atlas migration and generated types.
- Any changes to plan creation and lifecycle UI.

Keep the Phase 4 conversation and run code in new API modules. Extend existing plan service transaction helpers narrowly for atomic chat creation and lifecycle guards; do not duplicate plan creation logic. Do not overwrite in-progress Phase 3 work to reproduce the branch snapshot used for this plan.

The execution scope is settled in Stage 5 below. Reconciling the merged Phase 3 implementation is the normal first implementation step, not an outstanding product approval.

## Stage 2: schema and domain services

Add an append-only Atlas migration preserving existing accounts, plans, versions, brief, calibration, and workout data. Unlike the earlier Phase 2 cutover, this phase does not require a reset.

Implement conversations, messages, runs, and run events with the ownership, sequencing, provenance, and uniqueness rules in the design. Generate Kysely types and advance API readiness to the actual new migration.

Build small services for conversation creation/list/detail/rename/archive, message acceptance, run-state transitions, cancellation, and event reads. Keep parsing in routes, transaction orchestration in services, and pure state-transition rules independently testable.

Extend the existing idempotency helper to support chat results while preserving plan-command behavior. Bound input before hashing or storage. Acquire idempotency serialization before resource locks consistently. Reuse stored responses for identical retries, reject different input, and keep message/run creation inside the transaction that stores the result.

Do not include a foreign key from immutable observed-version UUIDs to deletable draft rows. Validate provenance against the owned plan while accepting work. Enforce a foreign key to the logical plan and retain scalar attribution after discard.

Exit: database/service tests prove accepted messages, active-run uniqueness, cancellation transitions, final-message atomicity, and retained history after discard. No browser or model integration is needed to prove these invariants.

## Stage 3: plan lifecycle integration and HTTP contract

Integrate the following through shared transactions:

- Explicit creation of a plan plus its first conversation.
- Opening an existing plan's latest open conversation, creating one if necessary.
- Guards against disruptive lifecycle commands while a run is nonterminal.
- Effective archive state inherited from the owning plan.
- Existing optimistic-concurrency checks on target draft/version selection.

Add the conversation and agent-run routes from the design, including paged messages and events. Extend plan creation with the explicit chat-creation option. Define `201`/`202` response shapes and safe, stable errors in OpenAPI. Generate the shared client in the same change.

Human callers may submit, inspect, and cancel runs when execution is available. They cannot claim runs, append arbitrary events, declare completion, supply trusted usage/cost records, or write assistant messages. Keep execution transition services internal until the Phase 5 machine-authenticated worker API is designed.

Use nullable model/usage/cost fields, with an explicit unit and currency if costs are present. Missing usage is unknown, never displayed as zero cost. Never accept provider metadata from the browser.

Exit: authenticated route tests prove ownership isolation for nested resources, accepted retry behavior, archive handling, context conflicts, and bounded pagination. Generated artifacts match the API.

## Stage 4: persistent chat UI

Replace mock state in `apps/web/src/routes/chat.tsx` and the mock sidebar list in `apps/web/src/components/AppShell.tsx`. Reuse the existing account-scoped query provider and generated API client.

Deliver:

1. New standalone chat with atomic first send and navigation to its durable ID.
2. Conversation list and paged history, shared with the sidebar.
3. Plan Chat action and visible target context.
4. Message submission with stable client idempotency keys, local pending/error state, and preserved text on rejected submissions.
5. Run status, cancellation, two-second visible-page polling, and authoritative refetch after completion or focus.
6. Rename, archive, archive listing, and restore controls with effective read-only state.

A failed or ambiguous network request retains its original key and text for retry. Switching accounts disposes the prior query cache through the existing provider. Avoid automatic navigation or refetch behavior that sends text again.

The same text cannot appear twice when a local pending item becomes a server message. Reconcile using the accepted response/message ID and submission identity; timestamps are not identities. Disable repeated send while a request is unresolved or a run is active.

Remove the mock response timer and fake conversation content. Hide unsupported search and attachment controls. Render text safely and keep the existing layout functional. The execution availability behavior comes from Stage 5; do not leave users indefinitely waiting for a worker that is not configured.

Exit: UI tests exercise durable navigation/reload, send/retry reconciliation, cancellation display, archived read-only state, and account isolation. The implementation includes honest loading, empty, unavailable, and error states.

## Stage 5: test executor and production availability

The user confirmed that real coaching, provider calls, Pi deployment, machine credentials, and real plan tools arrive in Phase 5. Implement a controlled local/test executor for this phase using the same durable transition services.

The executor is explicitly enabled only in development/test; production configuration rejects that mode. It consumes committed runs, produces clearly labelled test replies, and supports deterministic success, failure, delayed cancellation, and timeout scenarios. It makes no model calls and performs no plan mutations. Use a single local harness with bounded work and a periodic sweep of overdue nonterminal runs, also run on startup. Overdue work fails with a safe timeout/interruption code; terminal-state guards reject late completion. Do not automatically replay interrupted execution.

Add authenticated `GET /api/v1/chat-capabilities` with `executionAvailable` and `mode: unavailable|test`, include it in OpenAPI, and use it to disable Send with an honest unavailable message in production. Conversation creation without an initial message, history, rename, and archive/restore remain available. Fresh send and create-with-initial-message commands return `503 AGENT_UNAVAILABLE` before writing anything when execution is unavailable. Identical retries of already accepted commands still return the stored idempotent result.

Exit: tests prove durable completion, failure, cancellation races, timeout/restart cleanup, and rejection of test mode in production. Verify the unavailable UI and API create no orphaned conversations/messages/runs. These checks satisfy the Phase 4 execution gate; Pi and real coaching are verified in Phase 5.

## Stage 6: integrated verification and handoff

Run the repository's required checks against the final integration branch:

```bash
pnpm check
pnpm test:db
pnpm smoke
```

Use the actual test harness and package scripts present after Phase 3. Add meaningful regression tests rather than a separate testing framework. PostgreSQL tests must use independent transactions/connections for races; sequential mocked calls do not prove concurrency safety.

| Scenario                                                                 | Required result                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Another account guesses conversation, message, run, or event identifiers | Hidden not-found response; no content or ownership leak                          |
| Simultaneous retries with the same submission key                        | Exactly one user message, run, initial event, and stored result                  |
| Same key with changed text/context                                       | Conflict; no additional writes                                                   |
| Two sends in different chats of one plan                                 | At most one active run; rejected submission leaves no message                    |
| Two standalone first-send retries                                        | One conversation and one accepted turn                                           |
| Two first Chat actions on a plan                                         | Same open conversation; explicit New chat still creates another                  |
| Cancel races completion                                                  | One terminal outcome, at most one final assistant message, consistent events     |
| Final-message persistence fails                                          | Neither successful terminal state nor partial final reply commits                |
| Lifecycle command races send/claim                                       | Serial outcome respects plan locks and active-run guards                         |
| Draft changes before execution                                           | Stale context fails explicitly; no silent retargeting                            |
| Draft discarded after a terminated run                                   | Plan discard works; transcript and original context attribution survive          |
| Individually archived chat, then plan archive/unarchive                  | Individually archived chat stays archived; formerly open chats reopen            |
| Reload, focus, or sign-in cycle during execution                         | Authoritative status returns without duplicate submission                        |
| Executor unavailable, interrupted, or timed out                          | Defined unavailable/failure behavior from resolved Stage 5; no permanent spinner |

Apply migrations to both an empty database and a populated Phase 3 fixture; verify existing plan meaning and lifecycle behavior are preserved. The fixture must exercise brief/calibration fields once Phase 3 supplies them.

For a signed-in walkthrough, test standalone chat, plan chat, reload, cancel, failure, archive, and restore. Use the chosen execution mode explicitly and label simulated output. Record what was actually exercised; simulated coaching does not prove Pi or model integration.

Inspect logs and Sentry behavior for the new routes: correlation IDs and safe failure codes may be logged, but prompts, transcripts, context, provider credentials, and raw database row errors must not be included.

Deployment, when separately authorized, should use the existing Railway migration and smoke workflow. Update the current handoff with migration ID, execution availability/configuration, verification results, and accepted limitations. Do not mark Phase 4 complete while its resolved execution gate is untested.

## Implementation decision policy

Use the defaults in the design as the starting contract. The implementer may refine names, internal modules, indexes, UI copy, and harness mechanics when the behavior stays equivalent. Record material changes to the design and handoff. Ask the user only if a decision changes the agreed coaching scope, core chat behavior, ownership, or plan lifecycle semantics beyond the delegated prototype defaults.
