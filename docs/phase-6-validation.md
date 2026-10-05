# Phase 6 validation

Implementation prepared for owner review on 2026-10-05, rebased onto merged `main`
at `4c9b41a`, including the Phase 5 production deployment/logging update. This report distinguishes
local verification from live-provider/browser/hosted acceptance.

## Passing local checks

| Command                  | Result                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`             | Formatting, lint, types, 169 unit/UI/worker tests, builds, generated-contract checks, migration checksum and production audit threshold passed                                        |
| `pnpm test:db`           | 71 PostgreSQL cases plus plan-version SQL invariants passed                                                                                                                           |
| `pnpm test:live:upgrade` | All populated Phase 5 tables preserved unchanged; no invented historical output or summaries                                                                                          |
| `pnpm smoke`             | Disposable PostgreSQL/API/web/SDK worker passed; final text and tool activity persisted, partial text survived provider failure, and the public proxy rejected internal worker routes |

Database runs used an isolated Compose project and test port 55433 because another
local stack used the default port. Smoke used a separate disposable project. No
existing development/production database was migrated. Mobile files and its
configuration/dependencies were unchanged.

Regression coverage includes prefix recovery, duplicate/conflicting delivery,
atomic final-message association, terminal/lease fencing, stopping flushes, past
interrupted turns, cross-owner reads, rollback, commit-order replay and cursor
reset. A real HTTP route test uses a Clerk verification stub while exercising
PostgreSQL replay, Authorization enforcement and non-buffered/no-store headers.

SDK tests consume actual streamed Runner events through the pinned deterministic
model harness, including text/tool/text, provider failure after visible output,
cancellation, privacy settings, transport retries and Unicode truncation. Web
coverage includes final-message deduplication, busy composition, view changes,
reading-position-aware growth, fresh-token reconnect, account reset/sign-out and
focused invalidation. Existing lifecycle/concurrency tests continue to pass.

CI now runs the database suite, populated upgrade rehearsal and disposable stream
smoke alongside the existing repository checks. No independent agent review was
requested, as instructed by the owner.

## Measurement evidence

The final disposable smoke recorded a synthetic read-only tool round trip:

| Category                                   | Observed duration                |
| ------------------------------------------ | -------------------------------- |
| Model adapter requests                     | 4.34 ms and 2.00 ms              |
| Tool HTTP round trip                       | 8.37 ms                          |
| First visible model delta                  | 44.41 ms                         |
| First durable output acknowledgement       | 56.75 ms                         |
| Runtime through final output flush         | 56.75 ms                         |
| Progress delivery before measurement write | 19.02 ms total; 10.15 ms maximum |

Three progress batches were persisted. These values exercise the instrumentation
with a scripted model; they are **not** OpenAI generation-speed measurements or a
production latency baseline. The smoke did not write a schedule, so it did not
produce `firstSavedBatchMs`. Categories can overlap and must not be summed as an
exclusive latency breakdown. See the [runtime](./phase-6-runtime.md) for field
semantics and missing-category behavior.

## Outstanding acceptance

`pnpm smoke:agent:live` was attempted with the available local credential and failed
with HTTP 401 (`invalid_api_key`). No successful real-provider streaming or new
real-coaching timing baseline is claimed. Repeat with a valid local OpenAI key;
keep `gpt-6.1-sol`, medium reasoning and `running-coach-v2` for the full walkthrough.
The bounded compatibility smoke intentionally uses low reasoning and synthetic
context, as it did before this phase.

The collaborative T3 preview opened, but navigation to the local Vite server failed
or timed out for loopback and LAN addresses. Consequently no signed-in desktop or
narrow-screen visual walkthrough is claimed for this implementation. Automated
component tests cover the state/recovery behavior; browser layout and signed-in
interaction still need the owner walkthrough.

No Railway deployment or hosted SSE/reconnect verification was performed. Apply
the migration and deploy API, worker, then web in the [runtime rollout order](./phase-6-runtime.md#rollout-order).
Hosted acceptance should cover saved schedule changes before final completion,
Stop after a saved batch, provider failure, reload/network interruption, historical
version selection, another session's edits and cross-account isolation.

The build reports the existing large browser-bundle warning. Production audit
reports eight moderate and one low dependency advisory; its configured high-severity
gate passes. Dedicated optimization remains subsequent work.
