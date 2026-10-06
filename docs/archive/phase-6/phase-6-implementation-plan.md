# Phase 6 implementation plan

## Current-code reconciliation — 2026-10-06

- The delivery stages are implemented. Actual journal events are resource notifications (`plan.changed`, `conversation.changed`, `message.changed`, `run.changed`, `activity.changed`, `output.changed`) with no text deltas.
- There is no `/agent-runs/:runId/changes` route: saved changes are included in `/turn` and conversation run-turn projections. Output batch cadence is 400 ms; healthy SSE uses 45-second fresh-token renewal and disconnected active reads use three seconds.
- Saved-change cards summarize net committed changes per run. Current runtime documentation specifies the finalized bounds/retention/queries.
- The historical unreleased-migration development instructions do not apply to a now-deployed migration; append a new migration for future schema changes. Native integration remains deferred.

The remaining content is the original historical record. Current procedures/contracts are indexed in [the documentation index](../../README.md).

> Historical delivery record. Status, pending checks and next-step recommendations describe the original checkpoint; see the [current handoff](../../current-handoff.md) for present priorities.

## Status and contract

**Complete, 2026-10-06.** The owner confirmed Phase 6 is fully complete and working. Implemented on 2026-10-05 against the
[Phase 6 design](../../product/phase-6-design.md) against merged `main` at `4351ec9`.
Product questions are resolved. The technical choices below are implementation
defaults; refine them against tests without changing the agreed behavior.

Local verification and the owner-confirmed acceptance closeout are recorded in the
[validation report](./phase-6-validation.md). The [runtime](../../operations/phase-6-runtime.md)
records the final contracts, bounds and rollout order. The stages below preserve
the agreed implementation checklist; the completion status comes from owner acceptance.

This scope delivers streaming replies, accurate activity, live committed plan
updates, persistent interrupted output, chat-side plan review, workout differences
and timing measurements. It builds on the merged worker and web components.

**Do not edit `apps/mobile` or its dependencies, configuration or data.** The
native app remains a reference prototype. Use targeted format commands; do not
format the repository in a way that rewrites the prototype.

## Existing seams to reuse

| Area                                         | Starting points                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Worker execution                             | `apps/agent/src/runtime.ts`, `worker.ts`, `api.ts`                                             |
| Worker authorization and receipts            | `apps/api/src/modules/agent/agent.service.ts`, `agent.routes.ts`                               |
| Durable messages and run transitions         | `apps/api/src/modules/chat/chat.service.ts`, `chat.schemas.ts`                                 |
| Aggregate comparisons                        | `apps/api/src/modules/plans/plan.aggregate.ts`                                                 |
| Browser authentication and account isolation | `apps/web/src/api.ts`, `query-provider.tsx`                                                    |
| Version-aware plan reads                     | `apps/web/src/plan-data.ts`                                                                    |
| Chat, plan review and shared controls        | `apps/web/src/routes/chat.tsx`, `components/PlanView.tsx`, `Schedule.tsx`, `PlanLifecycle.tsx` |
| Responsive layout and colors                 | Existing web design-system components, themes and area stylesheets                             |

