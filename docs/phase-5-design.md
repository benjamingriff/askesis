# Phase 5: coaching worker and domain tools

## Status

**Product refinement complete; implementation contract proposed, 2026-10-01.** This document refines Phase 5 of the [accepted V1 roadmap](./v1-poc-development-plan.md), building on the deployed [Phase 4 contract](./phase-4-design.md). The product decisions were discussed with the user; engineering defaults below are delegated choices. Delivery stages are in the [implementation plan](./phase-5-implementation-plan.md). No application implementation or deployment is included in this refinement.

The user requested refinement one question at a time. Ordinary implementation choices and obvious defaults are delegated; decisions involving taste or substantial product impact should be brought to the user. Record accepted decisions and distinguish provisional defaults from explicit user choices.

## Inherited scope and boundaries

- Invitation-only, running-only alpha with plan-specific assumptions and calibration.
- A separate agent worker calls the core API; only the API accesses PostgreSQL. The worker receives scoped machine and provider credentials, never database or Clerk secrets. Use the OpenAI Agents SDK for TypeScript as the working runtime choice following the framework discussion and architecture clarification below.
- Chat is the primary plan-editing interface. The structured brief remains authoritative and requires human confirmation.
- Agents may edit an authorized draft in response to user requests. Locking and unlocking remain human-only; the original roadmap's `lock_plan` example is superseded.
- Completed tool operations are atomic and remain committed after cancellation or failure. Runs and their operations remain attributable and auditable.
- Phase 4 supplies durable conversations, run states, cancellation, and plan concurrency guards. Phase 5 must define worker authentication, claims, lease ownership, restart recovery, and authorized mutation tools.
- Live token streaming and broader synchronization remain Phase 6.

## Coaching methodology and system prompt

**User decision, 2026-10-01:** use an adaptable, evidence-informed running coach as the default. It chooses an approach suited to the plan brief, explains major choices, and responds to the user's methodology preferences. Existing pace guides inform prescriptions without fixing the entire training philosophy.

Define this coaching behavior in a system prompt. A hard-coded prompt is sufficient for alpha. Future advanced settings should let users update the coaching prompt; configurability is an intended product direction, not an alpha UI requirement.

Implementation default: keep the coaching prompt separate from API-enforced authorization and lifecycle rules. Future prompt customization cannot grant tool permissions or replace human-only confirmation actions.

**User decision, 2026-10-01:** the coach should candidly challenge goals or requested approaches it considers unrealistic, explain its concerns, and propose alternatives. The user remains in control of the plan's direction. The coach must not silently replace the agreed goal or preferences.

## Methodology research

The user wants eventual web search when discussion of a specific methodology requires external information, and suggested that this may be beyond V0/alpha.

**Provisional scope default:** defer web search from alpha. The coach should acknowledge uncertainty and ask for clarification or reference material when it lacks reliable knowledge of a named methodology. It must not claim to have searched or verified sources. Adding retrieval tools and their source-handling behavior is future refinement work.

## Discussion and schedule coverage

**User decision, revised 2026-10-01:** plan creation begins with a discussion to develop the requirements. The first exchange must not immediately generate a schedule. At the appropriate point in that discussion, the agent generates a detailed programme for the agreed planning horizon. This may cover the whole plan or only an initial period, such as the first month. Subsequent discussion can refine or extend it, including substantially changing the generated programme.

**User clarification:** generation should be natural and agent-led. The agent judges when enough context exists to generate; users need not select an action or issue an explicit generation command. Generation is an editable proposal and does not imply that the discussion is finished. This supersedes the proposed separate “Confirm brief and generate plan” action and the assumption that brief confirmation must precede generation.

**User decision superseding the earlier full-coverage preference:** workouts need not be prescribed through the plan's end date before locking. A user may lock an initial month, gather feedback from those runs, then unlock, extend the programme, and lock a new revision. Generation and locking are separate actions; locking does not start generation or grant the agent locking permission.

“Schedule complete” previously meant planned workouts covering the entire start-to-end date range, not completed workout performance. That is no longer a lock requirement or a mandatory generation target. Deliberately planning a shorter period is a supported workflow, not an execution failure.

Implementation defaults:

