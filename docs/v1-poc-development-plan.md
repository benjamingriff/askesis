# V1 proof-of-concept development plan

## Status

**Accepted direction. Phase 0 is complete and the Phase 1 implementation contract is agreed.** Individual later phases will be refined immediately before implementation. This document records the intended sequence, scope, and current technical decisions so that future work can be evaluated against a shared plan.

## Objective

Prepare Askesis for an invitation-only friends-and-family proof of concept centred on one product loop:

```text
Athlete provides goals and fitness context
    ↓
Athlete chats with a coaching agent
    ↓
Agent creates or changes an unlocked plan draft
    ↓
Chat and plan updates appear in the UI as work progresses
    ↓
Athlete reviews and locks a plan revision
    ↓
Athlete follows, revises, restores, or exports the plan
```

The objective is to get this loop working end to end, learn from real use for several months, and only then reconsider major platform choices or broader product features.

## Current technical decisions

### Retain the existing application architecture

For the v1 prototype:

- PostgreSQL remains the sole source of truth.
- Atlas continues to own schema migrations.
- Hono remains the authoritative core API.
- Kysely remains the database query layer.
- pnpm manages the TypeScript monorepo and is pinned across local, CI, and container builds.
- React Router remains the web router.
- The generated OpenAPI client remains the shared API contract.
- Clerk remains responsible for human authentication.
- Railway remains the planned hosted prototype platform.
- The future Pi agent runs as a separate private worker and receives no database credentials.

### Adopt TanStack Query

TanStack Query will be introduced when persistent chats and mutation APIs require it. It will own browser server-state concerns such as:

- Cached API queries
- Mutation state
- Background refetching
- Event-driven invalidation
- Retry and error handling
- Optimistic updates where appropriate

React Router continues to own navigation and route structure. TanStack Router and TanStack Start are deferred because they do not solve the immediate synchronization requirement and would increase migration scope.

### Do not adopt Convex for v1

Convex is deferred rather than rejected permanently. Adding it now would be a backend replatform rather than a small synchronization change.

The v1 synchronization model will be:

```text
Browser HTTP command or agent tool
    ↓
Core API mutation
    ↓
PostgreSQL transaction
    ↓
Durable event and live notification
    ↓
Browser event stream
    ↓
TanStack Query invalidation and authoritative refetch
```

After the prototype has been used for several months, the team may reassess whether maintaining the event layer is justified or whether a reactive backend would materially improve the product.

## Product principles

1. Get a complete product loop working before expanding feature breadth.
2. Let real prototype use inform architecture changes.
3. Keep PostgreSQL authoritative and normalized.
4. Make all plan changes through explicit API domain operations.
5. Let the web and agent use the same API boundary.
6. Derive athlete ownership from authentication; never trust a client-supplied owner ID.
7. Preserve plan history rather than rewriting it.
8. Keep agent tools narrow, authorized, and auditable.
9. Collect personal data only when it powers a defined feature.
10. Introduce infrastructure only when an implemented feature needs it.

## V1 scope

### Required for the private alpha

- Persistent conversations and messages
- A working Pi-based agent worker
- Agent tools for plan creation and modification
- Streaming chat output and live plan updates
- Multiple plans with clear selection and activation controls
- Draft, lock, version, restore, and archive workflows
- Conversational collection of a structured, plan-specific brief
- Plan-specific running fitness calibration and pace recommendations
- Markdown plan export
- Clerk-managed identity controls
- Railway deployment
- Invitation-restricted Clerk production authentication
- Automated tests, CI, monitoring, and database backups
- A coherent product and UI refinement pass
- Open-source repository and licensing cleanup

### Deferred until after the private alpha

- Plan merging
- A combined calendar for multiple active plans
- User-facing plan, chat, and account deletion
- A global athlete profile or demographic record
- User-facing plan sharing and collaboration
- User system-prompt customization
- User-selected or user-authored sport skills
- Prompt and skill revision history
- Broad multi-sport calibration coverage
- Advanced demographic statistics
- Rich direct manipulation of every plan field
- Completed workout ingestion
- Wearable integrations
- Arbitrary executable user skills
- Offline-first synchronization
- Replacing PostgreSQL with a reactive backend

