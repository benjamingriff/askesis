# Phase 2 implementation plan

## Status

**Approved; implementation in progress.** This plan implements the accepted [Phase 2 lifecycle refinement](./phase-2-plan-lifecycle-refinement.md) using the approved [Phase 2 schema contract](./phase-2-schema-contract.md).

## Delivery strategy

- Develop Phase 2 on one integration feature branch.
- Use reviewable commits or stacked pull requests within that branch if useful.
- Do not preserve Phase 1 application compatibility at intermediate commits.
- Merge to `main` once the complete cutover is ready.
- Accept a maintenance window and temporary loss of application functionality during the deployment.
- Treat successful Railway deployment and authenticated lifecycle smoke testing as part of Phase 2 completion.

## Architecture

Phase 2 remains within the existing application boundaries:

```text
React + TanStack Query
          ↓
generated OpenAPI client
          ↓
Hono plan routes
          ↓
plan lifecycle service
          ↓
Kysely repositories and PostgreSQL transactions
```

- The API is the sole lifecycle authority.
- Routes translate HTTP input and errors.
- The lifecycle service owns state transitions and transaction orchestration.
- Repositories own relational queries and bulk cloning.
- Pure TypeScript helpers own validation, canonical hashing, and summaries.
- PostgreSQL owns local integrity and locked-content enforcement.
- The browser and future agent do not import or reimplement lifecycle rules.
- No shared domain package, stored-procedure business layer, outbox, or event system is introduced.

## Implementation sequence

Progress: the schema migration, draft fixture, generated database types,
version-aware workout reads, and schema/cutover checks are implemented on
`phase-2-plan-lifecycle`. The fixture will be published through the lifecycle
service in Stage 2. The remaining stages are not implemented yet.

### Stage 1: destructive schema foundation

Create one append-only Atlas migration that:

- Preserves athletes and authentication identities.
- Resets the existing plan, membership, workout, calibration, movement-reference, and related seed state.
- Creates the logical-plan and unified plan-version structures.
- Recreates the complete current aggregate beneath `plan_version_id`.
- Adds physical and lineage identity.
- Adds same-version composite foreign keys and lifecycle constraints.
- Introduces immutable movement definitions.
- Adds idempotency storage.
- Adds immutability and deferred pointer-validation triggers.
- Recreates version-aware summary views.
- Updates the Atlas checksum.

Then:

- Apply the full migration history locally to an empty database.
- Apply the cutover to a database containing representative athletes, identities, and old plan data.
- Verify identities survive and plan-domain data is reset.
- Regenerate Kysely database types.
- Update `/api/ready` to require the new migration.

The Cardiff fixture and SQL development seed are rewritten for the new schema. The fixture creates a representative locked active Version 1 with plan-specific calibration and lineages. It uses a new seed key and safely upserts the synthetic athlete without affecting externally authenticated identities. The reset script removes fixture-owned data without deleting a real authenticated account. Railway remains unseeded.

### Stage 2: plan module and revision core

Add an API-local `plans` module with:

- Schemas and stable error codes.
- Owner-scoped repositories.
- A lifecycle service with transaction injection.
- Canonical aggregate assembly and hashing.
- A composable validation pipeline.
- Concise lineage-aware change summaries.
- Bulk clone support with physical-ID remapping.
- Idempotency handling.

Implement and prove the first backend journey:

1. Create a plan with an initial draft.
2. Read and edit draft header fields.
3. Preview validation.
4. Lock Version 1.
5. Unlock by cloning.
6. Edit and lock Version 2.
7. Unlock and discard back to Version 2.

Database and service tests cover promotion-in-place, monotonically increasing numbers, content hashes, warning acknowledgement, no-op rejection, stale concurrency, idempotent retries, complete cloning, and attempted mutation of locked content.

### Stage 3: organization and history API

Complete owner-only plan management:

- List active, library, and archived collections.
- Read logical plan detail and explicit current pointers.
- Rename logical plans.
- Activate and deactivate.
- Archive and unarchive while preserving underlying state.
- List and inspect immutable revisions.
- Preview restore differences.
- Restore an eligible historical revision as a draft.

Make existing workout reads version-aware:

- Workout lists require an explicit plan-version identifier.
- Workout detail resolves and returns its owning version.
- Historical, current locked, and draft content cannot be mixed implicitly.
- Remove every membership authorization path.

Update the Hono registration, OpenAPI document, generated API client, and generated-artifact checks together. Breaking the existing workout API is intentional.

### Stage 4: TanStack Query and functional UI

Introduce TanStack Query without live events:

- Install and configure one application query client.
- Put Clerk-authenticated generated-client calls behind query and mutation functions.
- Use explicit invalidation and authoritative refetch after mutations.
- Do not add optimistic plan-content writes, persistence, streaming, or event subscriptions.

Build the agreed surfaces:

