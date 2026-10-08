# Coaching worker and authorized domain tools

Current implementation verified 2026-10-06. Phases 5 and 6 are implemented; original delivery gates/results remain in the [archive](../archive/README.md). This document describes accepted coaching behavior and implemented permission boundaries, not a guarantee of every model response.

## Product behavior

The prompt asks the coach to discuss goals, baseline training, schedule and fitness before generating when sufficient context exists. No separate generation button or prior human brief confirmation is required. Human confirmation remains required before locking.

Planning can cover an initial horizon within longer plan dates, then extend after feedback. The coach organises a schedule into blocks by training phase (base, build, peak, taper, recovery) fitted to the plan's length and goal; prompt contract `multisport-coach-v2` added this. `multisport-coach-v3` adds race priorities (A goal race with a taper, B tune-up with easier days, C raced as training) and cutback weeks; each contract change means the API and worker deploy together. Estimates are labelled with provenance/basis and must not be presented as measured evidence. The prompt encourages adaptable methodology, candid clarification/pushback and honest statements about unavailable web search. These are model instructions; API invariants enforce ownership and writes, not the quality of every coaching reply.

Standalone discussion does not automatically need a plan. Clear new-plan intent can create one draft and associate that conversation atomically. Earlier standalone message/run provenance remains unchanged. Existing plan-linked runs cannot create unrelated plans.

## Runtime framework reconsideration

Phase 5 replaced the original Pi runtime with the OpenAI Agents SDK for TypeScript; see [ADR 0003](../adr/0003-coaching-worker.md). `@openai/agents` is pinned to 0.18.0. The current implementation uses direct OpenAI Responses with tracing disabled and `store: false`. It has no coding-agent shell/filesystem/web-search capability.

Defaults are `AGENT_PROVIDER=openai`, `AGENT_MODEL=gpt-6.1-sol` and `AGENT_REASONING=medium`. Configuration accepts OpenAI only; startup validates fields, not remote model availability or every model/reasoning combination. Settings are captured on claim, not user-message acceptance. SDK session state is not authoritative conversation/plan persistence.

## Machine authorization and durable execution

Bootstrap credentials authorize worker registration/claim. Claim issues an opaque run-scoped credential whose digest is stored by the API. Context/tools/progress/heartbeat/finish check the current run, lease, deadline and cancellation; writes also check draft/edit identity inside their transaction. Client tool arguments cannot choose another owner.

The API owns claims, state transitions, receipts and terminal outcomes. One worker process executes one run at a time; database plan/conversation exclusion applies across processes. Heartbeats are 15 seconds, leases 90 seconds, readiness 60 seconds and overall agent deadline 15 minutes from acceptance. The API sweeps at startup/every five seconds. Timing decisions use application-clock timestamps, not exclusively database time.

Queued work survives restart before deadline. Expired running work fails; provider sessions are not automatically replayed. Tool transport retries use identical operation/input identity, at most three attempts for network/server failures. Receipts and successful domain edits commit together. Token/turn/tool limits exist; per-user spend and application rate limits do not.

## Context and tools

| Tool                     | Current permission                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_plan_context`      | Read current authorized plan, brief and coverage                                                                                                                                |
| `read_schedule`          | Read its version's blocks/weeks/workout trees; optional date filtering of workouts                                                                                              |
| `create_plan_draft`      | Create/bind one plan from a standalone run                                                                                                                                      |
| `update_plan_brief`      | Save collected canonical assumptions/dates with concurrency checks                                                                                                              |
| `read_performance`       | Read the athlete's calibration timeline, today and timezone, with or without a plan                                                                                             |
| `preview_performance`    | Calculate zones for a reported result beside current fitness without saving                                                                                                     |
| `record_performance`     | Record race evidence or a labelled threshold estimate for every plan, from today                                                                                                |
| `retract_performance`    | Withdraw a result the user says was wrong; the previous entry applies again                                                                                                     |
| `apply_schedule_changes` | Atomic bounded block/week/workout add/update/move/delete batch; omitted content stays. Every block names its phase, every week whether it is a cutback, every race its priority |
| `replace_schedule_range` | Atomic replacement inside explicit date bounds with coverage intent                                                                                                             |
| `validate_plan`          | Compute current validation/hash/review projection without locking                                                                                                               |

Schedule reads are not paged bounded chunks: filters limit returned workouts but block/week context remains. Conversation history is bounded separately. Current write batches bound blocks/weeks/workouts/steps and total tools; see [runtime limits](../operations/phase-5-runtime.md).

There are no agent tools for confirmation, lock, unlock, discard, restore, activation, archive, SQL, generic HTTP, shell or files. Internal routes delegate to API domain services; the worker uses a hand-written fetch/Zod internal client rather than the generated public browser client.

## Generation and review

Each schedule batch is atomic. The first batch records intended horizon with its edits; later batches cannot silently shorten it. Contiguous completed coverage includes rest days. Cancellation/failure retains saved work and its incomplete horizon. Version-owned coverage participates in cloning/hashing/restore; run metadata describes execution progress separately.

Human review shows assumptions, the athlete's pace guides and estimate provenance, prescribed/unplanned ranges and interrupted generation. Separate confirmation or combined confirmation/lock is available; validation/warnings/concurrency remain server-authoritative. Locking does not require workouts to the plan end. Agents cannot perform lifecycle approval.

Committed changes are visible during work through Phase 6 delivery, not only after final completion. Saved-change cards and interrupted text survive reload. See [live coaching](./phase-6-design.md), [worker operations](../operations/phase-5-runtime.md) and [validation sample](../archive/phase-5/phase-5-validation.md).

## Evidence

[Prompt](../../apps/agent/src/prompt.ts), [configuration](../../apps/agent/src/config.ts), [SDK runtime](../../apps/agent/src/runtime.ts), [internal client](../../apps/agent/src/api.ts), [API authorization/receipts](../../apps/api/src/modules/agent/agent.service.ts) and [schedule commands](../../apps/api/src/modules/agent/agent.schedule.ts).