# Delivery phases

## Phase 0: alpha product contract

**Status: complete.** The following product semantics were agreed before foundational schema and agent work.

### Audience and success criterion

The hosted alpha is invitation-only and supports running only. It succeeds when an invited friend can, without developer assistance:

1. Sign up.
2. Create a plan through a conversational flow.
3. Provide goals, fitness evidence, availability, and constraints in chat.
4. Review the structured plan brief assembled by the agent.
5. Generate and refine a running plan through chat.
6. Review and explicitly lock its first version.
7. Activate it and view its calendar and workouts.
8. Return later to unlock, refine, lock a new version, restore an older version, or export it.

A brand-new account sees an empty Plan view with **Create a plan** as its primary action and the empty Plan Library as a secondary destination.

### Account and plan context

- Clerk owns basic account identity such as name, email, authentication methods, and profile image.
- Askesis does not collect a global athlete profile during alpha onboarding.
- A plan is owned by the signed-in account but is not associated with a separate runner entity or runner label.
- A plan may describe the owner, another person, or a hypothetical scenario.
- Training assumptions provided in chat are extracted into a structured plan brief so the agent does not need to reconstruct them from chat history.
- The exact plan-brief fields will be refined later.
- Plan-specific assumptions, fitness levels, calibrations, zones, and workouts are versioned together.

### Conversational plan creation

1. **Create a plan** creates an initial draft and its first associated chat.
2. The agent asks focused questions about goals, dates, availability, current training, fitness evidence, and constraints.
3. The agent assembles a structured plan brief.
4. The user reviews and confirms the brief.
5. The agent generates the training schedule.
6. The user reviews and explicitly locks Version 1.
7. The locked plan may then be activated.

Chat is the primary editing interface. The Plan UI is primarily for review and navigation, with direct controls for organizational metadata and lifecycle actions. A full manual workout editor is deferred.

### Plan states and activation

User-facing plan states are:

- **Draft** — no locked version exists yet.
- **Locked** — the current version is immutable and no unpublished draft exists.
- **Unlocked** — a locked version exists alongside an editable unpublished draft.
- **Archived** — the plan and its associated chats are retained but read-only.

Activation is separate from locking:

- Only a plan with at least one locked version can be active.
- Any number of locked plans may be active.
- There is no primary-plan concept.
- Draft-only and archived plans cannot be active.
- Archiving automatically deactivates a plan.
- If no plan is active, the Plan view shows an empty state.
- If several plans are active, the Plan view provides a toggle and remembers the last one viewed as a UI preference only.

### Plan and library views

- The calendar-based **Plan** view shows active plans only.
- It includes the calendar and workout list.
- When an active plan is unlocked, this view shows the unpublished draft with a prominent indicator rather than showing the unchanged locked version.
- The **Plan Library** contains all non-archived plans, including active and inactive plans.
- Opening a library plan shows its plan details and workout list without the calendar.
- The library exposes activation, lock state, version history, export, and archive controls.
- Archived plans and chats live in a separate archive area.

### Locking and unlocking

- Locking and unlocking always require explicit human confirmation.
- The agent may recommend either transition but cannot perform it.
- When a locked plan receives a change request, the agent explains that it is locked and presents a human-controlled unlock action.
- Unlocking clones the complete current version into a new editable draft.
- The agent may then modify that draft without approval for every individual workout change.
- Only one plan-mutating agent run may operate on a draft at a time.
- The UI visibly distinguishes Locked, Unlocked, and unpublished-draft states.
- Lock confirmation includes validation results and a concise change summary.
- Validation errors block locking; warnings require explicit acknowledgement.
- Validation results are retained with the locked version.

### Draft and failure behaviour

- Each completed agent tool operation is atomic and remains committed to the draft.
- Cancelling or failing an agent run stops future operations but does not silently undo completed operations.
- The UI identifies incomplete runs and summarizes changes that completed.
- The user may continue refining or explicitly discard the draft.
- Discarding requires confirmation, creates no version, and restores the last locked version.
- Chat messages and agent-run history remain as an audit trail after a draft is discarded.

