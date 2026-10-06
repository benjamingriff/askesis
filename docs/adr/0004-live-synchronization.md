# ADR 0004: TanStack Query and authenticated replayable SSE

- **Status:** Accepted; updates the initial loader/action data strategy in [ADR 0001](./0001-application-stack.md).
- **Decision checkpoint:** TanStack Query was in place before Phase 6; the live-delivery contract was refined on 2026-10-05.
- **Recorded:** 2026-10-06, retrospectively from the accepted design and implementation.

## Context

Persistent coaching needs streamed assistant output and visible committed plan changes while work continues. Clients must recover after disconnects, preserve human review baselines and isolate cached data by account. Router revalidation alone does not cover those requirements.

## Decision

Keep React Router for navigation and use TanStack Query for browser server state. Each signed-in tab consumes an authenticated SSE connection through `fetch`, allowing bearer-token headers and token renewal. Ordinary HTTP remains the command transport.

Persist visible assistant output in bounded batches and emit owner-scoped resource notifications through a PostgreSQL journal. Notifications identify affected resources; authorized reads remain authoritative for text and plan content. Invalidation targets the changed resource: output and tool activity do not refresh plan reads.

Replay uses an owner-local cursor. A gap or expired replay horizon resets the client to authoritative reads. Connections reconnect with fresh tokens; disconnected active reads temporarily poll. Account changes discard the account's cache and cursor. Reconnection never resubmits a message or restarts model execution.

## Alternatives and scope

The [V1 plan](../product/v1-poc-development-plan.md#current-technical-decisions) retains the current API/PostgreSQL architecture and defers a reactive backend or router/framework migration until evidence justifies it. Polling remains a recovery fallback. The selected SSE transport supports server-to-client updates while keeping commands on HTTP.

Native browser `EventSource` does not provide the bearer-header mechanism used by this client. The implementation uses authenticated fetch SSE rather than putting session tokens in query strings.

## Consequences

The browser sees saved coaching work without manual refresh and can recover accepted output after interruption. This adds journal retention, replay, token refresh and targeted invalidation logic. Notifications do not replace domain transactions, version concurrency checks or human confirmation.

Multiple tabs maintain separate connections. The proxy must support unbuffered event delivery, and reconnect behavior must remain correct across account changes and worker failures.

## Evidence and revisit points

See the [live-coaching contract](../product/phase-6-design.md), [runtime and recovery guide](../operations/phase-6-runtime.md), [validation record](../archive/phase-6/phase-6-validation.md), [account-scoped cache](../../apps/web/src/query-provider.tsx), [client event handling](../../apps/web/src/live.tsx) and [API stream](../../apps/api/src/modules/live/live.routes.ts).

Reassess event fan-out, a reactive backend or a different transport after measured deployment or maintenance needs justify the change.
