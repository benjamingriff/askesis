# Phase 2 schema contract

## Status

**Approved for implementation.** This document translates the accepted [Phase 2 lifecycle refinement](./phase-2-plan-lifecycle-refinement.md) into the relational contract for implementation. It intentionally specifies ownership, keys, relationships, and invariants rather than final migration SQL.

Once approved, implementation may adjust names or indexes where PostgreSQL or Kysely requires it, but it must not weaken the stated invariants without reopening the contract.

## Relational overview

```text
athletes
  └── plans
        ├── current_locked_version_id ─┐
        ├── current_draft_version_id ──┼── plan_versions
        └── plan_versions ─────────────┘       ├── plan_goals
                                               ├── plan_constraints
                                               ├── training_blocks
                                               │     └── training_weeks
                                               │           ├── week_targets
                                               │           └── workouts
                                               │                 ├── workout_tags
                                               │                 └── workout_steps
                                               │                       ├── step_completions
                                               │                       └── step_targets
                                               └── calibration_profiles
                                                     ├── calibration_zones
                                                     └── plan_calibration_periods

movement_definitions ── referenced immutably by workout_steps
api_idempotency_keys ── scoped to athlete and command
```

`athletes` and `athlete_identities` survive the Phase 2 cutover. The existing plan-domain tables, calibration data, memberships, views, and development fixture data are intentionally reset and recreated under this contract.

## Logical plans

### `plans`

One row represents one private organizational plan container.

| Column                      | Contract                                                           |
| --------------------------- | ------------------------------------------------------------------ |
| `id`                        | UUID primary key and sole routing identity.                        |
| `owner_id`                  | Required foreign key to `athletes`; indexed.                       |
| `display_name`              | Required non-empty text; not unique.                               |
| `state_version`             | Positive integer optimistic-concurrency counter, initially `1`.    |
| `current_locked_version_id` | Nullable pointer to a locked version belonging to this plan.       |
| `current_draft_version_id`  | Nullable pointer to the sole draft version belonging to this plan. |
| `activated_at`              | Nullable timestamp; non-null means active.                         |
| `archived_at`               | Nullable timestamp; non-null means archived.                       |
| `created_at`                | Required creation timestamp.                                       |
| `updated_at`                | Required timestamp for logical metadata or lifecycle changes.      |

There is no slug, status enum, primary-plan marker, completed state, sharing state, or membership relationship.

Required invariants:

- At least one current-version pointer is non-null.
- The two current pointers cannot identify the same version.
- An active plan has a current locked version.
- An archived plan is inactive.
- Both current pointers identify versions owned by the same plan.
- The locked pointer identifies a locked version and the draft pointer identifies a draft.
- Only the owner may read or mutate the plan through the application.

The circular plan/version references are deferrable so plan creation and draft creation can commit atomically. A deferred constraint trigger verifies pointer ownership and version state at transaction commit.

## Drafts and locked versions

### `plan_versions`

One table represents both editable drafts and immutable locked revisions. Locking promotes the existing draft row rather than copying it again.

| Column                       | Contract                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                         | UUID primary key.                                                                               |
| `plan_id`                    | Required foreign key to the owning logical plan.                                                |
| `state`                      | `draft` or `locked`.                                                                            |
| `version_number`             | Null for drafts; positive and required for locked versions.                                     |
| `edit_number`                | Positive optimistic-concurrency counter; changes only while a draft's semantic content changes. |
| `description`                | Nullable versioned text.                                                                        |
| `start_date`                 | Nullable in drafts; required when locked.                                                       |
| `end_date`                   | Nullable in drafts; required when locked.                                                       |
| `based_on_version_id`        | Nullable same-plan reference to the version from which this content was cloned.                 |
| `supersedes_version_id`      | Nullable same-plan reference to the revision that was current before this version locked.       |
| `content_schema_version`     | Positive integer describing the aggregate schema.                                               |
| `content_hash`               | Null for drafts; required SHA-256 digest for locked versions.                                   |
| `content_hash_version`       | Null for drafts; required positive canonicalization version when locked.                        |
| `validator_version`          | Null for drafts; required validator version when locked.                                        |
| `validation_findings`        | Derived JSONB array retained on a locked version.                                               |
| `acknowledged_warning_codes` | Text array retained on a locked version.                                                        |
| `change_summary`             | Derived JSONB summary retained on a locked version.                                             |
| `locked_at`                  | Null for drafts; required for locked versions.                                                  |
| `created_at`                 | Required timestamp.                                                                             |
| `updated_at`                 | Draft edit timestamp; becomes fixed when locked.                                                |

