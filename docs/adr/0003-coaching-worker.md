# ADR 0003: Private coaching worker with API-authorized domain tools

- **Status:** Accepted; supersedes the Pi worker choice in [ADR 0001](./0001-application-stack.md).
- **Decision checkpoint:** Phase 5 refinement, 2026-10-01.
- **Recorded:** 2026-10-06, retrospectively from the accepted design and implementation.

## Context

Askesis needs long-running conversational coaching that can create and change plan drafts, survive browser disconnection and keep plan authorization and transactions in the core API. The initial stack named Pi as the future worker runtime; Phase 5 reassessed that choice before implementing real coaching.

## Decision

Run an independently deployed private TypeScript worker using the OpenAI Agents SDK. The SDK owns the model/tool loop; Askesis owns durable conversations, runs, claims, leases, cancellation and domain state. Model and reasoning settings remain worker configuration; the current provider setting accepts OpenAI only.

Expose narrowly defined domain tools through the core API. The API derives ownership from the claimed run, enforces draft and concurrency rules, and commits tool receipts with accepted changes. The worker receives scoped machine credentials and provider credentials, never PostgreSQL or Clerk secret credentials. Human confirmation, locking and unlocking remain application actions outside agent permissions.

## Alternatives considered

The [Phase 5 design](../product/phase-5-design.md#runtime-framework-reconsideration) assessed Pi, the OpenAI Agents SDK, Claude Agent SDK and Codex SDK/app-server. The accepted choice uses an embedded model/tool loop while keeping application state, approval rules and deployment under Askesis control. Coding-agent runtimes were not needed for the domain-tool workflow.

Direct database access was excluded by the established API ownership boundary, which this decision preserves.

## Consequences

The worker can deploy independently and continue accepted work after a client disconnects. The API remains authoritative for every plan mutation and run permission. Durable claims, fencing, idempotent tool receipts and bounded execution require application code; the SDK does not replace those controls.

Changing providers requires compatibility verification, and changing SDKs must preserve the run lifecycle and domain authorization. Worker restart or reconnect must not silently replay an entire model session.

## Evidence and revisit points

See the [coaching contract](../product/phase-5-design.md), [worker operations](../operations/phase-5-runtime.md), [validation record](../archive/phase-5/phase-5-validation.md) and [runtime implementation](../../apps/agent/src/runtime.ts).

Revisit the runtime when measured provider limitations or coaching needs justify a change; preserve the API boundary and human review rules.
