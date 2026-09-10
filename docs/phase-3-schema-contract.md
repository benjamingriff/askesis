# Phase 3 schema and API contract

## Status

**Design checkpoint, implemented with naming and storage adaptations.** This document translates the accepted [Phase 3 plan brief and running pace calibration](./phase-3-plan-brief-and-calibration-refinement.md) into a relational and API contract. It builds on the [Phase 2 schema contract](./phase-2-schema-contract.md). See [implementation notes](./phase-3-test-checklist.md#implementation-notes) for the final storage differences; migration SQL and generated OpenAPI describe the executable contract.

Exact SQL names may change during implementation, but table responsibilities, ownership, input shapes, effective-date semantics, and transaction boundaries should remain stable.

## Aggregate shape

Phase 3 replaces typed goals and generic constraints with one brief and reshapes calibration around the two accepted running inputs.

```text
athletes
  └── plans
        └── plan_versions
              ├── plan_briefs
              │     └── plan_brief_weekdays
              ├── calibration_profiles
              │     └── calibration_zones
              ├── plan_calibration_periods
              └── blocks, weeks, workouts, steps, and targets
```

Every new row belongs directly to a `plan_version_id`. Same-version composite foreign keys prevent a profile, period, workout target, or brief component from crossing a version boundary.

`plan_goals` and `plan_constraints` are removed. Their Phase 2 test data does not require conversion. The plan-domain portion of the Phase 3 migration may be destructive while preserving `athletes` and `athlete_identities`.

## Controlled values

Phase 3 introduces or narrows these values:

```text
distance display unit: kilometres | miles
answer status:         unanswered | unknown | known
weekday:               1..7 (ISO Monday through Sunday)
availability:          unavailable | available | preferred
calibration method:    race_result | threshold_pace
calibration system:    run_pace
zone key:              E | M | T | I | R
```

API JSON uses lower-case descriptive names for zones (`easy`, `marathon`, `threshold`, `interval`, `repetition`) and may include the conventional single-letter label for display. Database keys remain short and stable because workout targets store them.

## `plan_briefs`

One row holds the scalar brief for one version.

| Column                         | Contract                                                             |
| ------------------------------ | -------------------------------------------------------------------- |
| `plan_version_id`              | Primary key and foreign key to `plan_versions`.                      |
| `goal_text`                    | Nullable while incomplete; trimmed and non-empty when present.       |
| `distance_unit`                | Nullable while incomplete; `kilometres` or `miles`.                  |
| `timezone`                     | Nullable while incomplete; an application-validated IANA identifier. |
| `weekly_distance_status`       | `unanswered`, `unknown`, or `known`.                                 |
| `weekly_distance_metres`       | Present and non-negative only when status is `known`.                |
| `current_runs_per_week_status` | `unanswered`, `unknown`, or `known`.                                 |
| `current_runs_per_week`        | Present and non-negative only when status is `known`.                |
| `longest_run_status`           | `unanswered`, `unknown`, or `known`.                                 |
| `longest_run_metres`           | Present and non-negative only when status is `known`.                |
| `desired_runs_per_week`        | Nullable while incomplete; otherwise 1 through 14.                   |
| `context`                      | Nullable free text; blank input normalizes to null.                  |

The three status/value pairs distinguish a question that has not been answered from an explicit unknown answer and a known zero. PostgreSQL checks enforce each pair's shape.

Plan start and end dates remain on `plan_versions`. The brief does not duplicate them. Canonical metres are stored for baseline distances; the API accepts and renders quantities in the plan's display unit.

IANA timezone membership is validated in application code against the runtime's supported timezone set. PostgreSQL enforces only non-blank text because its timezone catalog can differ between environments. The normalized identifier is persisted.

The brief row uses the version identifier as its identity. It does not need a physical or lineage UUID because it is a one-to-one subordinate value whose conceptual identity is the version's brief.

## `plan_brief_weekdays`

One row represents one recurring weekday answer.

| Column            | Contract                                    |
| ----------------- | ------------------------------------------- |
| `plan_version_id` | Owning version.                             |
| `weekday`         | ISO weekday 1 through 7.                    |
| `availability`    | `unavailable`, `available`, or `preferred`. |

The primary key is `(plan_version_id, weekday)`. A confirmed brief has exactly seven rows. Drafts may temporarily have fewer while incomplete.

Confirmation requires at least one `available` or `preferred` weekday and:

```text
desired_runs_per_week <= 2 × allowed weekday count
desired_runs_per_week <= 14
```

This models at most two runs on one allowed day without introducing time slots.

## Confirmation metadata on `plan_versions`

Phase 3 adds nullable brief-confirmation metadata to the version container:

| Column                             | Contract                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| `brief_confirmation_hash`          | SHA-256 of normalized confirmation-relevant content.                  |
| `brief_validator_version`          | Version of the brief validation rules.                                |
| `brief_confirmed_at`               | Human confirmation time.                                              |
| `brief_validation_findings`        | Immutable structured snapshot of errors and warnings at confirmation. |
| `brief_acknowledged_warning_codes` | Warning codes explicitly acknowledged by the owner.                   |
| `schedule_review_required`         | True when relevant confirmed inputs change while workouts exist.      |

The findings and acknowledgement columns are validation/audit metadata rather than authoritative plan content and may use the same constrained JSONB or array approach selected for Phase 2 lock validation.

Confirmation metadata is either wholly absent or complete. It is included when a version is cloned or restored. It is cleared transactionally by a semantic change to confirmation-relevant content. The confirmation hash excludes:

- Physical IDs, lineage IDs, timestamps, and audit metadata.
- Display-only formatting.
- `distance_unit` when all represented quantities remain canonically equal.

The complete Phase 2 canonical plan hash still includes the distance-unit preference because it affects the rendered plan. A unit-only change can therefore form part of a later locked revision without invalidating a human confirmation of otherwise identical planning facts.

The recorded draft edit number is confirmation audit context, not the validity test after a unit-only edit. Validity depends on the current normalized confirmation hash still matching the stored hash.

`schedule_review_required` becomes true when workouts exist and a saved change to the goal, dates, timezone, baseline, desired frequency, weekday availability, or free-text context may make them stale. Unit-only changes do not set it. Calibration-only changes update symbolic pace resolution directly and return a prominent future-workout change summary without marking schedule structure stale; they do not require row-by-row workout edits.

Phase 3 surfaces `schedule_review_required` as a lock warning. Successful locking with that warning acknowledged clears the marker on the promoted locked version while retaining the immutable warning and acknowledgement snapshot. A later agent-generation operation may record a schedule-basis brief hash and clear the marker before locking; that provenance is deferred to Phase 5.

## `calibration_profiles`

One profile stores its accepted raw input, calculator identity, internal scalar, and generated output ownership.

| Column                            | Contract                                                               |
| --------------------------------- | ---------------------------------------------------------------------- |
| `id`                              | Globally unique physical UUID.                                         |
| `plan_version_id`                 | Owning version.                                                        |
| `lineage_id`                      | Stable conceptual identity when copied across versions.                |
| `system`                          | Fixed to `run_pace` in Phase 3.                                        |
| `method`                          | `race_result` or `threshold_pace`.                                     |
| `race_distance_metres`            | Required only for `race_result`; one mile through marathon.            |
| `race_duration_seconds`           | Required only for `race_result`; positive integer.                     |
| `threshold_seconds_per_kilometre` | Required only for `threshold_pace`; positive numeric value.            |
| `calculator_version`              | Stable identifier for the algorithm and coefficient set.               |
| `fitness_value`                   | Nullable persisted internal scalar required by the selected algorithm. |
| `created_at`                      | Audit timestamp; excluded from semantic hashing.                       |

A check constraint enforces the two mutually exclusive input shapes. Race distance uses canonical metres regardless of whether a preset or custom value was selected. Threshold pace uses canonical seconds per kilometre regardless of display unit.

Profiles contain no race date, source description, confidence, notes, heart-rate values, or owner reference. They are version-owned and are never shared live between plans.

Profiles are fully persisted snapshots. Their zones are not regenerated on read. Unlock and restore copy profiles into the new draft with new physical IDs and retained lineage. Reapplying an older calibration references the applicable earlier profile already owned by that draft; it never points across a version boundary.

## `calibration_zones`

Each profile owns exactly one zone for every Phase 3 key.

| Column                         | Contract                                                |
| ------------------------------ | ------------------------------------------------------- |
| `plan_version_id`              | Owning version.                                         |
| `profile_id`                   | Owning profile with a same-version foreign key.         |
| `lineage_id`                   | Stable conceptual identity when copied across versions. |
| `zone_key`                     | `E`, `M`, `T`, `I`, or `R`.                             |
| `fast_seconds_per_kilometre`   | Faster acceptable bound.                                |
| `target_seconds_per_kilometre` | Nominal target.                                         |
| `slow_seconds_per_kilometre`   | Slower acceptable bound.                                |

The database enforces:

```text
0 < fast_seconds_per_kilometre
fast_seconds_per_kilometre <= target_seconds_per_kilometre
target_seconds_per_kilometre <= slow_seconds_per_kilometre
```

`(profile_id, zone_key)` is unique. The service creates all five zones atomically with the profile. Values retain calculation precision; API display adapters apply the calculator version's documented rounding.

The generic Phase 2 metric and unit columns are removed from this table for the Phase 3 running-only cutover. Future sport systems may introduce system-specific child tables or a deliberate generalized representation once their requirements are known.

## `plan_calibration_periods`

Effective periods retain the Phase 2 version-ownership and non-overlap design.

| Column            | Contract                                          |
| ----------------- | ------------------------------------------------- |
| `id`              | Globally unique physical UUID.                    |
| `plan_version_id` | Owning version.                                   |
| `lineage_id`      | Stable conceptual identity across version clones. |
| `system`          | Fixed to `run_pace` in Phase 3.                   |
| `profile_id`      | Profile in the same version.                      |
| `effective_from`  | Inclusive date.                                   |
| `effective_until` | Exclusive nullable date.                          |

Ranges must be locally valid and non-overlapping for `(plan_version_id, system)`. A partial lookup index supports resolution by version, system, and workout date.

The current profile is the period containing the plan-local current date. The initial profile starts at the plan start. Subsequent profiles start on the plan-local current date. A workout on `effective_from` uses the new profile.

## Workout target and resolution contract

Zone-based `step_targets` retain a symbolic `zone_system` and `zone_key`. Phase 3 accepts only the known combination `run_pace` plus one of `E`, `M`, `T`, `I`, or `R` for running pace-zone targets.

Workout resolution:

1. Reads the workout's explicit `plan_version_id` and scheduled date.
2. Finds the unique `run_pace` period containing that date.
3. Loads the requested zone from that period's profile.
4. Returns the canonical stored values, values formatted in the version's unit, the profile ID, method, calculator version, and effective boundary.

No fallback to another plan, version, global athlete profile, latest creation timestamp, or current wall-clock calibration is allowed. A missing applicable period or zone is a stable resolution error in complete locked content and a visible incomplete state in a draft.

Absolute pace targets bypass calibration resolution and remain fixed.

## Canonical aggregate changes

The Phase 2 canonical aggregate is revised to include, in deterministic order:

1. Version header fields, including the distance-unit preference as represented through the brief.
2. The scalar brief and all seven weekdays by ISO number.
3. Calibration profiles ordered by effective period and stable tie-breakers.
4. Every profile's E/M/T/I/R values in fixed zone order.
5. Effective periods.
6. Existing blocks, weeks, workouts, steps, targets, and referenced movement definitions.

It no longer contains typed goal or generic constraint collections.

The raw calibration input, calculator version, persisted calculated outputs, and effective boundaries are semantic content. Confirmation metadata, schedule-review state, internal physical identifiers, and calculation timestamps are excluded. Whether `fitness_value` participates is fixed in the calculator specification; if the value can be derived exactly from included fields, it is excluded to avoid duplicate semantic representation.

The content schema version and canonical hash-format version both advance.

## Domain API

Phase 3 extends the Phase 2 plan surface with these capabilities. Exact envelope types follow repository conventions.

```http
GET  /api/v1/plans/:planId/draft/brief
PUT  /api/v1/plans/:planId/draft/brief
POST /api/v1/plans/:planId/draft/brief/validate
POST /api/v1/plans/:planId/draft/brief/confirm

GET  /api/v1/plans/:planId/draft/calibrations
POST /api/v1/plans/:planId/draft/calibrations
POST /api/v1/plans/:planId/draft/calibrations/:calibrationId/use-again
```

Immutable revision reads expose the same brief and calibration representations beneath the existing revision resource. They have no mutation routes.

`POST /api/v1/plans` is extended to accept the display name, start date, and end date used by the Phase 3 creation form. It atomically creates the logical plan, initial draft, and version dates. The domain still permits the remainder of the brief to be incomplete.

### Replace brief

`PUT .../draft/brief` is an explicit whole-form save. It accepts:

- Expected draft edit number.
- Goal, timezone, and unit.
- The three status/value baseline answers.
- Desired weekly run count.
- Exactly seven weekday answers when the submitted form is complete; partial draft shapes remain accepted according to the final request schema.
- Optional context.

The API converts input units to canonical values, normalizes blank text, validates local shapes, compares semantic content, and increments the draft edit number only for a real change. It clears confirmation and sets the stale-schedule marker when required.

### Create or replace calibration

`POST .../draft/calibrations` accepts the expected draft edit number and exactly one raw input shape. It does not accept zones, fitness scalar, calculator version, effective date, owner, or plan version from the client.

The API derives the plan-local current date from the stored timezone. It calculates and stores the entire profile and five zones. It then applies one of three rules:

- No existing profile: begin at plan start.
- Plan has not started: replace the initial profile for the whole plan.
- Plan has started: close the active period and begin the new profile today.

If today's period was introduced in the current editable draft, another submission replaces that same-day correction. It does not create overlapping or empty periods. The response includes the updated history, resolved guides, edit number, confirmation state, and affected future-workout summary.

### Use an earlier calibration again

`POST .../:calibrationId/use-again` accepts expected concurrency and an idempotency key. The referenced profile must belong to the current accessible draft. The server starts another period for that existing profile, preserving the exact stored input, guides, and calculator version the user selected.

Pre-start reapplication replaces the initial profile. After plan start it becomes effective today. Reapplying content semantically equal to the current profile is a no-op response.

### Validate and confirm

Validation returns:

- Expected edit number.
- Normalized brief confirmation hash.
- Validator version.
- Errors and warnings with stable codes.
- Current confirmation state.

Confirmation accepts the expected edit number, expected confirmation hash, and acknowledged warning codes. The server revalidates inside the transaction, rejects stale or incomplete confirmation, and persists confirmation metadata. It is an owner-authorized human command and is not included in future machine-credential scopes.

## Transaction contracts

### Save brief

- Lock or conditionally update the draft by expected edit number.
- Replace the scalar brief and weekday answers as one semantic operation.
- Normalize canonical quantities before comparing.
- Clear confirmation and set schedule-review state when applicable.
- Increment the edit number once and return the authoritative representation.

### Add calibration

- Lock the draft and its calibration periods by expected edit number.
- Resolve the plan-local date from the validated timezone.
- Validate the raw input and calculate a complete immutable snapshot.
- Apply initial, pre-start replacement, same-day replacement, or new-period behavior.
- Maintain non-overlapping periods and same-version ownership.
- Clear confirmation, increment the edit number once, and return affected-workout information.

### Confirm brief

- Lock the draft by expected edit number.
- Assemble the canonical confirmation projection.
- Validate readiness and current warnings.
- Verify the expected hash and acknowledgements.
- Store the confirmation atomically without treating audit metadata as a semantic draft edit.

### Clone, restore, and lock

Phase 2 clone and restore transactions copy the brief, weekdays, profiles, zones, periods, and applicable confirmation state with new physical IDs and retained lineages. Lock validation requires a current confirmation hash and rejects an incomplete or stale brief. If the potentially-stale schedule warning is acknowledged, locking clears `schedule_review_required` on the promoted version while retaining the validation snapshot. Database immutability covers every new version-owned table.

## Stable validation findings

The initial contract includes stable codes for at least:

```text
brief.goal_required
brief.dates_required
brief.timezone_required
brief.timezone_invalid
brief.unit_required
brief.weekdays_incomplete
brief.allowed_day_required
brief.weekly_distance_unanswered
brief.current_frequency_unanswered
brief.longest_run_unanswered
brief.desired_frequency_required
brief.desired_frequency_exceeds_capacity
brief.calibration_required
brief.longest_run_exceeds_weekly_distance
brief.frequency_increase_unusual
brief.schedule_may_be_stale
calibration.input_shape_invalid
calibration.race_distance_out_of_range
calibration.calculation_out_of_domain
calibration.period_overlap
calibration.zone_unresolved
```

The first group contains both errors and warnings according to the refinement contract. Exact unusual-frequency thresholds and calculator-domain limits are fixed in versioned validator and calculator specifications, not hidden in UI code.

## Database protection and reset

The shared Phase 2 draft/locked trigger protects `plan_briefs`, `plan_brief_weekdays`, `calibration_profiles`, `calibration_zones`, and `plan_calibration_periods`. Inserts, updates, and deletes require an editable draft owned by an unarchived plan. Locked rows reject ordinary mutation.

The Phase 3 Atlas migration may reset plan-domain tables and fixture markers. It must:

1. Preserve athletes and athlete identities.
2. Remove typed goal and generic constraint storage.
3. Create the brief and weekday structures.
4. Reshape calibration inputs and pace-zone outputs.
5. Recreate all same-version foreign keys, exclusion constraints, triggers, indexes, and derived views.
6. Advance the content schema and readiness migration requirements.
7. Leave Railway accounts with no plans.

The development seed then recreates the Cardiff fixture under the new contract. Railway is never seeded.