### Complete aggregate versioning

The UI calls history **versions** even if implementation types use `plan_revisions`.

Every immutable version captures one linked aggregate:

```text
Plan version
  ├── structured plan brief and goals
  ├── training assumptions and constraints
  ├── fitness levels and calibrations
  ├── training zones
  ├── blocks and weeks
  └── workouts and prescriptions
```

Any change to this aggregate happens in the unlocked draft and is committed together when locked. Organizational metadata remains outside version history:

- Plan display name
- Active/inactive state
- Archived state
- Last-viewed UI preference

### Restore behaviour

1. The user previews an older locked version and its differences.
2. **Restore as draft** copies it into a new editable draft.
3. The current locked version remains unchanged.
4. The restored content becomes effective only after human review and locking.
5. Existing history is never rewritten, deleted, or renumbered.

### Chats

- A plan can have multiple chats.
- Creating a plan creates its first chat automatically.
- Standalone chats are also allowed and may later create one plan.
- A chat can be associated with at most one logical plan.
- Chats belong to the logical plan rather than one specific version.
- Each message and agent run records the locked version or draft against which it operated.
- The version history can link to the conversation and agent run that produced a version.
- Individual chats may be archived without affecting their plan.
- Archiving a plan archives all associated chats.
- Archived chats are readable but cannot start agent runs.
- Unarchiving a plan restores its previous plan, draft, and chat state but does not reactivate it automatically.
- An inactive, non-archived plan can still be discussed and edited through chat.

### Archiving and deletion

- Archiving is the only user-facing removal mechanism in the alpha.
- Plans, chats, and accounts cannot be permanently deleted through the alpha UI.
- An archived plan preserves all locked versions and any unpublished draft.
- Archived content is read-only and can be restored.
- A documented operator-assisted process should remain available if an alpha participant asks for their data to be removed.
- Self-service deletion will be designed after alpha feedback.

### Sharing and permissions

- Every plan has one owning account for the alpha.
- Only its owner can activate, unlock, edit, lock, restore, export, or archive it.
- User-facing plan sharing and collaboration are deferred.
- Phase 2 removes the existing membership model; alpha plans are owner-only.
- Markdown export is the initial sharing mechanism.

### Export

Users may export either the current locked version or an unpublished draft as Markdown. Draft exports are clearly labelled. Export includes:

- Structured plan brief and assumptions
- Goals
- Fitness calibration and zones
- Weekly schedule
- Workout prescriptions and notes
- Version number and export timestamp

Chats and private agent reasoning are excluded.

### Phase 0 exit criteria

- [x] Audience and private-alpha success criteria agreed.
- [x] First-user journey agreed.
- [x] Plan states and activation semantics agreed.
- [x] Plan and library navigation agreed.
- [x] Lock, unlock, validation, discard, and restore semantics agreed.
- [x] Complete-aggregate version boundary agreed.
- [x] Chat ownership and archival semantics agreed.
- [x] Alpha account, sharing, deletion, sport, and export scope agreed.

## Phase 1: engineering foundation and deployment rail

**Status: complete.** The engineering foundation, private Railway deployment, authenticated production smoke test, and Sentry validation are complete. Phase 2 may proceed.

### Repository and delivery workflow

- GitHub hosts the repository and GitHub Actions provides CI.
- CI runs for pull requests and direct pushes to `main`.
- Direct pushes to `main` remain allowed during pre-alpha development.
- Before inviting alpha users, protect `main` and require pull requests with passing checks.
- Railway watches only `main`, waits for required CI checks, and deploys successful changes automatically.
- Manual Railway deployment remains available for infrastructure troubleshooting.

### Formatting and linting

Use:

- ESLint for TypeScript, React, hooks, imports, and correctness rules.
- Prettier for deterministic formatting.
- ESLint with `--max-warnings=0`; low-value rules should be disabled deliberately rather than tolerated as permanent warnings.
- CI formatting checks that never modify files.
- Generated artifacts excluded from manual lint or formatting where their generators already produce deterministic output.