1. `/plan` for active plans, plan selection, and locked/draft viewing.
2. `/plans` for the non-archived Plan Library and creation.
3. `/plans/:planId` for details, draft-header editing, lifecycle actions, and embedded history.
4. `/plans/:planId/versions/:revisionId` for immutable revision inspection and restore preview.
5. `/plans/archive` for archived plans and unarchive.

Browser-local preferences remember the selected active plan and whether its locked version or draft was last viewed. Queries still identify the source explicitly.

Confirmation UI covers unlock, validation and lock, discard, restore, archive, and unarchive. Validation errors are not confirmable; every warning must be acknowledged. Styling remains consistent with the existing application but is deliberately functional rather than a Phase 7 polish pass.

### Stage 5: verification and direct deployment

Run the full lightweight suite:

```bash
pnpm check
```

Run required local database and full-stack verification:

```bash
pnpm test:db
pnpm smoke
```

PostgreSQL integration tests remain local and are not added to GitHub Actions. CI continues to enforce unit and mocked route tests, UI component tests, types, builds, generated artifacts, Atlas checksums, and the production audit.

Before merging:

- Rehearse the destructive cutover locally from the Phase 1 schema.
- Confirm athlete identities survive and old plans are removed.
- Confirm the new seed can be reapplied idempotently in development.
- Exercise every lifecycle transition through the local signed-in UI.
- Confirm owner-only hidden authorization behavior.
- Confirm database triggers reject locked-content writes.
- Review logs and Sentry scrubbing for new routes.

For Railway:

1. Confirm Phase 1 deployment prerequisites are closed.
2. Optionally take a final database snapshot even though plan data is disposable.
3. Merge the complete Phase 2 branch to `main`.
4. Allow the Atlas pre-deploy command to perform the destructive cutover.
5. Verify readiness reports the Phase 2 migration.
6. Exercise the authenticated lifecycle from the public web domain.
7. Confirm Railway contains no development fixture.
8. Inspect API/web logs and Sentry.
9. Record results and any accepted limitations in the current handoff.

## API contract worklist

The implementation will refine exact request and response schemas around this surface:

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

GET    /api/v1/workouts?planVersionId=:planVersionId
GET    /api/v1/workouts/:workoutId
```

The list endpoint supports explicit active, library, and archive collection filters. Plan detail returns lifecycle state and version summaries; draft and revision endpoints return explicitly sourced content. Mutation responses return the updated authoritative resource and concurrency values.

State conflicts use stable machine-readable errors, including stale state, stale draft, missing draft, existing draft, archived read-only state, invalid activation, non-discardable initial draft, validation failure, unacknowledged warnings, no semantic changes, ineligible restore, and idempotency-key reuse.

## Test matrix

### Lightweight CI tests

- Schema parsing and HTTP validation.
- Route-to-service behavior with mocked services.
- Stable error-envelope mapping.
- Canonical serialization, numeric normalization, and hashing.
- Pure validator findings and severity.
- Lineage-aware summary generation.
- TanStack Query hooks and mutation invalidation.
- Empty, loading, error, and lifecycle UI states.
- Confirmation and warning-acknowledgement behavior.
- Generated OpenAPI/client consistency.

### Local PostgreSQL tests

- Clean migration and destructive cutover behavior.
- Plan creation and owner scoping.
- Logical and draft concurrency conflicts.
- Idempotency under retry and key misuse.
- Draft-to-locked promotion.
- Version number serialization under concurrent lock attempts.
- Complete aggregate clone with physical-ID remapping and retained lineage.
- Restore ancestry and identical-content rejection.
- Draft discard and initial-draft prohibition.
- Activation, archive, and unarchive invariants.
- Database rejection of metadata or draft-content writes while archived.
- Same-version foreign-key enforcement.
- Locked version and child-row immutability triggers.
- Plan-specific calibration resolution.
- Version-aware workout list and detail authorization.
- Version-aware derived views.

## Commit and review shape

Suggested reviewable commits within the Phase 2 branch:

1. Accept Phase 2 contracts and implementation plan.
2. Add destructive schema migration, seed rewrite, generated DB types, and migration tests.
3. Add canonical aggregate, validators, hashing, summaries, and pure tests.
4. Add plan repositories, lifecycle service, revision-core routes, and database tests.
5. Add organization, history, restore, and version-aware workout APIs.
6. Regenerate OpenAPI/client and complete lightweight API tests.
7. Add TanStack Query and the functional plan UI.
8. Complete local verification, deployment documentation, and handoff updates.

These commits need not leave the feature branch deployable individually. The final branch must pass all agreed verification before merge.

## Review checkpoint

Before production implementation begins, review and approve:

- The table responsibilities and relationship model in the schema contract.
- Unified draft/locked version containers.
- Direct `plan_version_id` ownership on all plan content.
- The two-pointer lifecycle representation.
- Physical ID plus lineage ID.
- Destructive plan-domain reset while preserving athlete identities.
- API-local orchestration and version-aware workout contract.
- The five implementation stages and final Railway deployment gate.
