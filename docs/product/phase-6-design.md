# Live coaching and plan review

Current behavior verified 2026-10-06 against the streaming worker, live API, account-scoped query client and chat/plan UI. Phase 6 is complete by the owner's confirmation; [historical validation](../archive/phase-6/phase-6-validation.md) distinguishes recorded local checks from that acceptance.

## Live conversation

Visible assistant text arrives while the model works. Intermediate commentary and final reply remain identifiable within one assistant turn, alongside actual tool activity and saved-change cards. Provider reasoning, raw tool arguments and full tool results are not user-visible activity.

Assistant Markdown supports contained tables. The composer remains editable during work; Send respects the single-active-run rule. Stop becomes Stopping until the API confirms the terminal outcome. Committed edits remain saved. Failed/cancelled text is retained as incomplete after reload and is not passed to the model as a completed answer.

The transcript follows growth only while the reader is near the bottom, provides Jump to latest and preserves position when loading older messages. Switching review tabs/panel keeps composition and reading state. Unsent text across a complete browser reload is not persisted by this contract.

## Saved state and changes

Live notifications identify owner-scoped resources to refetch. They do not contain model text or authoritative plan payloads. Text/activity refresh their turn; plan/version writes refresh affected version-aware plan reads. Other sessions' committed changes are visible without reopening chat. Replay/reset and HTTP snapshots recover after disconnect; reconnection never resends commands or restarts the model.

Current draft differences compare lineage against the current locked version, or an empty baseline for the first draft. They distinguish Added, Changed, Moved and Removed; a moved workout may also be changed. Assumptions/calibration guidance changes are separate. Restored drafts compare with the current lock. Lock clears current pending highlights while retaining historical run cards.

Per-run cards summarize net committed changes: an addition/removal within one run cancels out, repeated edits count once and moving back can eliminate a net move. Later edits by other runs do not rewrite older cards. Legacy runs have generic truthful change indications rather than invented detail.

## Responsive review

From 1,450 px, an associated plan appears beside chat with a locally remembered hide/show choice. Narrower layouts use Chat/Plan tabs beneath the conversation header with pending-change count. The panel reuses PlanView, schedule, workout details and lifecycle dialogs; it does not run the mobile dummy data provider.

Associated review prefers a draft for coaching while preserving explicit locked/history selections. Standalone chats gain review after the API confirms a plan association. Embedded coach shortcuts fill the current composer. Saved updates keep an open workout selected; removed workouts show a removal explanation and return action.

Human forms retain their original review/concurrency baseline and offer explicit refresh. A live event, tab switch or coach sentence cannot approve lifecycle changes. Active-run and archive restrictions still apply. The known Plan-tab form-unmount edge case is documented in [lifecycle guidance](./phase-2-plan-lifecycle-refinement.md#limits-and-evidence).

## Delivery and measurements

The worker batches bounded accepted output durably. Each signed-in tab uses authenticated fetch SSE with fresh-token reconnection, owner-local replay and disconnected fallback reads. Account changes clear cache/cursor. nginx is configured for unbuffered proxy delivery. Exact bounds, retention, routes and rollback order are in [live runtime](../operations/phase-6-runtime.md).

Timing records distinguish queue wait, model stream duration, tool HTTP duration, first visible/accepted output, first saved schedule batch and runtime duration. Categories can overlap and do not measure browser paint. Provider failure/worker loss can leave missing usage or final timing. Synthetic smoke timings are instrumentation evidence, not production model-latency measurements.

The model/default reasoning/prompt remain those from Phase 5. Dedicated generation-speed optimization, native integration and Phase 8 release operations are subsequent work. Continued responsive web development is the current priority.

## Evidence

[Streaming runtime](../../apps/agent/src/runtime.ts), [output batching](../../apps/agent/src/progress.ts), [live API](../../apps/api/src/modules/live/live.routes.ts), [live browser client](../../apps/web/src/live.tsx), [query provider](../../apps/web/src/query-provider.tsx), [draft comparison](../../apps/api/src/modules/plans/plan.aggregate.ts) and [chat components](../../apps/web/src/components/chat/).
