# Phase 6: live coaching and plan review

## Status

**Phase complete, 2026-10-06.** The owner confirmed that the delivered Phase 6 experience is fully complete and working. Product refinement was completed on 2026-10-05. This refines Phase 6 of the
[V1 roadmap](./v1-poc-development-plan.md), against merged `main` at `4351ec9`.
Phase 5 and the web design-system alignment are already merged. Accepted product
decisions are marked below; supporting engineering defaults are scoped in the
[implementation plan](./phase-6-implementation-plan.md). No product questions
remain open. The web implementation is complete; runtime details
and verification are recorded in the [runtime](./phase-6-runtime.md) and
[validation report](./phase-6-validation.md). The owner confirmation closes the previous live-provider acceptance and hosted
rollout follow-ups.

**User direction, 2026-10-05:** refine the product through questions before starting
the build. Related, straightforward questions may be grouped; questions needing
discussion should be asked individually. Resolve every question in the current
block before advancing. Do not treat provisional recommendations as accepted.

References: [Phase 5 design](./phase-5-design.md),
[live validation](./phase-5-validation.md),
[web design system](./web-design-system.md), and the
[mobile prototype](../apps/mobile/README.md).

## Outcome

A user discusses a change with the coach, sees useful activity and the reply as
they happen, and reviews saved changes to the associated plan without losing
their place in chat. Reloading, changing views, or losing the live connection
must not lose committed plan changes or start the request again.

## What is already covered

| Capability                    | Merged implementation                                                                                     | Phase 6 gap                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Real coaching and draft edits | Private OpenAI Agents SDK worker and authorized API tools                                                 | Stream user-visible output and activity through the API                                           |
| Durable chat and execution    | Ordered messages, run states, cancellation, worker leases and recovery                                    | Reconcile live output with durable history                                                        |
| Browser state                 | Account-scoped TanStack Query; version/edit-aware plan reads                                              | Targeted event-driven refresh across relevant screens                                             |
| Plan refresh after coaching   | Chat polls detail every two seconds and broadly invalidates plan/workout queries when run context changes | Refresh committed changes while viewing the plan, including without chat mounted                  |
| Activity                      | Completed tool events, expandable latest-run activity, generation horizon and coverage                    | Show current actions and their outcomes as they occur; retain useful attribution to earlier turns |
| Plan review                   | Workout details, calendar/weeks, lock review and lifecycle dialogs                                        | In-chat plan review and clear workout change indicators                                           |
| Visual language               | Mobile-derived themes, navigation, plan presentation and responsive web UI                                | Extend this system rather than redesign it                                                        |

The Expo app simulates activity, streamed text, plan-update cards and a Chat/Plan
pager using timers and local state. These are interaction references, not backend
features or verified API-compatible client contracts. Its scripted strength
requests and inferred completed workouts do not expand the running-only alpha.

## Client scope

**User decision, 2026-10-04:** deliver Phase 6 on the responsive web app. Keep Expo as the visual
and interaction reference, and wire the native client separately. Sharing a live
API contract makes that later work easier, but native authentication, lifecycle,
storage and distribution are additional work.

**User constraint, 2026-10-05:** the mobile app is a reference prototype and must
remain unchanged throughout this work. Do not edit `apps/mobile`, its dependencies,
configuration or prototype data. Bring selected interactions into `apps/web`,
building on the visual alignment already merged there.

## Agreed experience and supporting defaults

### Chat and progress

**User decisions, 2026-10-05:** follow streamed output only while the user is near
the bottom; otherwise preserve reading position and offer Jump to latest. Allow
typing the next message while the coach works, with Send disabled until the run
finishes or is stopped. Do not introduce a follow-up message queue.

**User decision, 2026-10-05:** show a compact activity card describing the current
action in plain language, with an expandable list of completed or failed actions.

- Keep the current message styling, Markdown support, composer and activity
  preference. Create a visible reply-in-progress area once the API accepts a run.
- Show truthful states: waiting for the coach, working, an actual tool action,
  replying, stopping, and a terminal outcome. Do not imply a tool has started
  while the model is still preparing its input.
- Stream user-visible assistant text. Tool arguments, provider internals and
  private reasoning are not chat content. If the model has no visible text yet,
  show activity rather than invented prose.
- Keep a compact activity summary with an expandable list of real actions and
  their pending, successful or failed outcomes. Hiding detailed activity still
  leaves basic progress, errors and cancellation visible.
- Associate activity and saved-change summaries with the turn that produced them,
  so earlier turns remain understandable after later messages arrive.