Do not add pre-commit hooks during Phase 1. Editors may format on save, `pnpm check` is available before committing, and CI enforces the shared baseline.

### Standard commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm check` runs the complete lightweight CI-equivalent suite.

Local-only validation commands are:

```bash
pnpm test:db
pnpm smoke
```

### Test stack and boundaries

Use Vitest throughout the monorepo, React Testing Library for web component tests, and Hono's request interface for API tests.

CI runs:

- Unit tests.
- Lightweight integration tests that need no external service, including Hono routes with mocked repositories or authentication, React component integration, and API-client contract behaviour.

Local-only suites run:

- Real PostgreSQL repository and API integration tests.
- Full-stack disposable smoke tests.
- Future Playwright tests.

Playwright is not introduced in Phase 1. Real Clerk network calls and automated email verification are also excluded.

Do not enforce a global coverage percentage. Generate coverage reports, require tests for new domain rules, authorization changes, and bug fixes, and consider targeted thresholds later for stable critical modules.

### Local PostgreSQL testing

- Add a dedicated disposable `postgres-test` Compose service with a separate port and volume.
- Require an explicit `TEST_DATABASE_URL`.
- Never allow test commands to use the normal development database.
- Apply the complete Atlas migration history before database-backed tests.
- Reset the disposable schema between runs.
- Run database-mutating integration suites serially initially.
- Keep PostgreSQL out of GitHub Actions during Phase 1.

Authentication tests do not call Clerk:

- Unit and lightweight API tests inject mocked authenticated context.
- Cover unauthenticated, owner, member, and unrelated-athlete cases.
- Local PostgreSQL tests use synthetic internal athletes and identity rows.
- Real Clerk authentication remains a manual local and private-deployment smoke check until Playwright is introduced.

### Baseline test coverage

Phase 1 should test existing behaviour rather than only install tooling:

- Health and readiness endpoints.
- Authentication middleware outcomes.
- Lazy athlete provisioning and repeated requests.
- Workout list authorization.
- Workout detail authorization and inaccessible-resource `404` behavior.
- Recursive workout-step assembly.
- Effective-dated calibration resolution.
- Empty-plan UI state.
- Authenticated and unauthenticated route behavior.
- Generated API-client authentication middleware.

Provisioning concurrency and repository authorization belong to the local PostgreSQL suite.

### Lightweight CI workflow

The required CI workflow runs:

1. Prettier format check.
2. ESLint.
3. Type checking.
4. Unit and lightweight integration tests.
5. API and web production builds.
6. OpenAPI and generated client consistency checks.
7. Atlas migration checksum validation.
8. Production dependency audit.

CI does not start PostgreSQL, build Docker images, run Playwright, or run the full-stack smoke suite.

For generated artifacts:

- Regenerate the OpenAPI document and TypeScript client schema in CI and fail if Git changes.
- Do not regenerate Kysely database types in CI because that requires PostgreSQL.
- Migration authors apply schema changes and regenerate Kysely types locally.
- Type checking provides a partial additional guard against stale generated database types.

For Atlas without PostgreSQL:

- Install the Atlas CLI in CI.
- Validate the migration directory checksum and `atlas.sum`.
- Fail if committed migration contents and the hash disagree.
- Applying all migrations to an empty database remains part of the local smoke workflow and Railway pre-deployment.

For dependencies:

- Run `npm audit --omit=dev`.
- Fail on high or critical production dependency vulnerabilities.
- Development dependency findings do not initially block CI.
- Gitleaks and Dependabot remain deferred until repository-publication work.

### Disposable smoke workflow

`pnpm smoke` must:

1. Start an isolated disposable PostgreSQL instance.
2. Apply the complete Atlas migration history.
3. Apply the development fixture only to that disposable database.
4. Build the API and web applications.
5. Start the disposable application stack.
6. Verify liveness and readiness.
7. Verify protected API endpoints reject unauthenticated requests.
8. Shut down and remove the disposable stack.

It must not touch the normal development database or require a real Clerk login.

### Typed configuration