Required invariants:

- There is at most one draft per logical plan, enforced by a partial unique index.
- Locked version numbers are unique per plan and never reused.
- A draft has no version number, locked timestamp, stored content hash, or final validation metadata.
- A locked version has all publication metadata and a complete date range.
- `end_date` cannot precede `start_date` when both are present.
- `based_on_version_id` and `supersedes_version_id` reference locked versions of the same plan.
- Version 1 may have both ancestry fields null.
- Later ordinary revisions use the former current revision for both ancestry fields.
- A restored revision may use different `based_on` and `supersedes` values.
- A locked version row cannot be updated or deleted through ordinary application access.

The plan row is locked during lifecycle transitions. The next version number is assigned inside the same transaction, preventing two locks from receiving the same number.

## Identity for version-owned content

Every independently addressable version-owned entity has:

- `id`: a globally unique physical UUID for an individual row in one version.
- `lineage_id`: a UUID representing declared continuity across versions.
- `plan_version_id`: a required direct reference to its owning version.
- A unique constraint on `(plan_version_id, lineage_id)`.

This applies to:

- Goals.
- Constraints.
- Blocks.
- Weeks.
- Week targets.
- Workouts.
- Workout steps.
- Step targets.
- Calibration profiles.
- Calibration zones.
- Calibration periods.

One-to-one subordinate values such as a step completion inherit identity from their parent step. Set-like values such as workout tags use their parent and value as identity rather than carrying artificial lineage.

All version-owned tables carry `plan_version_id`, including deeply nested tables. Composite foreign keys use it to prevent a row from referencing a parent in another version.

Clone behavior:

- Physical IDs are regenerated.
- Lineage IDs are copied for continued entities.
- Parent references are remapped to the new physical IDs.
- Bulk replacement creates new lineage unless an operation explicitly declares continuity.
- Restore copies the selected historical lineage values.

## Versioned plan tables

The existing value shapes and local constraints remain unless this contract changes them.

### `plan_goals`

- Replaces `plan_id` with `plan_version_id`.
- Adds `lineage_id`.
- Retains goal type, priority, discipline, event, distance, duration, and description fields.
- Event dates may be globally inconsistent in a draft but are checked by lock-time validation.

### `plan_constraints`

- Replaces `plan_id` with `plan_version_id`.
- Adds `lineage_id`.
- Retains constraint type, severity, discipline, value, unit, weekday, and description fields.

### `training_blocks`

- Replaces `plan_id` with `plan_version_id`.
- Adds `lineage_id`.
- Position remains unique within a version.
- Local start/end order remains a database constraint.
- Plan containment and overlap remain lock-time aggregate validation.

### `training_weeks`

- Replaces `plan_id` with `plan_version_id`.
- Adds `lineage_id`.
- Its block foreign key includes `plan_version_id`.
- Week number remains unique within a version.
- Position remains unique within a block.
- Local start/end order remains a database constraint.

### `week_targets`

- Adds `plan_version_id` and `lineage_id`.
- Its week foreign key includes `plan_version_id`.
- Retains metric, discipline, range, and unit constraints.

### `workouts`

- Replaces `plan_id` with `plan_version_id`.
- Adds `lineage_id`.
- Its week foreign key includes `plan_version_id`.
- Scheduled-date position remains unique within a version.
- Retains title, description, purpose, discipline, priority, estimates, and timestamps.

### `workout_tags`

