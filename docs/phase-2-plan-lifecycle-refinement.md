# Phase 2 plan lifecycle and immutable revisions

## Status

**Refinement complete; implementation planning pending.** This document is the accepted Phase 2 product and architecture contract produced by the pre-implementation grilling session. It refines the Phase 2 summary in the [V1 proof-of-concept development plan](./v1-poc-development-plan.md).

Implementation details may be refined without reopening this contract. A change that alters the lifecycle, version boundary, ownership model, or user-visible Phase 2 scope should be treated as a product decision.

## Objective and delivery boundary

Phase 2 establishes immutable plan history before chats and agents are allowed to mutate plans.

It delivers:

- The complete lifecycle and revision backend.
- A thin, functional signed-in UI through which an owner can exercise every lifecycle operation.
- Relational immutable revisions, validation, restoration, concurrency protection, and owner authorization.

It does not deliver:

- Persistent chat or agent interaction.
- A full workout or plan-content editor.
- Rich field-by-field diffs.
- Markdown export.
- Product-quality visual refinement.
- Plan sharing, ownership transfer, or collaboration.

The temporary Phase 2 creation form is scaffolding rather than the final conversational creation journey. Creating a plan does not create a chat during this phase. Phase 4 will create a first chat lazily for existing plans and transactionally for plans created through the later conversational flow.

## Logical plan and version boundary

A logical plan is a private organizational container. It owns locked versions and, when applicable, one editable draft.

Logical-plan metadata remains outside version history:

- Plan UUID.
- Owner.
- Display name.
- Active/inactive state.
- Archived state.
- Lifecycle and metadata concurrency state.
- Created and updated timestamps.

Display names:

- Are required and non-empty.
- May be duplicated within an account.
- May be changed without unlocking, except while archived.
- Are not used as routing identity. Application and API routes use the plan UUID.
- Do not require a slug.

Content that defines or affects the prescription belongs to the draft or locked version:

- Description.
- Start and end dates.
- Goals and constraints.
- Plan brief and training assumptions introduced later.
- Fitness calibration and training zones.
- Blocks, weeks, and week targets.
- Workouts, steps, completions, targets, tags, and prescriptions.
- Other future fields that change the training plan's meaning.

Calibration and zones are plan-version-specific during alpha. Values may later be copied between plans, but locked plans never reference a live mutable athlete-level calibration.

## Lifecycle representation

Lifecycle is derived from independent facts rather than one overloaded status enum:

```text
current_locked_version_id  nullable
current_draft_version_id   nullable
activated_at               nullable
archived_at                nullable
```

The user-facing states are:

- **Draft**: a draft exists and no locked version exists.
- **Locked**: a locked version exists and no draft exists.
- **Unlocked**: both a locked version and an editable draft exist.
- **Active**: activation is set. Active is independent of Locked or Unlocked.
- **Archived**: archive is an overlay that retains the underlying content state.

Database constraints must ensure that:

- A plan always has a draft or a locked version.
- At most one draft exists for a plan.
- An active plan has a locked version.
- An archived plan cannot be active.
- Current-version pointers refer to versions owned by the same logical plan.

## New plans and initial drafts

- Creating a plan requires only a display name.
- Creation atomically creates the logical plan and an empty initial draft.
- Draft description and dates may initially be absent.
- Phase 2 provides thin UI editing for description, start date, and end date.
- The initial draft cannot be discarded because no locked version exists to return to.
- Abandoning an initial draft means archiving the logical plan.
- There is no user-facing permanent deletion during alpha.

A locked revision must have start and end dates, with the end on or after the start. Phase 2 permits a structurally valid version with no goals, blocks, weeks, or workouts to be locked and activated. An empty schedule produces a warning. Later phases may strengthen plan-readiness validation when the plan brief, calibration, and agent-generated schedules exist.

## Activation and plan selection

- Any number of plans may be active simultaneously.
- Activation means that a plan is available in the main Plan area; it does not make it a primary or canonical plan.
- Each plan retains its own calendar. A combined multi-plan calendar remains deferred.
- Draft-only and archived plans cannot be activated.
- Unlocking an active plan does not deactivate it.
- Archiving automatically deactivates a plan.
- Unarchiving never automatically reactivates it.