Add a typed environment boundary using Zod:

- Validate API variables at startup.
- Fail clearly when database or Clerk configuration is missing or malformed.
- Validate required web build variables before Vite builds.
- Make test defaults explicit rather than falling back to development credentials.
- Never include secret values in validation errors.

### API errors and request correlation

Standardize documented API errors around an envelope such as:

```json
{
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "Authentication is required.",
    "requestId": "request-id"
  }
}
```

- Cover validation, authentication, hidden authorization `404`, conflicts, and unexpected failures.
- Never return internal details or production stack traces.
- Expose the same error contract through OpenAPI and the generated client.
- Generate or accept a request ID for every API request and return it to the caller.

### Logging

Use Pino for structured logging:

- Emit JSON in deployed environments and readable output locally.
- Include request ID, method, route, status, duration, internal athlete ID, and agent-run ID where relevant.
- Never log Clerk tokens, authorization headers, credentials, or secret keys.
- Do not log complete chat prompts or plan context by default.

### Health and readiness

- Keep `/api/health` as a lightweight liveness check that does not query PostgreSQL.
- Add `/api/ready` to verify database connectivity and required migration state.
- Keep both endpoints unauthenticated without exposing configuration details.
- Configure Railway to use readiness before routing traffic to a new API deployment.

### Sentry and operational monitoring

Add Sentry when the private Railway deployment is created:

- Capture browser runtime errors and API exceptions.
- Attach release, environment, and request identifiers.
- Upload source maps securely.
- Scrub authorization information, chat content, and personal plan context.
- Disable local event reporting by default.

For Phase 1, Railway logs and health checks plus Sentry are sufficient. Dedicated uptime monitoring, performance metrics, distributed tracing, and paging are deferred.

### Container foundation

- Run the API as a non-root user.
- Keep runtime images limited to production dependencies.
- Pin base image versions rather than using `latest`.
- Add graceful HTTP shutdown and PostgreSQL connection cleanup.
- Supply secrets only at runtime, except Clerk's public Vite build key.
- Keep explicit web and API health checks.
- Defer image signing and dedicated container vulnerability scanning.

### Private Railway deployment

The first Railway deployment is an infrastructure validation environment, not the friends-and-family alpha:

- Use the existing Clerk development instance.
- Restrict practical access to the project owner and do not advertise the generated URL.
- Use only Railway's generated web domain.
- Keep the API on Railway private networking without a public domain.
- Configure Clerk development origins for the Railway web domain.
- Deploy no development seed data.
- Use the service topology defined in the Railway deployment plan.
- Create a Clerk production instance and custom domain only closer to the alpha.

### Migrations, rollback, and backups

- Atlas migrations are append-only after merging and deployment to `main`.
- Never modify an already deployed migration.
- Run Atlas as an API pre-deploy step before the new release starts.
- Migration failure blocks deployment.
- Application rollback never automatically runs database down-migrations.
- Prefer backward-compatible expand-and-contract schema changes.
- Take a backup before destructive migrations once valuable alpha data exists.
- Use any backup capability included with the selected Railway PostgreSQL plan initially.
- Document manual `pg_dump` and restore procedures during Phase 1.
- Require verified automated backups before inviting alpha users.

### Deferred from Phase 1

- Playwright and browser automation
- PostgreSQL-backed CI jobs
- Docker builds in CI
- Global coverage thresholds
- Pre-commit hooks
- Gitleaks
- Dependabot
- Clerk production instance
- Custom domain
- Full metrics, tracing, uptime monitoring, and paging

### Phase 1 exit criteria

- [x] Formatting, linting, type checking, tests, builds, generation checks, Atlas checksums, and production audit pass through `pnpm check` and CI.
- [x] The agreed baseline tests cover current authentication, authorization, repository assembly, and empty UI behavior.
- [x] Local PostgreSQL tests cannot target the development database.
- [x] The disposable smoke workflow applies migrations to an empty database and verifies the stack.
- [x] Typed configuration, standardized API errors, request IDs, and structured logging are implemented.
- [x] API liveness and readiness are distinct and tested.
- [x] Production containers use the agreed runtime and shutdown safeguards.
- [x] A successful `main` build deploys automatically to private Railway only after CI passes.
- [x] Atlas pre-deployment failure prevents the API release from starting.
- [x] The authenticated shell works through Railway's web domain with a private API and no development seed.
- [x] Sentry receives scrubbed Railway errors while remaining disabled locally.
- [x] Manual database backup and restore steps are documented and locally rehearsed.
- [x] Branch-protection activation is recorded as a prerequisite for inviting alpha users.

