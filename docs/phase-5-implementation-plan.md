# Phase 5 implementation plan

## Status

**Implementation built locally; deterministic verification passes, 2026-10-01.** Implements the [refined design](./phase-5-design.md). Product discussion is complete: use an independently deployed worker with the OpenAI Agents SDK, initially OpenAI/GPT-6.1 Sol, and retain the core API as the authority for plan mutations and durable runs.

The implementation is now present on `phase-5-coaching-worker`. This document retains the required delivery and acceptance gates. The live-provider gate remains pending credentials; see the current handoff and runtime guide for actual verification results. Deployment is not authorized by this implementation checkpoint.

## Stage 1: reconcile the current implementation and SDK

Current repository seams inspected during refinement:

- `apps/api/src/modules/chat/chat.service.ts` owns durable submission, state transitions, and development execution. Machine claim/heartbeat/completion endpoints do not exist.
- `apps/api/src/config.ts` and the capability route currently support `unavailable|test`; production rejects test execution.
- `apps/api/src/auth/middleware.ts` authenticates `/api/v1/*` using Clerk human sessions. Worker authentication must be a distinct boundary.
- `apps/api/src/modules/plans/brief.service.ts` provides brief confirmation and deterministic calibration commands with draft edit checks.
- `apps/api/src/modules/plans/plan.service.ts` provides aggregate lifecycle, validation, idempotency, and history. Reuse its domain rules rather than duplicate them in the worker.
- `apps/api/src/modules/workouts/workout.routes.ts` currently exposes reads. Generation still needs shared domain mutation commands for blocks, weeks, and complete workout trees.
- API readiness currently requires migration `20260910120000`.

Read the final Phase 3/4 contracts and current handoff before editing. Confirm the actual branch still matches these observations.

Inspect and pin the current OpenAI Agents TypeScript SDK. Verify GPT-6.1 Sol configuration, Responses tool calling, reasoning settings, abort behavior, serialized tool mutations, turn limits, event hooks, and tracing controls. Default SDK tracing must not export complete prompts, private plan context, or tool payloads contrary to the repository's observability contract. Use an explicit tracing policy before the first real run.

Build a small runtime proof using fake model/tool responses first. Use a provider-backed local smoke only once configuration and credentials are available, with a bounded request. Preserve the selected model; compatibility failure must not silently route to a substitute.

Exit: the chosen SDK's configuration and event/cancellation mapping are concrete, with an adapter that can be exercised independently of persistence. Record material incompatibilities in the design.

## Stage 2: schema and durable execution services

Use append-only Atlas migrations preserving all current data. Add the design's worker registration/liveness, claim lease and fencing generation, hashed run credentials, runtime configuration attribution, idempotent tool receipts, and bounded tool event metadata. Keep core plan content relational.

Add explicit prescribed coverage and generation/review basis to the versioned aggregate, plus estimate provenance to calibration. Decide the smallest relational representation that handles partial horizons, trailing rest days, and range replacement. Copy it during unlock and restore, include it in content hashing and summaries, and update any content-schema/validator versions accordingly.

Legacy data must not be declared fully planned merely because it has a final workout. Treat absent coverage provenance as unknown and retain existing content. Migrations require no plan reset and must not change historical prescriptions or calibration numbers.

Implement atomic claim, heartbeat, expired-lease/deadline cleanup, cancellation acknowledgement, failure, and final completion around the existing transitions. Preserve plan/conversation/run lock order and active-run uniqueness. Separate the production sweeper from the development test executor.

Exit: database-backed tests prove single claiming, expired-worker fencing, terminal immutability, and cleanup with no worker running. Existing Phase 4 lifecycle tests continue passing.

## Stage 3: private worker API and machine authentication

Introduce a private machine-authenticated namespace, for example `/internal/agent`. Keep it outside human Clerk middleware and public nginx proxying. Validate server credentials without logging them; issue scoped run credentials on claim and store only their digests.

Expose registration/readiness, eligible-run claiming, context/history reads, lease heartbeat, domain tools, cancellation acknowledgement, failure, and final completion. Bound pages, request bodies, event metadata, and assistant output. The API derives owner and target from the claimed run; tool inputs cannot choose arbitrary ownership.

An expired or revoked credential cannot read context, call tools, or declare completion. Bootstrap authority can register/claim but does not directly read arbitrary plans. Validate capability and configuration compatibility before dispatch.

Define typed contracts/OpenAPI for worker operations and reuse the shared generated client where appropriate. Distinguish machine and human principals in types; never synthesize a Clerk session for a worker. Keep error bodies safe and stable.

Exit: route tests prove browser credentials cannot invoke worker transitions, run credentials cannot escape their run/plan, and invalid credentials reveal no private context.

## Stage 4: domain mutation tools and conversational creation

Implement the design's context reads, new-plan creation/binding, brief/date update, calibration, schedule change/range replacement, and validation commands. Share transaction-level domain logic with human routes. Every write includes a stable operation key, current lease, explicit target version, and expected edit number.

Reuse workout-tree schemas and existing structural validation. Batch related block/week/workout edits into a coherent transaction. Avoid writing each workout step independently. An invalid batch must leave no partial structure, edit increment, receipt, or successful tool result.

Commit a tool receipt, audit result, and edit-number update with its domain changes. If a response is lost, identical replay returns the committed result before rechecking the original expected edit number. Different input under the same operation identity conflicts. Retain receipts after draft discard without creating foreign keys that prevent the existing discard semantics.

New-plan binding must create the draft, associate the conversation, and extend that run's allowed target atomically. Record transition provenance without rewriting earlier standalone messages or the immutable initial run context. Concurrent/idempotent calls must create exactly one logical plan.

