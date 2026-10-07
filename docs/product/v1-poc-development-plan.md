# V1 proof-of-concept development plan

## Status

**Verified against the repository on 2026-10-06.** Phases 1–7 are implemented. The owner is continuing responsive web development, choosing features from the Expo dummy app in separate threads. Native integration is deferred. Phase 8 is unfinished release readiness; Phase 9 is an unimplemented backlog.

Historical local/provider/hosted acceptance records are in the [archive](../archive/README.md), with current priorities in the [handoff](../current-handoff.md). Recorded test counts and deployment settings are checkpoints, not fresh verification of hosted state.

## Objective

An invited friend should be able to discuss a running goal, let the coach create/refine a draft, review assumptions and prescriptions, explicitly lock/activate it, then later unlock/refine or restore history. Develop this loop on the responsive web app until the owner is happy with it, then learn from friends-and-family usage before expanding the platform.

## Current technical decisions

- PostgreSQL is authoritative and core plan content is relational.
- Atlas owns append-only migrations; Kysely owns typed queries.
- Hono owns human/machine authorization, domain transactions and durable work.
- Clerk sessions map lazily to internal athlete UUIDs; alpha plans are owner-only.
- React/Vite and React Router provide the browser application; account-scoped TanStack Query provides server state.
- Each signed-in tab uses authenticated fetch SSE, owner-local replay and HTTP projections. Commands stay on HTTP; disconnected active reads temporarily poll.
- The generated public OpenAPI client is used by web. The private worker uses a hand-written fetch/Zod internal client to reach the same domain authority.
- The private worker uses pinned OpenAI Agents SDK 0.18.0 with OpenAI Responses. Current defaults are `gpt-6.1-sol`, medium reasoning and `running-coach-v2`.
- pnpm 11.18.0/Node 24 govern production workspaces; the excluded Expo reference uses npm.
- Dockerfiles support independent services on Railway; live service/source/backup policy requires external verification. No hosted service manifest is committed.

See [ADRs](../adr/README.md) and [architecture](../architecture/README.md). Convex, alternative routing/full-stack frameworks, Redis, an external queue and infrastructure-as-code remain deferred; no such migration is implemented.

## Product principles

Keep the complete coaching/review loop useful before widening scope. Derive ownership from authentication, keep agent tools narrow and auditable, preserve locked history and require human approval for lifecycle decisions. Add personal data/infrastructure only when it powers a concrete feature. Prompt instructions guide coaching quality; server rules enforce permissions and data invariants.

## V1 scope

Implemented: multiple plans, activation/library/archive, complete draft/version lifecycle, structured plan-specific running brief, athlete-owned running pace calibration applied to every plan, persistent conversations/runs, authorized coaching tools, streamed output, live saved-plan review, cancellation/recovery, Clerk account UI and responsive themes/preferences.

Not delivered: application invitation enforcement, rate/per-user spending limits, operator account-data removal command, sharing, merging, combined active-plan calendar, global training profile, prompt customization/user skills, completed-workout ingestion, wearable integration, heart-rate zones, strength performance tracking, full manual workout editing or native API integration. Markdown plan export was removed from the roadmap.

# Delivery phases

## Phase 0: alpha product contract

**Accepted scope.** Intended alpha is invitation-only. Plans may train running, cycling, swimming and supporting strength ([ADR 0006](../adr/0006-multisport-plans.md)). Invitation restriction is a release configuration/task, not already enforced in application middleware.

Clerk owns account identity. An account has one athlete and every plan is for that athlete; plans cannot describe another person or a hypothetical runner (decided 2026-10-07, [ADR 0005](../adr/0005-athlete-owned-performance.md)). Training assumptions belong to the versioned brief and fitness belongs to the athlete; there is no demographic profile.

Create a plan in the web library creates a draft and its first chat. A standalone conversation can instead create/bind one plan when intent is clear. The API's generic create command has an explicit optional conversation flag; not every API caller automatically gets a chat.

Agent-led generation can start before brief confirmation and cover an initial horizon. Lock requires human confirmation of the current brief, structural validation and warning acknowledgements. Full schedule coverage to the plan end is not required.