The worker pins `@openai/agents` to 0.18.0. Its installed declarations support
`Runner.run(..., { stream: true, signal })`, async stream iteration and a
`completed` promise. The [official running-agents guide](https://developers.openai.com/api/docs/guides/agents/running-agents)
documents incremental output and waiting for completion. Verify these behaviors
with the pinned package's deterministic model harness before replacing the
current nonstreaming path. No SDK, model, provider or reasoning upgrade is needed
for this scope.

## Delivery sequence

| Stage | Deliverable                                             | Depends on              |
| ----- | ------------------------------------------------------- | ----------------------- |
| 1     | Durable output and notification contracts               | Existing Phase 5 schema |
| 2     | Streaming worker, activity and timing collection        | 1                       |
| 3     | Authenticated browser stream and focused refresh        | 1; exercise with 2      |
| 4     | Read-only draft differences and per-run summaries       | 1; integrate with 2     |
| 5     | Streamed chat, interrupted history and reading behavior | 2–3                     |
| 6     | Responsive chat/plan review and change indicators       | 3–5                     |
| 7     | Integrated verification and release preparation         | All above               |

Stages describe reviewable increments, not additional product-approval gates.
No live-provider success, deployment or phase completion may be claimed before
the corresponding checks actually run.

## 1. Durable output and notification contracts

Add append-only Atlas migrations. Preserve existing plans, conversations, runs,
tool receipts and immutable content hashes. Regenerate database types and API
contracts through the existing scripts; do not edit generated artifacts manually.

### Output and activity

- Store batched user-visible assistant text per run with stable output-item order
  and monotonic revisions/offsets. A run can contain visible text before a tool
  call and a separate final response; keep those segments identifiable instead of
  blindly concatenating all text into the final answer.
- Keep this presentation record separate from completed conversation messages.
  Run terminal status supplies the incomplete label. A run-history read must find
  cancelled/failed turns even when they produced no completed assistant message.
- Apply existing run ownership, current lease and generation checks to every
  worker output/activity write. Bound text, metadata size, event frequency and
  per-run storage. Keep the existing 32,000-character final-message limit and
  document any additional presentation limit with explicit truncation metadata.
- Prefer ordered batches with an idempotency identity, not one write per model
  token. Store accepted text and its delivery event in the same transaction. The
  browser displays accepted output so text it has seen can be recovered on reload.
- Retrying the same batch is a no-op; conflicting duplicate payloads and stale
  revisions are rejected. A terminal run cannot gain new output or tool activity.
- Support a bounded final text flush while a valid lease is cancelling, without
  permitting new plan mutations. Serialize that flush with terminal transition;
  late writes after finalization remain rejected. Worker loss retains the last
  accepted prefix and does not fabricate unsaved provider text.
- Keep successful completion atomic: finalize output, associate the durable final
  message, record usage and transition the run together. Repeated finish delivery
  must not produce a second assistant message. Preserve display-only intermediate
  segments without duplicating the final segment in history.
- Extend safe activity with operation identities, actual start, success, failure
  or interruption. Only committed tool receipts justify a successful plan edit.
  Provider reasoning, raw tool inputs and complete tool outputs are not public
  activity payloads.

### Account notifications

- Add a small PostgreSQL-backed owner-scoped notification journal, with resource
  identifiers and revision metadata. This supports changes when chat is not
  mounted and when another tab/session performs a command.
- Collect notifications for a domain command and publish them transactionally
  after its domain work. Cover chat creation/rename/archive, accepted messages,
  run transitions/output, plan association, successful agent mutations, brief and
  calibration edits, and human plan lifecycle/organization commands.
- Use an owner-local transactional cursor, or an equivalent proven ordering,
  rather than assuming a global serial ID follows commit order. Set and test a
  consistent lock order: concurrent commits must not be skipped by a subscriber.
- A rollback and an idempotent command retry must not emit a new domain change.
  Journal payloads identify state to refetch; batched text payloads may carry
  bounded output deltas with stable offsets.
- Bound replay, slow-client buffering and journal retention. Keep output snapshots
  and terminal summaries independently of disposable delivery history. If a
  cursor is too old, return a reset instruction and reconcile current state.
- Start with indexed journal tailing through the API and existing PostgreSQL.
  No Redis, broker or cross-tab leader protocol is needed. A process-local wakeup
  may reduce delay, but it cannot be the sole delivery source.

Candidate additive routes, finalized with the generated contract:

```http
GET  /api/v1/live/bootstrap
GET  /api/v1/live/events
GET  /api/v1/conversations/:conversationId/runs
GET  /api/v1/agent-runs/:runId/output
POST /internal/agent/runs/:runId/progress
```

Bootstrap supplies an owner-scoped cursor. Capture it before refreshing mounted
queries, then subscribe from it so changes during refresh can be replayed safely.
Existing messages, run status and event endpoints remain authoritative reads.

Exit: PostgreSQL-backed tests prove prefix recovery, batch retries, lease/terminal
fencing, atomic completion, cancellation/worker-loss retention, cross-owner
protection, rollback and concurrent notification delivery.

## 2. Streaming worker, activity and measurements

- Change the runtime adapter to consume streamed SDK events while preserving
  current context assembly, tools, prompt, serial mutation ordering and limits.
- Normalize only user-visible output-text events. Track item/response identity
  across multiple model turns; exclude reasoning, argument deltas and provider
  error payloads from the browser stream.
- Coalesce output into bounded batches, starting with a 250–500 ms flush cadence
  and a size threshold. Use backpressure and a bounded queue. Flush on item end,
  successful completion and interruption; handle accepted-but-lost acknowledgements
  with the original batch identity. The exact cadence is an engineering setting.
- Await stream settlement and inspect failure/cancellation before finalizing the
  run. A clean transport EOF alone is not proof of a successful coaching reply.
- Emit tool-start activity when a local handler actually begins, after model
  arguments are ready. Reuse the API's transactional receipts for completion and
  saved-change attribution. If a tool response is uncertain, reconcile its
  receipt before claiming failure; an already committed operation stays saved.
- Preserve the AbortSignal and lease-heartbeat contract. Progress responses may
  also report cancelling, letting the worker react sooner during active output;
  retain lease heartbeat as the independent control when no output is produced.
- Preserve terminal recovery through the API sweeper; do not restart a failed
  provider session or regenerate a saved schedule automatically.

Measure per run and model request: queue wait, first visible output, model duration,
tool-handler/API duration, first committed schedule write, and total duration.
Record model/reasoning/prompt identifiers, token usage when available, output
batch counts and timings. Distinguish monotonic local durations from cross-service
timestamps; do not subtract unsynchronized clocks as precise latency. Use existing
structured logs and a bounded run-timing summary, without logging text or plans.

**Measurement only:** do not change model/reasoning settings, coaching methodology,
prescription schemas or context strategy to chase generation speed. Produce a
baseline report for subsequent optimization.

Exit: deterministic streamed-model cases cover visible text, text/tool/text
ordering, tools during streaming, provider error after partial output, cancellation,
batch-delivery retries and final usage/completion behavior.

## 3. Authenticated browser stream and focused refresh

- Place a live provider inside the existing account-scoped query provider so it
  works while Today, Plan, library/details or chat is open. Use one stream per
  signed-in browser tab; additional tabs are independently authorized.
- Use fetch-based SSE with the existing Clerk token provider and Authorization
  header. Do not put session tokens in URLs or use unauthenticated worker routes.
- Authenticate connection setup and bound connection lifetime so a connection
  cannot outlive its authorization indefinitely. Reconnect with fresh credentials;
  sign-out/account change aborts the connection and clears cursors/live buffers.
- Parse frames incrementally, including split UTF-8/chunks, heartbeats, event IDs,
  reset events and bounded payloads. Reconnect with backoff and jitter; browser
  visibility/online recovery performs authoritative reconciliation.
- Ensure nginx streams without buffering or caching and has suitable idle limits
  with application heartbeats. Keep the internal worker API inaccessible publicly.
- Apply output revisions/offsets idempotently; recover gaps from output snapshots.
  Schedule targeted invalidation for domain events. Text output does not invalidate
  plan reads; a changed plan does not refresh every unrelated plan.
- Refresh plan metadata first to obtain the current version/edit identity, then
  let the existing version-aware brief/workout keys select current data. Invalidate
  workout detail for affected versions/calibrations and library/calendar queries
  only when their data depends on that event.
- Explicitly selected locked/history versions stay selected. Events can indicate
  that a newer draft exists without replacing the immutable version being read.
- Remove constant chat polling once the healthy stream is connected. Retain
  bounded fallback polling/refetch while disconnected, including execution
  availability recovery. Starting sends and mutation retries remain ordinary HTTP.

Exit: tests cover parser boundaries, duplicate/out-of-order delivery, cursor reset,
expired authentication, two accounts/tabs, selective refresh, API restart and
degraded operation. Reconnect must never resubmit a message or domain mutation.

## 4. Read-only differences and saved-change summaries

Add owner-scoped reads for the current draft comparison and a run's saved changes:

```http
GET /api/v1/plans/:planId/draft/changes
GET /api/v1/agent-runs/:runId/changes
```

- Compare current draft content against the current locked version. A first draft
  compares against an empty baseline. Restoring an older revision still compares
  with the current lock, showing the pending rollback accurately.
- Reuse normalized aggregate/lineage comparison; ordinary cloning changes row IDs
  without making every workout new. Add stable lineage/current IDs and previous
  dates to the UI projection so highlighting is attached to the right workout.
- Recognize Added, Changed and Moved; a workout can be moved and also changed.
  Keep removed-workout title/date entries outside the live schedule. Do not use
  title heuristics or provider prose to decide whether content changed.
- Include brief/date/calibration summaries. Resolved pace changes caused by
  calibration must be explained even if symbolic workout targets did not change;
  distinguish changed pace guidance from a rewritten workout prescription.
- Return version/edit/baseline identities, and compute a consistent projection
  from one database snapshot. A stale response cannot overwrite a later draft view.
- The read performs no validation command, confirmation, hash write or mutation.
  Do not call lock validation repeatedly as a substitute for a diff endpoint.
- Persist compact, safe before/after change summaries with successful tool receipts
  in the mutation transaction. Exclude reads, validations, failed operations and
  idempotent repeats. Combine committed records per run without counting repeated
  delivery as another edit.
- Per-run cards describe that run's actions; draft highlights describe current net
  differences. Later reversions remove draft highlights without falsifying older
  run activity. Do not reconstruct old draft states that were never retained.
- Legacy runs lacking detailed summaries use the existing truthful generic edit
  indication; do not invent a detailed historical comparison.

Exit: lineage, moves plus edits, add/remove/revert, first-draft, restore, calibration,
transaction rollback and concurrent-read cases produce correct summaries without
changing any stored plan or immutable hash.

## 5. Chat rendering and interrupted history

- Separate transcript, composer, turn activity and live output rendering enough
  to reuse them inside the new conversation layout. Preserve safe Markdown and
  the current accepted-send/idempotent retry behavior.
- Join paged messages and run history by run and user-message identity. Older
  completed, cancelled and failed turns retain their activity, output and saved
  changes even after another run starts. Deduplicate the final durable message
  against its displayed output segment.
- Show accepted incomplete output as Stopped or Failed · incomplete after reload.
  Do not feed these presentation snippets back as completed assistant answers.
  Existing user messages and completed replies remain the worker's conversation
  history; safe interruption context can describe saved work without claiming the
  unfinished text was a final answer.
- Keep actual status authoritative. After Stop show Stopping until the API confirms
  the terminal result; active tools without committed receipts become interrupted,
  not successful checkmarks.
- Keep the composer editable during work and Send disabled under the single-run
  rules. Preserve an uncertain-send retry with its existing key even if the accepted
  run is now visible; do not turn that retry into a second message.
- Track whether the reader is near the bottom. Follow streamed growth only then;
  loading earlier messages preserves scroll position. Offer Jump to latest, keep
  tables contained, and avoid announcing every token through a screen reader.
- Saved-change cards open the associated plan review. Failures offer review and
  deliberate continuation without silently restarting the run.

Exit: UI tests cover older interrupted turns, final-message deduplication, typing
while busy, send retry, scroll anchoring, activity preferences and recovery notices.

## 6. Responsive chat/plan review

- Reuse/refactor the existing web `PlanView`, schedule, workout details, badges,
  coverage and lifecycle controls. Avoid copying the Expo provider or simulation.
- Provide Chat/Plan tabs on narrow screens and a collapsible adjacent review panel
  on wide screens. Preserve usable chat width and use the existing responsive
  design language. Tab activation works with keyboard and tap; swipe is optional.
- Keep the panel open by default when a plan-linked conversation first opens on a
  sufficiently wide screen; remember collapse preference locally. New narrow-screen
  conversations start on Chat. These are reversible layout defaults.
- Show the conversation's associated plan, preferring its editable draft for
  coaching review and otherwise its locked version. Keep any explicit locked-view
  selection stable during live updates. Standalone chats gain plan review only
  after the API confirms association.
- Preserve chat scroll, unsent text, selected week and review scroll through tab
  or panel switches. Browser reload recovers durable chat/run state; persisting
  an unsent composer across reload is not part of the agreed requirement.
- Display net draft differences and a compact summary, with assumptions/pace
  changes and removed workouts. Locking clears pending highlights; historical
  run cards remain available.
- Keep live workout details mounted when their content changes. A removed workout
  shows an explanation and a return action, rather than stale detail or a crash.
- Existing confirmation dialogs continue to own lock/unlock/discard/restore and
  archive actions. No lifecycle action is triggered by a tab switch, coach prose
  or stream event. Preserve active-run restrictions and current review baselines.
- Background updates preserve unsaved human forms and offer Refresh latest. Use
  optimistic-concurrency checks at submission; never silently rebase a human
  confirmation onto newly changed content.

Exit: desktop/narrow-screen walkthroughs show streamed edits, full surrounding
training, working lifecycle dialogs and preserved reading/composition state.

## 7. Integrated verification and release preparation

Run the relevant unit/UI/worker tests, PostgreSQL integration cases and a populated
Phase 5 migration-preservation rehearsal. Extend the existing disposable agent
smoke with streamed output and recovery. Run `pnpm check`, `pnpm test:db` and the
applicable smoke gates after integration. Record commands and actual results;
unrelated prototype failures must be reported without modifying `apps/mobile`.

The signed-in acceptance walkthrough must cover desktop and mobile web, streamed
Markdown, saved edits before final completion, past-turn activity, moves/removals,
assumption/pace changes, partial locking, cancellation after a committed batch,
provider failure after visible text, reload/network loss, another session's edits,
historical-version stability, worker/API restart and cross-account isolation.

Use the T3 collaborative preview for browser work when available. Deterministic
model tests are the primary race/error coverage; a real-provider walkthrough is
the final integration gate, not a substitute for those tests.

Produce a timing report separating model generation, tool/API execution and live
delivery. Keep the current model/reasoning settings. Document missing timing or
token categories explicitly rather than inventing precise attribution.

Release preparation includes a clean implementation diff, generated contracts,
migration checksum, updated runtime/handoff documentation and deployment settings
for streaming. Production rollout remains a separate authorized release step.
Verify proxy delivery/reconnect on Railway before declaring hosted synchronization
complete. All changes to `apps/mobile` remain excluded throughout verification.

## Completion boundary

Phase 6 is complete when the agreed live review experience and recovery checks
pass, including persistence of interrupted output and targeted updates while chat
is closed. This scope does not deliver native API integration,
new model selection, generation-speed optimization or Phase 8 alpha operations.