When an active plan is unlocked, the UI supports both:

- The stable current locked version being followed.
- The unpublished draft being reviewed or edited.

Unlocking initially opens the draft. The browser remembers the selected plan and locked/draft view as local UI preferences. Backend reads never infer content source from those preferences.

## Drafts, locking, and immutability

A draft and a locked revision use the same relational version container.

Locking:

1. Validates the current draft.
2. Confirms its edit number and canonical content hash.
3. Requires acknowledgement of all current warnings.
4. Promotes that draft version in place.
5. Assigns the next monotonically increasing version number.
6. Stores the final validation result and change summary.
7. Atomically moves the logical plan's current locked-version pointer and clears its draft pointer.

Promoting in place preserves the physical row identifiers that future validation, chats, and agent runs may have referenced while the content was a draft.

Locked content is immutable in both application code and PostgreSQL. Database protection must reject ordinary updates and deletions to a locked version or any content owned by it. A separately controlled operator process may still remove account data when required.

Unlocking:

- Clones the complete current locked aggregate into a new editable version.
- Preserves the locked source unchanged.
- Returns the existing draft when the plan is already unlocked.
- Runs synchronously in one PostgreSQL transaction during alpha.

Calling lock on a draft whose semantic content matches the current locked version does not create another revision. The draft remains available to edit or discard. The initial draft is the exception: it may become Version 1 even when it contains no schedule.

## Human confirmation and agent authority

Lock and unlock are human publication controls.

A future agent may propose an inline lifecycle action, but confirmation in the browser sends an owner-authorized command directly to the core API. The agent worker does not receive lock or unlock permission and does not interpret conversational assent as authority to perform either operation.

No creator, locker, or single revision-author field is required. Future conversations and agent-run records provide operation-level audit where needed. Revisions also do not have user-authored names or commit messages during alpha.

The UI displays sequential labels such as **Version 1** and **Version 2**. Immutable UUIDs address revisions through the API but are not normally shown to users.

## Validation and confirmation

Validation has two severities:

- **Error**: blocks locking and cannot be overridden through the normal API.
- **Warning**: permits locking only after fresh, explicit acknowledgement.

The lock flow is deliberately two-step:

1. A validation preview returns the draft edit number, content hash, concise change summary, errors, and warnings.
2. The confirmed lock includes the expected edit number, expected hash, and acknowledged warning codes.
3. The server re-runs validation within the locking transaction.
4. Changed content or findings invalidate the confirmation.

The immutable locked revision retains its validation findings, warning acknowledgement, validator version, and validation timestamp.

Phase 2 confirmation summaries include:

- Source and destination version or draft.
- Changed description and plan dates.
- Counts of goals, constraints, blocks, weeks, and workouts added, changed, or removed.
- Affected workouts identified by date and title.
- Validation errors and warnings.
- An explicit warning when older content will replace the current schedule after locking.

Full field-level prescription diffs remain deferred, although semantic comparison covers the complete aggregate.

### Structural validation boundary

Every persisted entity must remain locally well-formed, even in a draft. PostgreSQL and the API always enforce referential integrity, same-version ownership, valid individual value shapes and units, positive values where required, valid local date ranges, valid workout-step trees, and unique structural positions.

Drafts may be incomplete or globally inconsistent while being edited. Missing plan dates, absent sections, cross-record overlaps, out-of-range content, and similar complete-aggregate problems may persist in a draft but are evaluated before locking.

Locking treats the following as errors:

- A block outside the plan dates.
- Overlapping blocks.
- A week outside its block or plan.
- Overlapping weeks.
- A workout outside its assigned week or plan.
- Structurally inconsistent ordering.
- Cross-plan or cross-version references.

Locking treats the following as warnings:

- Gaps between blocks or weeks.
- Weeks that are not seven days long.
- Empty blocks or weeks.
- Plan days not covered by a block or week.
- Unusual multiple-workout ordering on one date.
- A plan containing no workouts.

## Canonical content hashing

Each locked version stores a SHA-256 hash of a deterministic canonical representation of the complete semantic aggregate.

The canonical representation:

- Includes every plan-affecting field and meaningful ordering.
- Normalizes dates, numbers, nulls, and collection order.
- Excludes physical row IDs, lineage IDs, timestamps, revision numbers, validation results, and provenance.
- Has an explicit hash-format version independent from the content-schema version.