Lifecycle, source and activation labels are separate. Several plans can be active; active schedules start on locked content with no valid source preference, and explicit unlock selects draft review. Library detail is a workout/week list without a calendar. Today uses locked prescriptions.

Archive preserves draft/history and deactivates the plan. Linked conversations become effectively archived through the plan state; unarchive preserves independently archived chats and does not reactivate the plan. Alpha exposes archive/restore rather than permanent removal. Account self-deletion is an external Clerk policy; operator data removal remains to be specified.

## Phase 1: engineering foundation and deployment rail

**Implemented.** Pinned toolchain, format/lint/types/tests/builds, OpenAPI/Kysely generation, Atlas checksum checks, production dependency audit, Docker images, Clerk mapping and Sentry hooks are present.

GitHub Actions runs `pnpm check` plus a database/upgrade/streaming-smoke job for PRs and pushes to `main`. Database/smoke checks are no longer local-only. Actual branch protection, automatic Railway deployment and hosted monitoring/backups must be verified in their platforms.

See [development](../operations/local-development.md), [Railway](../operations/railway-deployment-plan.md) and [historical deployment evidence](../archive/handoff-history.md).

## Phase 2: plan lifecycle and immutable revisions

**Implemented.** Logical plan metadata is separate from normalized version content. New draft → human lock → immutable version; unlock copies complete content with stable lineage. Discard requires a prior lock; restore supported history creates another draft. All locked versions remain intact.

Exact current commands/routes/concurrency rules are in the [schema contract](../architecture/phase-2-schema-contract.md); product behavior is in [lifecycle guidance](./phase-2-plan-lifecycle-refinement.md). Validation is `/plans/:planId/validate` and discard is `/plans/:planId/discard`, replacing the early proposed `/draft/*` paths.

## Phase 3: plan brief and fitness calibration

**Implemented.** Free-text goal/context, explicit unknown baselines, desired frequency, seven weekday preferences and units replace typed goals/constraints. Human structured editing remains available alongside chat tools. The plan timezone moved to the athlete's device on 2026-10-07.

Deterministic running pace guides have estimate provenance and effective dates. They were version-owned in Phase 3; since 2026-10-07 they are an athlete-owned, append-only timeline that every plan resolves by workout date ([ADR 0005](../adr/0005-athlete-owned-performance.md)). Inputs use canonical metres/seconds-per-kilometre. Display units do not change semantic brief confirmation. No official proprietary pace-table equivalence or affected-future-workout report is promised.

See [brief behavior](./phase-3-plan-brief-and-calibration-refinement.md), [schema/API](../architecture/phase-3-schema-contract.md) and [calculator policy](./run-pace-v1.md).

## Phase 4: persistent chats and agent runs

**Implemented.** Owner-isolated durable conversations, messages, idempotent sends, archived history, version/edit provenance, one active run per conversation/plan and cancellation exist. Conversation history is bounded; completed replies and accepted interrupted output remain distinct.

Current modes include real `agent` execution, development `test`, and `unavailable`. Model metadata is attributed on claim; token usage may be available, while cost values are not calculated. See [conversation contract](./phase-4-design.md).

## Phase 5: coaching agent worker and domain tools

**Implemented.** A private worker executes the model/tool loop through run-scoped machine credentials. API services own leases, receipts, authorization and transactions. Eleven tools read context/schedule, create a draft, update the brief, read/preview/record/retract the athlete's performance, apply/replace schedules and validate.

There are no agent lifecycle-approval tools, SQL/shell/filesystem tools or web search. Queued work can survive restart; expired running sessions fail without replay. Committed batches survive Stop/failure. Partial horizons, labelled pace estimates and combined human confirmation/lock are supported.

See [coaching contract](./phase-5-design.md), [runtime bounds](../operations/phase-5-runtime.md) and [recorded live validation](../archive/phase-5/phase-5-validation.md).

## Phase 6: live synchronization and TanStack Query

**Implemented; owner confirmed complete 2026-10-06.** Bounded durable text snapshots, owner-scoped resource notifications, authenticated SSE/replay/reset, targeted query invalidation and disconnected fallback reads are present.