- Follow new text only while the user is near the bottom. Reading older messages
  must not pull them back down; offer a jump to the latest reply. Keep narrow
  Markdown tables contained within messages, and respect reduced motion.
- Permit composing the next question while work continues, but retain the current
  single-run rules: do not introduce queued follow-up messages or concurrent
  editing as part of streaming.

### Chat and plan together

**User decision, 2026-10-05:** bring the prototype's Chat/Plan relationship to the
web, with Chat/Plan tabs on mobile web and a collapsible plan panel beside chat
on desktop.

- On narrow screens, show Chat and Plan tabs within a plan-linked conversation.
  Tapping works independently of any optional swipe gesture.
- On wide screens, offer an adjacent plan-review panel that can be collapsed.
  Preserve room to read chat; do not force a split layout on smaller widths.
- Switching views preserves conversation position, unsent composer text and the
  selected plan week. The run continues when another view is selected.
- A standalone conversation has no Plan tab until it becomes associated with a
  plan. Bind it to that plan, not whichever plan is active in the global calendar.
- The plan view shows the current relevant draft or locked version, assumptions,
  pace guides and prescribed coverage. It uses the same authoritative reads as
  the ordinary plan screens.
- Keep the existing human review and confirmation dialogs for lock, unlock and
  other lifecycle actions. Opening a plan panel does not grant new agent powers.
  Explain existing active-run restrictions where an action is unavailable.

Tabs must work by tapping and keyboard navigation. Swipe is an optional
implementation enhancement, not a required product interaction.

**User decision, 2026-10-05:** show the full current plan with changed workouts
highlighted and a compact changes summary. Users can open workout details and
review or lock using the existing controls, so changes can be assessed alongside
the surrounding training. This is not limited to a list of changed workouts.
Supporting behavior follows the existing ownership, version and human-confirmation
rules; it does not introduce another plan representation or editing authority.

### Saved changes

**User decision, 2026-10-05:** show each successfully saved batch immediately in
the plan while the coach continues, without waiting for the final reply.

**User decision, 2026-10-05:** plan highlights show all pending differences from
the latest locked version, across messages in the current draft. Each chat
response summarizes changes saved by that run. Locking the new version clears
pending highlights; saved workouts in a first draft are additions. For example,
moving Tuesday's run in one response and shortening Sunday's long run in another
highlights both in the plan, with separate summaries in chat.

- After a committed operation, refresh affected plan content without waiting for
  the final assistant reply. The same freshness behavior applies to Today, Plan,
  library/detail and any open workout view that displays affected data.
- Show a concise saved-changes card in the associated chat turn, with a route to
  review. A successful read or validation does not count as a plan edit. Brief
  and calibration edits are changes even when no workouts were added.
- In plan review, identify added, changed, moved and removed workouts. A removed
  workout needs a comparison entry because it is absent from the current schedule.
- Distinguish **changes saved by this run** from **changes in the whole draft**.
  The draft view compares with the current locked version,
  including when restoring older content into a draft. A first draft has no
  locked baseline and treats saved workouts as additions. Run summaries describe
  only that run's committed operations. Reverted changes should not
  remain as pending differences merely because an earlier tool edited them.
- Use persisted content and operation receipts for these claims, not assistant
  prose or the prototype's local change flags. Do not promise exact historical
  reconstruction of every past draft edit.
- Preserve an open workout when it changes. If it is removed, explain that it was
  removed and offer a route back to the schedule. Background updates must not
  overwrite unsaved human form edits or silently change a historical revision view.

The high-level comparison experience and baseline are accepted for Phase 6.

**User decision, 2026-10-05:** label workouts Added, Changed or Moved, and list
removed workouts in the changes summary. Include assumption and pace-guide
changes in the summary as well.

### Generation coverage

Phase 5 already records intended generation horizons, contiguous prescribed
coverage and interrupted attempts. Keep those semantics.

**User decision, 2026-10-05:** show the intended date range and how far the saved
programme reaches. Before any content is saved, use a waiting indicator. Do not
estimate time remaining. The coverage display reflects saved content, not model
input being generated or elapsed time.

- Show the intended date range once it has been recorded, and update the
  prescribed-through date after saved coherent chunks.
- Do not infer completeness from the last workout date: rest days and unplanned
  days are different. Do not infer workout completion from dates in the past.
- A coverage bar measures saved coverage within the declared horizon. It is not
  an elapsed-time estimate. Before coverage exists, use an indeterminate state.
- Do not claim weeks are being saved progressively when the worker is preparing
  one large batch. Streaming cannot expose unsaved workout arguments as plan data.