## Phase 2: plan lifecycle and immutable revisions

**Status: refined; implementation planning pending.** The accepted implementation contract is [Phase 2 plan lifecycle and immutable revisions](./phase-2-plan-lifecycle-refinement.md).

Implement revision semantics before allowing agents to write plans. Retrofitting revision history after agent mutation endpoints exist would create significant rework.

### Refined model

A logical plan owns a sequence of revisions and, when unlocked, an editable draft:

```text
Plan
  ├── private ownership and organizational metadata
  ├── lifecycle and activation metadata
  ├── current locked revision
  └── current editable draft, if unlocked

Plan revision
  ├── monotonically increasing revision number
  ├── based-on and superseded revisions
  ├── locked timestamp
  ├── content hash and schema version
  └── normalized revision content
```

Plan content remains relational. Historical core plan data does not become an authoritative JSONB snapshot merely to simplify revisioning. Plans are owner-only during alpha; the existing membership model is removed.

### Lifecycle

1. A new plan starts as an editable draft.
2. User and agent mutations affect only that draft.
3. Locking validates and promotes the complete draft into an immutable revision.
4. Unlocking clones the current locked revision into a new draft.
5. Locking the changed draft creates the next revision.
6. Restoring an old revision copies it into a new draft for human review.
7. Existing revision history is never renumbered or overwritten.

### Initial APIs

```http
GET    /api/v1/plans
POST   /api/v1/plans
GET    /api/v1/plans/:planId
PATCH  /api/v1/plans/:planId

GET    /api/v1/plans/:planId/draft
PATCH  /api/v1/plans/:planId/draft
POST   /api/v1/plans/:planId/draft/validate

POST   /api/v1/plans/:planId/activate
POST   /api/v1/plans/:planId/deactivate
POST   /api/v1/plans/:planId/archive
POST   /api/v1/plans/:planId/unarchive
POST   /api/v1/plans/:planId/unlock
POST   /api/v1/plans/:planId/lock
POST   /api/v1/plans/:planId/draft/discard
GET    /api/v1/plans/:planId/revisions
GET    /api/v1/plans/:planId/revisions/:revisionId
POST   /api/v1/plans/:planId/revisions/:revisionId/restore
```

### Exit criteria

- A user can create and select multiple plans.
- Active plans, the Plan Library, and the archive return the correct sets.
- Draft-only plans cannot be activated.
- Locked revisions cannot be mutated.
- Unlocking creates an isolated editable draft of the complete aggregate.
- Locking creates an immutable revision transactionally after human confirmation.
- Discarding a draft returns to the current locked version without creating history.
- Restoring preserves all intervening history.
- Archiving preserves versions and drafts while making the plan read-only.
- Owner-only authorization applies consistently to plans, drafts, revisions, and workouts.
- A thin signed-in UI exposes every lifecycle operation without introducing chat or a full plan editor.

## Phase 3: plan brief and fitness calibration

The alpha has no global athlete profile or demographic onboarding. Training context belongs to the versioned plan aggregate and may describe the account owner, another person, or a hypothetical scenario without creating a separate runner identity.

### Structured plan brief

The exact schema will be refined at the start of this phase. Candidate plan-specific assumptions include:

- Goal and target date
- Available training days
- Current weekly running volume
- Current longest run
- Recent race or time-trial evidence
- Training limitations and constraints
- Distance and pace units
- Free-text planning context

The agent collects these conversationally, structures them, and asks the user to confirm the brief before generating the schedule.

### Fitness calibration