The draft hash is calculated during validation and locking. Hashes support unchanged-lock detection and rejection of restores whose content is already current. Because lineage is not semantic content, deleting and recreating visibly identical content does not by itself justify a new revision.

## Entity identity and lineage

Version-owned entities have:

- A globally unique physical row ID for unambiguous API references.
- A stable lineage ID copied when the conceptual entity continues across versions.

Lineage follows explicit operation intent rather than inferred similarity:

- Moving or editing an entity preserves lineage regardless of the magnitude of the edit.
- Delete-and-create starts a new lineage.
- Bulk regeneration starts new child lineages by default.
- Restore preserves the historical lineages from the restored revision.
- The API owns lineage assignment; clients cannot arbitrarily set it.

Lineage supports trustworthy summaries and later detailed diffs without pretending that similar-looking replacement content is the same entity.

## Revision ancestry and restore

Every locked revision after Version 1 records two relationships:

- `supersedes_version_id`: the revision that was current immediately before the lock.
- `based_on_version_id`: the revision whose content formed the draft's starting point.

For an ordinary unlock, edit, and lock, both relationships identify the former current revision. When Version 2 is restored while Version 4 is current, the restored draft is based on Version 2; locking it creates Version 5, which supersedes Version 4.

Restore behavior:

- Restore always creates a draft; it never rewrites or directly replaces revision history.
- Existing revisions are never deleted, overwritten, or renumbered.
- Restore is blocked while any draft exists. The existing draft must first be locked or discarded.
- Restoring the current revision or semantically identical content is rejected as a no-op.
- Restoring from an archived plan is blocked until the plan is unarchived.
- Restore and its complete aggregate clone run synchronously in one transaction.

Discard behavior:

- Discard is available only when a locked version exists.
- It removes the unpublished draft without creating a revision.
- It requires explicit confirmation and current concurrency values.
- It returns the plan to its current locked content.

## Archive behavior and retention

- Draft, Locked, and Unlocked plans may all be archived.
- Archiving retains all locked versions and any unpublished draft.
- Archived plans are entirely read-only, including their display names.
- Owners may inspect archived drafts, locked versions, validation results, and history.
- Unarchiving restores the exact prior content state but leaves the plan inactive.
- Archive and unarchive require explicit confirmation and create no revision.
- All plans, including empty never-locked plans, use Archive rather than Delete.

## Ownership and authorization

- Every plan is private to exactly one account.
- A plan may describe its owner, another person, or a hypothetical scenario without changing ownership.
- Every plan, draft, revision, workout, and lifecycle endpoint is owner-only.
- Inaccessible and nonexistent resources follow the API's hidden-authorization behavior.
- There is no plan sharing, membership, transfer, or collaboration during alpha.
- The existing `plan_memberships` table and member-based workout authorization are removed in Phase 2.
- Markdown export is the future sharing mechanism, but export itself is outside Phase 2.

## Shared reference data

Global reference data that can affect rendered plan meaning must not be mutable beneath locked revisions.

For alpha, movement definitions are immutable catalog entries:

- Referenced definitions are never edited in place.
- A correction or material change creates a new definition.
- Existing plan versions retain their original reference.
- Drafts may explicitly adopt a newer definition.
- Referenced definitions cannot be deleted.

## Schema evolution

Every draft and revision records a `content_schema_version`.

- Locked revisions retain the schema version with which their content was created.
- The application supports reading retained historical schema versions.
- Unlocking or restoring copies old content into a draft and upgrades that editable copy to the current schema.
- A storage migration may reorganize or backfill historical rows only when it preserves user-visible meaning.
- A semantic change must occur through a new draft and revision rather than rewriting history.

## API boundaries

Reads identify their content source explicitly:

```http
GET   /api/v1/plans
POST  /api/v1/plans
GET   /api/v1/plans/:planId
PATCH /api/v1/plans/:planId

GET   /api/v1/plans/:planId/draft
PATCH /api/v1/plans/:planId/draft
POST  /api/v1/plans/:planId/draft/validate

GET   /api/v1/plans/:planId/revisions
GET   /api/v1/plans/:planId/revisions/:revisionId
```