- Keep the overall plan dates separate from the horizon currently prescribed. An initial month of workouts need not shorten a longer-term plan or its goal.
- Show the intended prescribed-through date and the remaining unplanned period in plan and lock review. Use explicit planning coverage rather than assuming that the date of the last workout proves completeness; rest days may follow it.
- The agent chooses an appropriate horizon from the conversation and explains it. Do not impose a month-long horizon on every plan or require a special command to select one.
- Validation still checks the content being locked, current brief confirmation, and existing warning acknowledgements. Do not add a full-date-range coverage gate. Existing empty-schedule warning behavior remains available.
- Extending a locked programme uses the existing human unlock and revision workflow. Preserve earlier prescriptions unless the user requests changes; recording performed workouts remains outside Phase 5.
- Report the difference between an intentionally short planning horizon and generation that stopped unexpectedly. Run failure or cancellation must not silently redefine the intended coverage.

## Brief and schedule review

### Terminology clarification

- **Brief:** the structured inputs used to design the plan: goal, units, timezone, current weekly distance, current run frequency, longest recent run, desired frequency, weekday availability, and optional constraints/context. Start/end dates are stored on the plan version; fitness calibration is a related input included in brief confirmation.
- **Schedule:** the dated training prescription, including blocks, weeks, and workouts with their steps and targets.
- **Plan:** the whole versioned aggregate, including the brief, dates, calibration, and schedule. Existing plan locking freezes that aggregate together.

The existing separate brief action is **confirmation**, which later semantic edits invalidate. Describing it as a separate lock prematurely implied a new immutable state.

**User decision after terminology clarification, 2026-10-01:** confirming the brief means reviewing the assumptions. This can happen separately from reviewing and locking the current programme, or as part of that lock review. Plan locking freezes the inputs and training programme together. No separate brief freeze/unlock mechanism or independent version history is introduced. Do not impose a fixed conversational sequence.

The agent can revise assumptions in the editable draft as the conversation develops. Semantic changes invalidate prior brief confirmation under the existing domain rules. The current assumptions require human confirmation before plan locking; the final lock review may combine those human actions. The agent cannot confirm the brief or lock the plan on the user's behalf.

The existing implementation versions the brief, calibration, and workouts as one aggregate. Combined confirmation and locking must use the reviewed current content and current warnings, preserving the API's human authorization and concurrency checks.

## Missing fitness evidence

**User decision, 2026-10-01:** when a user lacks a recent race result or known training paces, the coach should develop estimated pace targets from the conversation and prompt the user for their own estimate and relevant context, including age where useful. Explain explicitly that these are estimates and that the plan can and should be updated after the user has completed a few runs.

Implementation defaults:

- Gather available evidence such as recent running, remembered times, comfortable pace, and the user's own estimate. Age may be context; it must not be presented as sufficient evidence for precise personal fitness targets.
- Explain the basis and uncertainty of the estimate in the conversation and retain its estimated origin in persisted calibration provenance and the plan review. Do not present an agent estimate as a measured race result.
- Use the existing estimated-threshold calibration path where suitable. The API's deterministic calculator derives the pace guides; the agent does not bypass it by writing arbitrary guide values.
- An estimate is a real proposed planning assumption for the user to review, not a fabricated value inserted merely to pass validation. If context is too thin to support a useful estimate, ask focused follow-up questions.
- In alpha, invite the user to return with times, distances, and how the first runs felt through chat. Automatic workout ingestion and wearable integrations remain outside this phase.
- Subsequent evidence may revise the calibration and future prescriptions in the editable draft, using existing effective-date rules. A locked plan still requires human unlock before these changes; reconfirmation and relocking remain human actions.

## Interaction defaults

These are delegated implementation defaults, not additional user approval gates:

- Ask focused questions using the context already available. Avoid re-asking answered questions or enforcing a fixed questionnaire.
- Explain the proposed training approach and planning horizon naturally. Generation and refinement may proceed within the authorized draft without approval for each workout.
- Finish a successful editing run with a concise account of the changes, their reasons, and a route to review the programme. Do not repeat every workout in chat when the plan view already presents it.
- Distinguish discussion from an instruction to change something. When user intent or a consequential assumption is ambiguous, ask a focused question before making the corresponding change.
- Show safe progress and failure summaries using durable run events. Retain Phase 4 polling for alpha; do not expand Phase 5 into token streaming.

## Model configuration

**User decision, 2026-10-01:** start with OpenAI and GPT-6.1 Sol. Make configuration easy to change so the operator can experiment with models.

The [official OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol), checked 2026-10-01, specifies the API identifier `gpt-6.1-sol`, Responses API tool calling, and reasoning efforts `low`, `medium` (default), `high`, `xhigh`, and `max`.

Implementation defaults:

- Use worker environment settings `AGENT_MODEL_PROVIDER=openai`, `AGENT_MODEL_ID=gpt-6.1-sol`, and `AGENT_REASONING_EFFORT=medium`. Document local `.env` and Railway configuration with examples. These settings are independent of the coaching prompt and domain rules.
- Route OpenAI tool calls through a Responses-capable runtime adapter. Verify the chosen SDK and pinned package's model configuration before implementation handoff. Do not silently substitute another model.
- Validate the provider/model and reasoning combination at worker startup. A configured model change applies to subsequent runs, not midway through an active run.
- Record the effective provider, model, reasoning effort, and coaching prompt version on each run for comparison and attribution. Record usage and cost when available; do not log provider credentials or complete prompts.
- Keep initial configuration deployment-wide. Advanced user prompt settings and a user-facing model selector are separate future features.

## Runtime framework reconsideration

**User direction, 2026-10-01:** reconsider Pi, evaluate an Agents SDK, and inspect T3 Code's open-source patterns. The OpenAI/GPT-6.1 Sol starting model preference remains in place; a runtime or routing-provider change is not yet selected.

Inspected [T3 Code](https://github.com/pingdotgg/t3code) at commit `5cc99e1c23980d7995a13c47f969b47cb68ed1be`. Relevant findings:

- Its [provider adapter contract](https://github.com/pingdotgg/t3code/blob/5cc99e1c23980d7995a13c47f969b47cb68ed1be/apps/server/src/provider/Services/ProviderAdapter.ts) separates session/turn operations, interruption, capability discovery, and normalized runtime events from provider implementations.
- The Claude integration uses `@anthropic-ai/claude-agent-sdk`; see [ClaudeAdapter](https://github.com/pingdotgg/t3code/blob/5cc99e1c23980d7995a13c47f969b47cb68ed1be/apps/server/src/provider/Layers/ClaudeAdapter.ts).
- The Codex integration wraps Codex app-server through its typed `effect-codex-app-server` client; see [CodexAdapter](https://github.com/pingdotgg/t3code/blob/5cc99e1c23980d7995a13c47f969b47cb68ed1be/apps/server/src/provider/Layers/CodexAdapter.ts).
- [Provider runtime ingestion](https://github.com/pingdotgg/t3code/blob/5cc99e1c23980d7995a13c47f969b47cb68ed1be/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts) maps runtime activity into application orchestration and persisted projections.

These are useful patterns for Askesis. They do not require adopting T3's full server, Effect stack, coding tools, or persistence design. Prefer a small runtime interface and normalize model/tool lifecycle events into Askesis's existing run contract.

**Working choice following the discussion and user acceptance of the architecture:** use the OpenAI Agents SDK for TypeScript inside `apps/agent`, initially through OpenAI directly. The [SDK documentation](https://developers.openai.com/api/docs/guides/agents/sdk) describes precisely the separation needed here: application-owned deployment, tools, state, and approvals, with an SDK-managed agent loop. Preserve the core API as the authority for scoped mutations, transactions, run claims, and restart recovery.

Distinguish runtime options:

- **OpenAI Agents SDK:** a general model-and-tool agent loop embedded in our worker. Strong candidate for a coaching agent using narrowly defined domain tools. [Models/providers](https://developers.openai.com/api/docs/guides/agents/models) are configurable; cross-provider adapters still require compatibility verification.
- **Claude Agent SDK:** Claude Code's runtime as a library, including custom MCP tools, session/context features, and built-in coding tools. Technically viable for coaching with a restricted tool set, but not the direct route to the selected OpenAI model. See [overview](https://code.claude.com/docs/en/agent-sdk/overview) and [custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools).
- **Codex SDK/app-server:** programmatically controlled Codex runtime. Technically viable with domain tools exposed through MCP or supported custom-tool integration, but adds process/session integration and coding-runtime defaults. See [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) and [app-server](https://learn.chatgpt.com/docs/app-server). App-server dynamic tools are currently experimental.
- **Pi:** remains an alternative for an embedded agent loop with provider abstraction. No Askesis worker implementation exists yet, so changing frameworks is a design choice rather than a migration of running worker code.

Before a final framework handoff, specify context ownership, cancellation mapping, tool-event attribution, SDK tracing treatment, and recovery behavior. Provider-native history or SDK run state must not become an alternative authoritative plan store.

## Spend controls and routing

**User direction, 2026-10-01:** defer selecting or configuring a spend ceiling. Discuss provider-side controls and OpenRouter as options; do not block refinement on a budget answer.

Verified options:

- [OpenAI spend controls](https://developers.openai.com/api/docs/guides/spend-limits) support alerts and explicitly enforced monthly project/organization limits. Alerts alone do not stop requests. Hard-limit enforcement may slightly overshoot while usage tracking propagates. A dedicated Askesis API project is a suitable place for operator-managed spend controls.
- [OpenRouter API keys](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key) support USD spending limits with daily, weekly, or monthly resets. OpenRouter provides model routing and [lists GPT-6.1 Sol](https://openrouter.ai/openai/gpt-6.1-sol); its [pricing](https://openrouter.ai/pricing/) includes platform fees.
- Framework choice and inference routing are separate. An OpenAI Agents SDK integration may use a compatible alternate model provider, but OpenRouter compatibility with the exact SDK, Responses/tool flow, reasoning settings, and event mapping must be verified before committing to it.

Working default: start with a dedicated OpenAI API project and keep the provider adapter replaceable. Add OpenRouter if centralized cross-vendor experimentation becomes useful. Retain bounded execution and usage attribution in Askesis even when aggregate spend is controlled at the provider.

## Execution limits

Per-run time, token, and tool-operation limits, cancellation, and bounded retries remain reliability requirements. Operational defaults are delegated. Aggregate monetary ceilings and their configuration are deferred at the user's request; usage/cost attribution remains in scope.

## Worker architecture

**User-confirmed architecture:** independently deploy the private `apps/agent` worker. The web submits messages to the core API, which persists a run before execution. The worker claims committed work through the API, invokes OpenAI through the Agents SDK, and uses API-backed tools. The web continues observing the API's durable messages and run state.

An internal runtime module isolates SDK-specific calls, events, and cancellation from coaching tools and run coordination. This is a code boundary inside the worker, not an additional service. Start with one coaching agent and one runtime implementation; no generic multi-runtime platform or additional specialist agents are required.

Implementation defaults:

- Add `CHAT_EXECUTION_MODE=agent`, preserving `unavailable` and local-only `test`. Production continues to reject `test`.
- Start with one active execution per worker process and API polling for queued work. PostgreSQL's run rows remain the work queue behind the API; no broker is needed for alpha.
- Have the worker register its effective model/prompt configuration and refresh a liveness heartbeat. The API advertises agent execution only while an eligible worker is ready. Do not allow browser sends to create work indefinitely while no executor is available.
- Snapshot the selected configuration for a run so an operator change does not silently alter accepted work. Reject or clearly fail work whose required configuration is no longer available.
- The SDK receives the run-scoped context and tools. SDK session storage does not replace the API's conversation history or plan state.

## Machine authorization and run ownership

Use a machine-authenticated private route namespace, distinct from the Clerk-authenticated human API. A proposed namespace is `/internal/agent`; do not proxy it through public web nginx. Machine credentials must never be accepted as human session credentials, and browser sessions must not grant execution-transition authority.

A worker bootstrap credential grants registration and atomic claiming of eligible queued runs. Claim returns a short-lived, opaque run credential scoped to the stored owner, conversation, target plan/version, and lease generation. Store only its digest in the API. Tool arguments cannot select a different owner or escape that context. A standalone run has no plan permissions until the authorized new-plan binding command commits.

Every context read, tool command, heartbeat, and completion validates its run credential and current lease. All mutations also recheck cancellation, deadline, effective archive state, version identity, and expected draft edit number in the transaction. A lease generation acts as a fencing token: a worker whose lease expired cannot write even if its model call later returns.

Starting operational defaults, adjustable after local testing:

- Worker/run heartbeat every 15 seconds; run lease expires after 90 seconds without renewal.
- API considers worker availability stale after 60 seconds without a readiness heartbeat.
- Overall run deadline of 15 minutes, persisted on acceptance; preserve short deterministic deadlines for the test executor.
- At most 40 SDK turns and 200 domain tool operations per run, with bounded model output and context size. A turn limit alone does not bound parallel tool calls; serialize draft mutation tools.

Use database time for lease/deadline decisions. Claim and terminal transitions follow the existing lock order of plan, conversation, run. The same queued run must never be returned successfully to two workers.

## Recovery, cancellation, and retry policy

- Queued work survives an API or worker restart and can be claimed before its deadline.
- In alpha, an expired running lease fails the run with a safe interruption code. Do not automatically replay an interrupted model/tool loop. Completed operations remain committed; the next user turn can inspect them and continue.
- On cancellation, abort the SDK/model work cooperatively and stop future mutations. The API's transactional status check provides the final guard even if abort is delayed.
- The API sweeps expired leases and overdue runs, including on startup. Cleanup must work even when every worker is offline. Timed-out cancellation releases the active-run slot without accepting a late completion.
- Reuse the same tool-operation idempotency key and input after an uncertain HTTP response. Read the committed receipt rather than repeat a mutation under a new key. Bind receipts to run, tool operation, and input hash, and commit them with the domain change and audit result.
- Bound transport retries and transient provider retries. Never restart a whole failed run automatically or silently change the model. Retry provider requests only before accepting a result and respect the overall deadline.
- Completion records one final assistant message, terminal run state, and terminal event in a shared API transaction. Partial model text is not a final reply.

## Context and tools

Use the current conversation's transcript and explicit plan context. Preserve the accepted Phase 4 rule that other conversations are not implicitly included. Structured context carries the current brief, dates, calibration/estimate provenance, plan state, draft edit number, planning coverage, and relevant programme content. Read large programmes in bounded sections; never silently omit the latest user message or governing plan assumptions to fit a context limit.

Start with these capabilities; final command names may follow repository conventions:

| Tool                      | Domain behavior                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_plan_context`       | Read the run's current authorized plan state, brief, calibration, and coverage. A locked version is readable.                                                                                              |
| `read_schedule`           | Read bounded blocks, weeks, and complete workout prescriptions for the authorized version.                                                                                                                 |
| `create_plan_draft`       | From a standalone conversation, create one plan and bind that conversation transactionally when the user has expressed new-plan intent. Existing plan-linked runs cannot use it to create unrelated plans. |
| `update_plan_brief`       | Save collected assumptions and dates through shared domain commands; semantic changes clear confirmation.                                                                                                  |
| `set_fitness_calibration` | Save race evidence or an estimated threshold through the deterministic calculator, retaining the estimate's provenance.                                                                                    |
| `apply_schedule_changes`  | Atomically apply a bounded group of explicit workout add/update/move/delete and block/week changes. Omitted workouts are preserved.                                                                        |
| `replace_schedule_range`  | Atomically replace an explicit date range with its blocks/weeks/workouts and coverage intent. Deletions outside that range are forbidden.                                                                  |
| `validate_plan`           | Return current structural and domain findings, warnings, and a change summary.                                                                                                                             |

There are no tools for brief confirmation, lock, unlock, discard, restore, archive, SQL, arbitrary HTTP, shell execution, or filesystem editing. Domain tool definitions and handlers remain reusable outside the SDK; authorization and validation are enforced by the API.

New-plan binding preserves the original standalone provenance of earlier messages and the run's initial context. Record the creation/binding event and resulting authorized target explicitly. Following operations use that target and updated edit number. This does not introduce generic reassignment of conversations or backfill historical attribution.

Generation may write coherent chunks such as weeks or blocks, with each chunk atomic. An unexpected stop leaves committed chunks visible and identified as partial work. Record the intended horizon atomically with the first schedule batch in normalized run fields, preserve it across later batches and terminal failures, and advance committed coverage only for completed coherent content; a failure must not make a shortened result appear intentionally finished. Do not invent workouts to fill legitimate rest days or require coverage through the overall end date.

Track the brief basis used to generate or review a schedule range. Clear the existing stale-schedule marker only when applicable content has actually been regenerated or reviewed against the current assumptions; a successful chat reply or one isolated workout edit is insufficient. Planning coverage and its basis must participate in version cloning, hashing, lock review, and restore.

## Human review and alpha UI

Keep UI changes limited to the coaching journey and truthful review:

- **Create a plan** starts an initial draft and associated chat using the existing atomic API option. The manual brief editor remains available as supporting scaffolding.
- Standalone chat can discuss training without creating a plan. A clear new-plan request can create and bind one naturally; ambiguous intent should be clarified before creation.
- Show current assumptions, estimated pace provenance, and prescribed planning coverage in the plan review. A single lock review may confirm the brief and lock the programme together using fresh validation and warning acknowledgements.
- Add a narrowly scoped human-only transaction for combined brief confirmation and locking if existing endpoints cannot safely provide it. Separate brief confirmation remains available. Successful combined review records the same confirmation and immutable revision evidence as separate actions.
- On completion, invalidate the affected plan/brief/calibration/workout queries. Continue active-run polling and refresh-on-focus; SSE and token streaming remain Phase 6.
- Failure and cancellation show which operations committed and what remains unfinished. Never imply that Stop reverted them.

## Handoff and decision policy

No material product question remains for this refinement. SDK compatibility, exact schema/route names, concurrency implementation, and operational tuning are engineering work covered by the delegated defaults. The implementation plan specifies their verification gates; they are not already verified.

Bring a decision back to the user if implementation would require a different model/provider direction, introduce autonomous lifecycle actions, expand sharing or coaching scope, or materially change the accepted conversation or revision experience. Do not reopen aggregate budget selection merely to finish the handoff.