Extend the existing effective-dated, sport-neutral calibration model but scope calibrations to a plan version for the alpha. The first running implementation may include:

- Recent race result
- Estimated threshold pace
- Easy pace range
- Maximum or threshold heart rate
- Calibration source: manual, race, field test, or agent estimate
- Confidence and explanatory notes

The brief, calibration, resolved zones, and workouts are locked and restored as one linked version.

### Exit criteria

- Plan creation collects and confirms a structured brief through chat.
- No global athlete profile is required.
- Running fitness can differ independently between plans owned by the same account.
- Changing assumptions or calibration requires an unlocked draft.
- Workout pace recommendations identify the versioned calibration that produced them.
- Plan-specific units are applied consistently by the API and UI.

## Phase 4: persistent chats and agent runs

Replace cosmetic local chat state with durable API resources.

### Proposed data

- Conversations
- Messages
- Agent runs
- Agent run events
- Optional conversation-to-plan association
- Cancellation and terminal status
- Model and cost metadata where appropriate

A user message must be persisted before asynchronous agent execution starts. Completed assistant messages must be durable even if partial text was streamed live.

### Initial APIs

```http
GET    /api/v1/conversations
POST   /api/v1/conversations
GET    /api/v1/conversations/:conversationId
PATCH  /api/v1/conversations/:conversationId
POST   /api/v1/conversations/:conversationId/archive
POST   /api/v1/conversations/:conversationId/unarchive
POST   /api/v1/conversations/:conversationId/messages

GET    /api/v1/agent-runs/:runId
GET    /api/v1/agent-runs/:runId/events
POST   /api/v1/agent-runs/:runId/cancel
```

### Exit criteria

- Conversations survive reloads and sign-in cycles.
- Conversations are isolated by athlete authorization.
- Messages have stable ordering and delivery status.
- Agent runs can be observed and cancelled.
- Chats may be archived and restored but not permanently deleted.
- Archived chats are read-only and cannot start agent runs.
- Archiving a plan also archives all associated chats.

## Phase 5: Pi agent worker and domain tools

Create `apps/agent` as an independently deployable private service using Pi's TypeScript SDK.

### Service boundaries

The worker receives:

- A private Askesis API URL
- A scoped machine credential
- LLM provider credentials
- Run identifiers and context available through the API

The worker never receives:

- `DATABASE_URL`
- `CLERK_SECRET_KEY`
- Unrestricted plan access

### Initial tools

Tools should express domain operations rather than SQL or arbitrary HTTP:

```text
read_athlete_profile
read_fitness_calibrations
read_plan_draft
create_plan_draft
add_workout
update_workout
move_workout
delete_workout
validate_plan
lock_plan
```

Every mutation must be authorized against the athlete and plan associated with the agent run. Tools must be idempotent where retries are possible.

### Reliability controls

- Execution timeout
- Cancellation
- Bounded retries
- Tool-call audit trail
- Per-run token or cost budget
- Clear terminal failure states
- Recovery from worker restart
- No partial multi-operation commits where atomicity is required

### Exit criteria

- A chat can launch a durable agent run.
- The agent can create a running plan through authorized API tools.
- The agent can modify only the permitted unlocked draft.
- Tool calls and failures are visible and auditable.
- Worker failure does not corrupt or expose plan data.

## Phase 6: live synchronization and TanStack Query

Introduce TanStack Query and an authenticated server event stream.

### Event examples

```text
chat.message.created
agent.run.started
agent.run.output.delta
agent.tool.started
agent.tool.completed
agent.run.completed
agent.run.failed
plan.draft.changed
plan.locked
plan.restored
```

Durable events may use JSON payloads for integration metadata, but they are not the authoritative copy of plan state. Events should generally identify affected resources so the browser can refetch them.

### Client behavior

```text
plan.draft.changed
    → invalidate plan detail
    → invalidate workouts/calendar

chat.message.created
    → invalidate conversation

agent.run.output.delta
    → update transient streamed response
```

Start with one authenticated SSE connection per browser session. Use ordinary HTTP for browser commands. Add durable event replay or PostgreSQL-backed fan-out only to the degree required by Railway deployment and reconnection behavior.