Distinguish run-scoped machine mutation authority from general plan lifecycle authority. The worker's own active run may perform its authorized draft edits; this must not bypass archive, lease, cancellation, or optimistic concurrency checks. Locked content remains read-only.

Exit: integration tests prove range isolation, full workout-tree validity, retry safety, preserved unrelated workouts, authorization, and stale-draft rejection.

## Stage 5: worker and coaching loop

Create `apps/agent` with its own package, Dockerfile, environment validation, scripts, tests, and shutdown handling. It receives the private API URL, bootstrap machine credential, and provider key, never `DATABASE_URL` or `CLERK_SECRET_KEY`.

Implement one execution slot, readiness heartbeat, queued-run polling, lease renewal, bounded context assembly, and an SDK adapter using `gpt-6.1-sol` with configurable reasoning. Keep API authority in tool handlers; SDK guardrails are not substitutes for API authorization.

Version the initial coaching system prompt. It must implement the accepted discussion-first generation, adaptable methodology, candid pushback, flexible planning horizon, labelled estimated paces, and invitation to refine after early run feedback. Generation may precede human brief confirmation, but the agent must never confirm or lock for the user.

Read the current conversation and structured plan context. Other chats are excluded by default. Maintain updated edit numbers after own tool operations; a conflicting external edit must be explained without silently changing targets or replaying mutations.

Map SDK output/tool events to safe API records. Abort on cancellation, lease loss, shutdown, or deadline. Handle provider errors and limit exhaustion as explicit terminal outcomes; report committed changes independently of whether a final reply was produced.

Exit: deterministic worker tests exercise read-only discussion, generation, revision, cancellation, provider errors, and lost tool responses. A bounded real-model smoke proves tool calls work with the selected API model; mocks alone cannot close this stage.

## Stage 6: capabilities and human journey

Extend chat execution modes and capabilities with worker readiness and `agent`. Missing/stale readiness disables fresh submissions before persistence; previously accepted idempotent retries still return their original records. Keep production test-mode rejection.

Make Create a plan open a newly created draft's chat using the existing atomic option. Support conversational creation from a standalone chat when intent is clear. Preserve generic training discussion without automatically creating unwanted plans.

Add limited review presentation for current assumptions, estimate provenance, and prescribed coverage. Keep separate brief confirmation and support combined human brief confirmation/lock with current hashes, edit numbers, validation, and warning acknowledgements. Errors leave the draft recoverable; a combined command is idempotent and must not partially lock.

Invalidate affected plan queries after tool operations/completion. Preserve Phase 4 polling, account isolation, and archive behavior. Show committed changes and safe failure/cancellation summaries. Broad UI polish and streaming remain later work.

Exit: UI tests and a signed-in walkthrough prove natural discussion, partial-horizon generation/locking, extension in a new revision, current-context review, and coherent failure recovery.

## Stage 7: final verification and operational handoff

Run the required repository checks against the final integration:

```bash
pnpm check
pnpm test:db
pnpm smoke
```

Extend scripts to cover the worker and relevant generated contracts. Verify migrations on both an empty database and a populated Phase 4 fixture without resetting plan data.

Required acceptance scenarios:

| Scenario                                               | Required behavior                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Initial user message lacks planning context            | Focused discussion; no immediate schedule generation.                                                   |
| Conversation supplies enough context                   | Agent generates without a separate generation button.                                                   |
| User has no measured pace evidence                     | Estimate is clearly labelled in chat and review, with persisted origin.                                 |
| User chooses one month within a longer plan            | Lock succeeds with current brief confirmation; remaining unplanned period is visible.                   |
| Later feedback and extension                           | Human unlock, authorized draft changes, and a new immutable revision; prior revision remains readable.  |
| Agent attempts confirmation or lifecycle transition    | No such tool authority; API rejects unauthorized execution.                                             |
| Two workers claim the same run                         | One owner; the other cannot execute it.                                                                 |
| Lease expires while the model is working               | API cleanup releases the run slot; late worker cannot mutate or complete.                               |
| HTTP tool response is lost after commit                | Same operation identity returns its receipt; no duplicate workouts.                                     |
| Multi-workout batch is invalid                         | Entire batch rolls back.                                                                                |
| Cancellation races a mutation or completion            | Transactional winner is respected; no writes after effective cancellation and no duplicate final reply. |
| Human edits between worker operations                  | Conflict is explicit; no silent overwrite or retargeting.                                               |
| Worker restarts or all workers are offline             | Queued work survives; expired running work terminates without automatic replay.                         |
| Intended partial horizon versus interrupted generation | User can tell which occurred; intended coverage is not silently shortened.                              |
| Draft discarded after terminal work                    | Chat, run, and tool attribution survive.                                                                |
| Worker not ready                                       | Fresh sends persist no orphan work; accepted retries remain idempotent.                                 |
| Account/archive/version isolation                      | Existing hidden-not-found, read-only, and immutable-history behavior remains intact.                    |

Also exercise standalone-to-plan binding, estimated calibration replacement, combined/separate brief review, effective-dated paces, and range-generation provenance. Inspect worker/API logs, Sentry, and SDK tracing for credentials, prompts, and private plan payloads.

Prepare Compose/local setup and a Railway private-worker deployment guide. Document environment settings, readiness, graceful shutdown, migration order, restart behavior, and user-visible limitations. Deployment is a separate release step; do not push `main` merely to close this planning task because Railway automatically deploys it.

Record checks actually run, the chosen SDK version, real-model smoke results, migrations, and accepted limitations in the handoff. Do not mark Phase 5 implemented until real coaching and domain-tool behavior have been verified.