- Adds `plan_version_id`.
- Its workout foreign key includes `plan_version_id`.
- The primary key remains the physical workout ID plus normalized tag value.

### `workout_steps`

- Adds `plan_version_id` and `lineage_id`.
- Workout and parent-step foreign keys include `plan_version_id`.
- The parent relationship also guarantees that parent and child belong to the same workout.
- Retains tree shape, kind, role, movement reference, repetition, label, and instructions.
- One root per workout and sibling-position uniqueness remain database constraints.

### `step_completions`

- Adds `plan_version_id`.
- Its step foreign key includes `plan_version_id`.
- Remains a one-to-one subordinate value keyed by physical step ID.
- Retains completion-shape constraints.

### `step_targets`

- Adds `plan_version_id` and `lineage_id`.
- Its step foreign key includes `plan_version_id`.
- Retains target ordering, value ranges, zone references, and shape constraints.

## Plan-specific calibration

### `calibration_profiles`

- Replaces `owner_id` with `plan_version_id`.
- Adds `lineage_id`.
- Retains discipline, system, method, fitness value, source description, and creation timestamp.
- Profiles are copied with their plan version and are never shared live between plans.

### `calibration_zones`

- Adds `plan_version_id` and `lineage_id`.
- Its profile foreign key includes `plan_version_id`.
- Retains zone key, metric, value range, and unit constraints.

### `plan_calibration_periods`

- Replaces `plan_id` with `plan_version_id`.
- Adds `lineage_id`.
- Its profile foreign key includes `plan_version_id`.
- Effective ranges remain locally valid and non-overlapping for a system within a version.

Phase 3 may add or refine calibration fields, but it must retain version ownership and copy semantics.

## Immutable movement catalog

### `movement_definitions`

A row is one immutable definition revision.

| Column                     | Contract                                       |
| -------------------------- | ---------------------------------------------- |
| `id`                       | UUID primary key referenced by workout steps.  |
| `lineage_id`               | Stable movement-family UUID.                   |
| `definition_number`        | Positive revision number within the lineage.   |
| `supersedes_definition_id` | Nullable prior definition in the same lineage. |
| `name`                     | Required display name.                         |
| `category`                 | Required category.                             |
| `primary_discipline`       | Required discipline.                           |
| `instructions`             | Nullable immutable instructions.               |
| `created_at`               | Required timestamp.                            |

`(lineage_id, definition_number)` is unique. Definition rows cannot be updated. A referenced definition cannot be deleted because workout-step foreign keys use restrictive delete behavior. The latest catalog definition can be selected by definition number; plans retain the exact referenced definition.

The canonical plan hash includes the definition's user-visible immutable fields, not its database ID.

## Idempotency

### `api_idempotency_keys`

This table makes create, lock, discard, and restore retries safe.

| Column            | Contract                                       |
| ----------------- | ---------------------------------------------- |
| `id`              | UUID primary key.                              |
| `athlete_id`      | Required command owner.                        |
| `command_scope`   | Stable command name such as `plan.create`.     |
| `idempotency_key` | Client-supplied opaque key.                    |
| `request_hash`    | Digest of the normalized command input.        |
| `response_status` | Stored successful HTTP status.                 |
| `response_body`   | Stored successful JSON response.               |
| `created_at`      | Required timestamp.                            |
| `expires_at`      | Nullable retention boundary for later cleanup. |

`(athlete_id, command_scope, idempotency_key)` is unique. The idempotency record commits in the same transaction as the command. Reuse with another request hash is rejected. Phase 2 may retain records indefinitely; automatic pruning is operational follow-up rather than a correctness dependency.

## Database immutability

PostgreSQL enforces locked history in addition to API guards.

One shared trigger function protects every version-owned content table:

- Insert, update, and delete are allowed only while the owning version is a draft and its logical plan is not archived.
- Locked content rejects ordinary inserts, updates, and deletes.
- `plan_versions` separately permits the one-way draft-to-locked promotion and then rejects changes.
- Locked-to-draft transitions and version-number changes are impossible.