Avoid storing every individual model token as a separate durable database mutation. Batch transient output while preserving the final assistant message.

### Exit criteria

- Assistant output appears while a response is generated.
- Committed agent plan mutations become visible without manual refresh.
- Reconnection produces correct authoritative state.
- Duplicate or delayed events do not duplicate domain mutations.
- Query invalidation is targeted and observable.

## Phase 7: product management controls

Build the controls required for daily prototype use.

### Plan view and library

- Show active plans in the calendar-based Plan view.
- Toggle between several active plans and remember the last one viewed.
- Show all non-archived plans in the Plan Library.
- Open library plans as details and workout lists without a calendar.
- Clearly label Draft, Locked, Unlocked, Active, and Inactive state.

### Plan controls

- Create and rename
- Activate and deactivate
- Lock and unlock with human confirmation
- Discard an unpublished draft
- View version history and differences
- Restore an older version as a draft
- Archive and unarchive
- Export locked versions or drafts as Markdown

### Chats

- Create and rename
- Associate at most one logical plan
- Archive and restore
- Display run status and working version
- Cancel a running response

### Account

- Manage Clerk name, email, authentication methods, and profile image
- Sign out
- Access archived plans and chats

There is no global Askesis athlete profile and no user-facing permanent deletion flow in the alpha. Maintain a documented operator-assisted process for data-removal requests.

### Export

An initial endpoint can generate Markdown from the authoritative normalized representation:

```http
GET /api/v1/plans/:planId/export?format=markdown&source=locked
GET /api/v1/plans/:planId/export?format=markdown&source=draft
```

Draft exports must be labelled. Chats and private agent reasoning are excluded.

### Exit criteria

- Users can manage their own plans and conversations without database access.
- Active plans, the library, and archive have distinct and understandable roles.
- Human review gates lock, unlock, discard, and restore actions.
- Permanent deletion is absent from user-facing controls.
- Markdown export represents the complete selected version or draft.

## Phase 8: friends-and-family release

Complete the operational and product work required before invitations are sent.

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
- A user can create, revise, lock, restore, and export a plan through chat.
- Cross-user access tests pass.
- Backups, monitoring, cost controls, and the operator-assisted data-removal process are operational.
- The repository can be shared publicly without exposing private data.

## Phase 9: post-alpha differentiating features

These features should be informed by prototype usage rather than block the initial release.

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

# Milestone summary

## Milestone 1: durable plan foundation

- Phase 0 product contract
- Engineering foundation and CI
- Private Railway deployment rail
- Multiple plans
- Draft, lock, activation, archive, and immutable version model
- Structured plan brief and plan-specific running calibration

## Milestone 2: working coach

- Persistent conversations
- Durable agent runs
- Separate Pi worker
- Authorized domain tools
- Plan creation and modification through chat

## Milestone 3: live editing

- TanStack Query
- Authenticated event stream
- Streaming assistant responses
- Live plan refresh after tool operations
- Cancellation and failure recovery
- Version history and restore UI

## Milestone 4: private alpha

- Plan, chat, and account controls
- Markdown export
- Refined first-use journey and interface
- Rate and spending limits
- Monitoring and backups
- Invitation-only Clerk production setup
- Open-source repository cleanup

## Milestone 5: differentiating features

- Plan merging
- Combined active-plan calendar
- Prompt customization
- Versioned sport skills
- Wider multi-sport support

# Reassessment points

Major technical choices should be reconsidered based on evidence rather than pre-emptively.

### After the first working agent loop

Assess whether Hono domain tools and the OpenAPI client provide a productive agent interface.

### After live synchronization is deployed

Assess event-stream complexity, reconnection behavior, query invalidation, and Railway multi-instance requirements.

### After several months of prototype use

Reconsider:

- Convex or another reactive backend
- TanStack Router or TanStack Start
- A dedicated queue
- Redis or external event fan-out
- Terraform/OpenTofu
- A staging environment
- Broader multi-sport support

Any replatforming decision should compare measured development and operational pain against migration cost and the value of PostgreSQL's relational model.