- Later unplanned weeks remain a supported workflow. Full-plan generation and
  brief confirmation before generation do not become new requirements.

### Stop, failure and reconnect

**User decision, 2026-10-05:** retain streamed text if the reply is stopped or
fails, labelled Stopped or Failed · incomplete as appropriate, and preserve it
after reload. Keep activity and saved-changes summaries alongside the partial
reply. It is not a completed answer; committed plan changes remain saved whether
or not assistant output is complete.

**User decisions, 2026-10-05:** losing the connection or leaving the page does
not stop the coach. Show Reconnecting, reconnect automatically and recover saved
text and plan changes. Do not automatically repeat failed runs; offer Review
saved changes and let the user deliberately ask to continue from the current
draft. Switching views preserves unsent chat text. Background plan updates
preserve unsaved human form edits and offer Refresh latest instead of overwriting
them.

- Stop retains the existing cancellation contract: show stopping until the API
  confirms the outcome. Previously committed operations remain saved.
- Connection loss is separate from cancellation or model failure. Show a compact
  reconnecting notice; the worker continues independently. Keep available HTTP
  commands working when only the live stream is unavailable.
- Reconnect or reload fetches authoritative messages, run status and affected
  plan state before resuming live updates. Do not replay model execution, resubmit
  the user's request, duplicate text or repeat a plan mutation.
- Keep partial assistant text visibly marked as interrupted if the run stops or
  fails, including after reload. It is not a completed answer, and any saved-plan
  summary must come from committed operations.
- Failure offers review of saved changes and a deliberate way to continue. It
  must not automatically retry the entire coaching run.
- Restore basic polling/refetch behavior if streaming is unavailable. Clear live
  buffers and close subscriptions on sign-out or account change.

The interruption and recovery product questions above are resolved.

## Engineering direction

- Preserve the browser -> core API -> PostgreSQL authority boundary and the
  independently deployed worker. The browser never connects directly to the
  provider or receives worker credentials.
- Use an authenticated SSE stream for notifications and output; ordinary HTTP
  remains the command interface. Reuse the existing query provider and generated
  client contracts.
- Publish committed plan changes after the transaction succeeds. Treat events
  as reasons to refresh identified resources, not an alternative plan store.
- Scope and batch invalidations. An assistant text delta should not cause a plan
  refetch, and an unrelated plan should not refresh for every tool call.
- Batch transient text rather than writing each token separately. Scope buffering,
  output bounds, reconnect snapshots, retention and delivery across API instances
  after the product decisions above. Durable final-message completion remains
  required. Verify the pinned SDK's stream/cancellation behavior at that stage.
- Preserve owner authorization, lease fencing, idempotency, account isolation,
  immutable history and optimistic concurrency in all new paths.
- Measure time to first useful activity, first visible text, first committed plan
  change and completion, along with model/tool latency and reconnect failures.
  Keep prompts, prescription payloads and secrets out of diagnostic logs.

**User decision, 2026-10-05:** measure generation latency during Phase 6 and scope
optimization afterward. Include model-request and tool-execution timings, time to
first saved workouts, and total duration. Dedicated speed optimization is outside
this build.

The Phase 5 live sample took 92–105 seconds for four-week generation. Its largest
gaps preceded schedule writes. Streaming improves feedback; it does not itself
reduce generation time. Keep model/reasoning choices and generation methodology
unchanged while measuring; payload/context or model-setting experiments follow
using that evidence.

## Acceptance walkthrough

1. Start a discussion and see streamed Markdown with accurate activity.
2. Ask for a draft change, observe saved content update before the final reply,
   and review the affected workouts beside chat or in the mobile-web Plan tab.
3. Confirm that a different open plan and an explicitly selected historical
   revision are unaffected.
4. Read older messages while output arrives; switching views preserves position
   and unsent text.
5. Stop after a committed batch: saved changes remain, unfinished coverage is
   accurately labelled, and the user can review before continuing.
6. Disconnect, reload, return after mobile backgrounding, or open another session:
   authoritative content recovers without duplicate messages or mutations.
7. Verify locked-plan protection, human lifecycle confirmations and cross-account
   isolation through the new stream and review paths.

## Scope boundary

Phase 6 is complete. Remaining management controls
stay in Phase 7; invitation setup, release spending limits, backups and final
alpha readiness stay in Phase 8. Native API wiring is deferred to separate work.
Markdown plan export was removed from the product roadmap on 2026-10-06.
Web research, automatic workout ingestion, broad multi-sport coaching,
prompt customization, dedicated generation-speed optimization and a generic
real-time infrastructure platform are outside this build.