Actual event types are `plan.changed`, `conversation.changed`, `message.changed`, `run.changed`, `activity.changed`, `output.changed` and (since 2026-10-07) `performance.changed`. Notifications contain identifiers; text arrives through authorized output/turn reads, not an `agent.run.output.delta` journal payload.

Chat includes per-turn activity/incomplete output/net saved changes; responsive Chat/Plan review preserves draft/history selection and human baselines. Timing instrumentation does not itself optimize model latency.

See [live product behavior](./phase-6-design.md), [runtime/recovery](../operations/phase-6-runtime.md) and [historical validation](../archive/phase-6/phase-6-validation.md).

## Phase 7: product management controls

**Implemented and merged.** Reviewed confirmation/retry behavior, library presentation, lifecycle/source/activation vocabulary and coherent chat archive navigation close G1–G5. The historical record also reports the Clerk development account-deletion policy, which must be verified for a future production instance.

History shows stored versions and summaries/restore previews, not arbitrary pairwise field-level diffs or a completed history-to-chat provenance browser. Mobile integration is deferred; optional refinement is part of continued web work.

See [closeout](../archive/phase-7/phase-7-closeout.md). Its test counts and hosted policy reads are recorded evidence; Phase 7 hosted web walkthrough remains unverified by this documentation audit.

## Phase 8: friends-and-family release

**Planned release work; not complete.** Complete these checks before invitations. Repository evidence does not verify current Clerk/Railway settings.

### Operations and security

- Use Clerk production keys.
- Restrict registration through invitations or an allowlist.
- Configure Railway backups and document restore procedures.
- Add rate limits for chat and agent-run creation.
- Add per-user model-spend limits.
- Verify authorization for every plan, revision, chat, and run endpoint.
- Ensure logs contain no session tokens, prompts marked private, or secrets.
- Add privacy documentation and an operator-assisted alpha data-removal procedure.
- Complete desktop and mobile smoke testing.

### Repository readiness

- Select and add an open-source license.
- Add `CONTRIBUTING.md`.
- Add `CODE_OF_CONDUCT.md`.
- Add `SECURITY.md`.
- Refresh architecture and setup documentation.
- Remove private fixtures and credentials.
- Add dependency update automation.
- Add issue and pull-request templates.

### Product refinement

- Refine onboarding and empty states.
- Refine visual language and responsive behavior.
- Explain drafts, locks, activation, and versions clearly.
- Make agent progress understandable without exposing unnecessary implementation detail.
- Provide useful recovery actions for failed runs.

### Exit criteria

- Invited users can onboard without developer assistance.
- A user can create and revise a plan through chat, then review, lock, and restore it through human controls.
- Cross-user access tests pass.
- Backups, monitoring, cost controls, and the operator-assisted data-removal process are operational.
- The repository can be shared publicly without exposing private data.

## Phase 9: post-alpha differentiating features

**Unimplemented backlog.** Prioritize these ideas from actual usage; they do not block initial web sharing once release-readiness checks are satisfied.

### Plan merging

Merging creates a new plan and leaves sources unchanged:

```text
Running plan ─┐
              ├── agent merge workflow → new combined plan
Strength plan ┘
```

Store source-plan lineage. The agent should resolve scheduling, load, interference, and recovery conflicts explicitly.

### Combined active-plan calendar

Allow multiple active plans to contribute to one athlete calendar, including conflict warnings and clear source-plan labels.

### Prompt customization

Allow a versioned user instruction overlay rather than replacement of immutable platform safety and authorization rules:

```text
Platform safety and tool rules
  + curated sport skill
  + versioned user coaching preferences
  + athlete and plan context
```

Style requests such as concise language, emojis, or pirate speech must not weaken tool permissions or safety rules.

### Skills

Start with curated or declarative sport skills. Arbitrary executable user skills require a separate design for sandboxing, permissions, resource limits, review, and secrets access.

Prompt and skill revisions should preserve an original platform version and support restoring earlier user versions.

# Reassessment points

Choose further web features from owner/friend feedback. Revisit measured generation latency, context volume, event delivery/retention and provider limitations without weakening lifecycle/ownership invariants. Significant architecture changes need a new ADR; a feature or layout change generally updates its topic guide.

No fixed native schedule or new Phase 9 commitments were created by this documentation update.