- Plan detail returns logical metadata, derived lifecycle state, and identifiers or summaries for the current locked version and draft.
- Draft and revision endpoints return the explicitly requested aggregate.
- `PATCH /plans/:planId` changes logical metadata only.
- `PATCH /plans/:planId/draft` changes versioned content only.
- No backend read chooses draft or locked content based on UI preference.

Lifecycle commands remain explicit endpoints for activate, deactivate, archive, unarchive, unlock, lock, discard, and restore-as-draft.

## Concurrency and retries

Optimistic concurrency uses two independent counters:

- A plan state version changes with metadata, activation, archive state, or current-version pointers.
- A draft edit number changes only when versioned content changes.

Lifecycle operations check the applicable plan state version. Draft mutations and validation check the draft edit number. Lock checks both. Stale operations fail atomically rather than merging or overwriting newer work.

Future plan-mutating agent runs may add a renewable single-run lease, but they must still use the same optimistic checks.

Desired-state operations are idempotent when their result is already true, including activating an active plan, deactivating an inactive plan, archiving an archived plan, and opening an existing draft through unlock.

Create, lock, discard, and restore accept idempotency keys so safe retries return the original result. Reusing a key with different input is rejected. Incompatible commands still return conflicts.

No-op metadata or draft patches return the current resource without incrementing concurrency counters or creating artificial changes.

## Minimum Phase 2 UI

Phase 2 supplies five functional surfaces:

1. **Plan view**: active-plan selector, remembered locked/draft view, calendar or workout content, and an empty state.
2. **Plan Library**: all non-archived plans, lifecycle badges, creation, and navigation.
3. **Plan details**: metadata and draft-header editing plus applicable lifecycle controls.
4. **Version history**: sequential versions, automatic summaries, inspection, and eligible restore actions.
5. **Archive**: archived-plan listing, read-only inspection, and unarchive.

Human confirmation gates unlock, lock, discard, restore, archive, and unarchive. Activation and deactivation remain straightforward organizational actions.

## Migration and deployment

Phase 2 uses a direct schema cutover because current prototype data is not valuable enough to justify a staged compatibility period.

The append-only Atlas migration will:

- Preserve athletes and their external authentication identities.
- Intentionally remove all existing plan, workout, calibration, membership, and related development-fixture data.
- Create logical plans, version containers, lineage, pointers, constraints, and immutability protection.
- Recreate description, dates, and all plan-affecting structures beneath a version.
- Remove obsolete status, slug, and membership structures without compatibility shims.
- Rebuild shared reference structures such as the movement catalog where the immutable-reference design requires it.

No legacy plan is converted into Version 1 and no migration validation records are fabricated. Local fixtures are rewritten for the new model and loaded only through the development seed workflow. A maintenance window, loss of existing plan data, and inability to roll the old application back onto the new schema are explicitly accepted.

## Testing boundary

Phase 2 does not add PostgreSQL to GitHub Actions. Hosted CI remains lightweight to control build time and cost.

Required local verification includes:

- Applying the full Atlas migration history to an empty database.
- Applying the Phase 2 cutover to a representative existing database and verifying that athlete identities survive while legacy plan-domain data is removed.
- Real PostgreSQL repository and API integration tests for cloning, locking, restore, triggers, concurrency, idempotency, and authorization.
- The disposable full-stack smoke workflow.

CI continues to cover unit tests, mocked route behavior, OpenAPI/client generation, type checking, UI component behavior, builds, and Atlas checksum consistency.

## Phase 2 completion criteria

Phase 2 is complete when:

- An owner can create and navigate multiple private plans through the thin UI.
- Active plans, the library, and the archive expose the correct sets.
- Every lifecycle transition obeys the agreed state rules and confirmation gates.
- Draft-only plans cannot be activated or discarded.
- Locked content cannot be mutated through the API or ordinary database writes.
- Unlock and restore clone the complete normalized aggregate atomically.
- Lock promotes a changed, freshly validated draft into the next immutable version.
- No-op lock and restore requests create no history.
- Discard restores the current locked state without creating history.
- Restore retains both chronological and content ancestry.
- Archive preserves all content while making it read-only and inactive.
- Owner-only authorization applies to all plan-related data.
- Local PostgreSQL integration and full-stack smoke suites pass.