A plan-level trigger makes an archived row read-only except for the valid unarchive transition. In particular, display name, version pointers, and activation cannot change while archived. Archiving must clear activation in the same transition.

Operator removal requires table-owner privileges and an explicit transaction that disables and restores user triggers while removing the exact selected aggregate. There is no application-settable override flag. The local fixture reset is the first such narrowly scoped workflow.

Deferred constraint triggers validate plan current-version pointers at commit. Foreign keys and checks retain local entity integrity regardless of version state.

## Derived views

`workout_prescription_totals` and `weekly_plan_summary` are recreated as version-aware views.

- Both expose `plan_version_id`.
- Weekly grouping occurs within a version.
- Historical and draft calculations never mix.
- Existing prescription expansion behavior remains unchanged.

## Canonical aggregate contract

The API assembles one canonical aggregate containing:

1. Versioned header fields.
2. Goals and constraints in deterministic order.
3. Calibrations, zones, and effective periods in deterministic order.
4. Blocks, weeks, and week targets by position.
5. Workouts by date and position.
6. Tags lexicographically.
7. Workout steps by tree position, with completions and targets.
8. Referenced immutable movement definition content.

Canonical hashing excludes physical IDs, lineage IDs, timestamps, ancestry, validation metadata, and version numbers. Decimal values are normalized by value rather than database formatting. The same canonical representation feeds hashing and complete semantic equality; summaries compare entities by lineage.

## Transaction contracts

### Create plan

- Insert the logical plan and initial draft.
- Set the draft pointer and establish state version `1` and draft edit number `1`.
- Commit the matching idempotency result atomically.

### Update draft

- Lock or conditionally update the draft by its expected edit number.
- Apply only to a draft owned by an unarchived plan.
- Increment the edit number only when semantic content changes.

### Lock

- Lock the plan and draft version rows.
- Verify expected plan state and draft edit numbers.
- Assemble, validate, canonicalize, hash, and compare the complete aggregate.
- Reject errors, missing warning acknowledgements, and unchanged non-initial drafts.
- Assign the next version number and final metadata.
- Promote the draft in place and move plan pointers.
- Increment plan state version and store the idempotent response atomically.

### Unlock

- Lock the plan and current locked-version rows.
- Return the existing draft if one exists.
- Bulk-clone the complete aggregate with new physical IDs and copied lineage IDs.
- Set ancestry to the current locked version.
- Set the draft pointer and increment plan state version.

### Discard

- Require both a locked version and a draft.
- Lock the plan and verify expected concurrency values.
- Delete the draft aggregate using ordinary draft deletion.
- Clear the draft pointer and increment plan state version.
- Commit the idempotent response atomically.

### Restore

- Require an unarchived locked plan with no draft.
- Reject the current or semantically identical target.
- Clone the selected locked aggregate into a new draft.
- Set `based_on_version_id` to the selected revision while leaving the current locked pointer unchanged.
- Increment plan state version and commit the idempotent response atomically.

### Activate, deactivate, archive, and unarchive

- Lock the plan row and verify its expected state version.
- Enforce the lifecycle constraints.
- Treat an already-achieved desired state as success.
- Increment state version only when state actually changes.

## Cutover contract

The Phase 2 Atlas migration is intentionally destructive for plan-domain data.

It must:

1. Preserve `athletes` and `athlete_identities` rows and identifiers.
2. Drop dependent plan views and the existing membership table.
3. Remove existing plans, content, calibrations, and development seed markers that refer to the old fixture.
4. Recreate the plan domain under the versioned schema.
5. Recreate version-aware views and database protection.
6. Leave every existing athlete with zero plans.
7. Update readiness checks to require the Phase 2 migration version.

The normal development database can be reseeded afterward. Railway receives no development seed.

The rewritten seed workflow must not delete or replace authenticated athlete identities. It may upsert the fixed synthetic fixture athlete, creates the fixture plan beneath that athlete, and uses a new seed key for the versioned fixture. Reset removes the fixture plan and seed marker; it removes the synthetic athlete only when no external identity is attached.
