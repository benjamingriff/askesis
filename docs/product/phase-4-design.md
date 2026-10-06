# Conversations and durable agent runs

Current behavior verified on 2026-10-06. The original [Phase 4 implementation plan](../archive/phase-4/phase-4-implementation-plan.md) describes the pre-worker checkpoint; production coaching and live delivery are now implemented.

## Ownership and conversation lifecycle

A conversation belongs to one internal athlete and optionally one logical plan. A plan can have multiple conversations; association is not a general reassignment UI. Standalone chat can discuss training and later create one plan through the authorized worker tool. Plan creation can atomically create its first conversation; the API option is explicit, while the web Create a plan flow requests it.

Conversations have display name, stable message ordering and a conversation archive timestamp plus effective archive inherited from its linked plan. Rename does not rewrite message context. Archive preserves history; effective archive blocks new sends. Plan unarchive removes inherited archive status while preserving a chat's own archive timestamp. Owner checks hide other accounts' resources.

The UI has active and archive chat collections. Restoring an archived conversation moves it to the active collection and navigates coherently. Legacy direct links reconcile to the correct collection. No permanent chat deletion is exposed.

## Submission, context and concurrency

A message submission atomically persists one user message and queued run with stable idempotency identity. The run captures current plan/version/edit provenance. Repeated identical delivery returns the original result; a different payload under the same key conflicts. New-chat first send can create its conversation atomically.

Only one active run is allowed per conversation and associated plan. The worker uses this conversation's history plus explicit plan context; other conversations are not implicitly included. It reads at most 60 recent messages and 100,000 content code units and reports truncation. Queued runs have no selected model snapshot until claim; provider/model/reasoning/prompt are attributed at claim.

Execution modes are `unavailable`, development-only `test`, and `agent`. Missing/stale compatible worker readiness rejects a fresh send before orphan messages/runs are persisted. Previously accepted idempotent retries still return their original records. History/organization work while coaching is offline. Production rejects test execution.

## Run states and interruption

Runs progress through queued/running/cancelling to completed/cancelled/failed. Stop requests cancellation; Stopping remains visible until a terminal API outcome. Abort is cooperative, while lease/status checks fence late writes. Saved draft operations remain committed after Stop/failure.

Completion atomically records one final assistant message and terminal status. Failed/cancelled turns retain safe activity and accepted partial output with an incomplete label. These presentation snippets are not completed replies in subsequent model history. Token usage is stored when available; monetary costs are nullable and not calculated.

Queued work can survive restart before its deadline. Expired running work fails without automatic provider-session replay. A new user turn can review saved changes and continue deliberately. See [worker recovery](../operations/phase-5-runtime.md).

## Reads and presentation

Public routes cover conversation lists/detail/rename/archive/open, paged messages, run status/events/cancel, conversation run-turn history, individual turn and output. Exact contracts are in [OpenAPI](../../packages/api-client/openapi.json); there is no implemented `/agent-runs/:runId/changes` route, because saved changes are part of the turn projection.

Assistant content renders safe CommonMark/GFM, including contained tables. User content remains literal. Activity and saved-change cards belong to each turn. Healthy authenticated live delivery updates the UI; disconnected active reads use three-second fallback refresh rather than the original constant Phase 4 polling. See [live review](./phase-6-design.md).

Evidence: [chat service](../../apps/api/src/modules/chat/chat.service.ts), [chat routes](../../apps/api/src/modules/chat/chat.routes.ts), [agent service](../../apps/api/src/modules/agent/agent.service.ts), [chat route UI](../../apps/web/src/routes/chat.tsx) and [database tests](../../apps/api/test/db/chat.test.ts).
