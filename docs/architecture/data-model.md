# Current domain model

Verified against migrations, generated database types and API services on 2026-10-06. [Storage architecture](./storage-architecture.md) lists the tables; [plan-version invariants](./phase-2-schema-contract.md) describe lifecycle transactions.

## Ownership and identity

`athletes` supplies the internal UUID. `athlete_identities` maps a Clerk identity to that UUID. Authenticated requests lazily create a missing mapping and update its last-seen time. Clerk profile changes are not continuously synchronized into the athlete row.

A plan has one `owner_id`. Public reads and commands derive the athlete from the authenticated session. Alpha has no membership table, sharing roles, global training profile or separate identity for the person a plan describes.

## Logical plans and versions

`plans` contains `display_name`, ownership, `state_version`, current draft/locked pointers and activation/archive timestamps. It is organizational metadata. Dates and description belong to `plan_versions`, not the logical plan.

A new plan owns an editable draft. Lock promotes that same version row to an immutable numbered version; unlock clones locked content into a new draft. Child rows receive new physical UUIDs and retain lineage IDs. Restoring history copies a supported historical version into a draft; it does not move the current locked pointer backwards.

A version contains its header, brief and weekdays, calibration profiles/zones/effective periods, prescribed schedule coverage, blocks, weeks, week targets, workouts, tags, workout steps, completions and targets. Hashing uses canonical semantic content, not physical row UUIDs or chat history. Current newly created content uses schema/hash/validator version 3. Historical versions preserve their original meaning and hashes.

## Brief and calibration

Each version has at most one `plan_briefs` row. It holds free-text goal/context, weekly distance/current runs/longest-run answers, desired runs, distance unit, timezone and confirmation metadata. Baseline answers distinguish unanswered, explicitly unknown and known. API distances are metres; UI display units are `km` or `mi`. Seven `plan_brief_weekdays` rows express available/preferred/unavailable days.

`calibration_profiles` stores a race result or threshold pace, deterministic calculator output and input provenance. `calibration_zones` holds generic metric/unit/min/target/max values. Running zone keys are `easy`, `marathon`, `threshold`, `interval` and `repetition`. The internal fitness value is not a user-facing score.

`plan_calibration_periods` assigns a profile to a half-open date range within its version and system. Workout reads resolve symbolic zones using the workout date. Calibration does not rewrite stored symbolic workout targets. Locked profiles and periods are immutable; editing a draft may replace or remove its unused calibration rows.

`plan_schedule_coverage` records inclusive prescribed date ranges and their brief basis. It distinguishes intentional rest days/partial planning from an absent schedule. Agent-run generation progress is execution provenance, not a replacement for version-owned coverage.

## Workout tree

```text
plan version → training blocks → training weeks → workouts
                                               ├── workout tags
                                               └── workout steps (one rooted tree)
                                                   ├── step completions
                                                   └── step targets
```

Steps can be sequences, repeats or efforts. Ordered parent/child links express nested prescriptions; repeat counts apply to descendant completions. The validated tree has one root, but that root need not be a sequence.

The database/read contract supports several disciplines and completion/target types. Current coaching tools prescribe running only: duration in seconds, distance in metres or open completion, with zone, absolute pace, RPE or instruction targets. Broader storage support does not imply cycling/strength coaching, workout logging or completed-performance tracking is delivered.

`movement_definitions` is an immutable vocabulary referenced by steps. It replaces the early `movements` proposal. `week_targets` provides optional prescribed weekly targets; current agent tools do not author these targets.

`workout_prescription_totals` derives explicit distance/duration through nested repeats. `weekly_plan_summary` aggregates prescribed workout estimates. These views do not estimate completion from zone pace or calculate actual training load.

## Conversations, execution and delivery

A conversation belongs to one athlete and may be associated with one logical plan. Messages and runs retain context/version/edit attribution independently of later draft deletion. Runs own credentials, leases, model settings, usage, safe events, receipts, output and timing records. No per-user spending enforcement or monetary cost calculation is implemented.

Live journal rows notify an owner which resources changed. They carry identifiers rather than authoritative plan content or model text. Clients refetch owner-authorized HTTP projections; durable output survives journal pruning.

## Removed early concepts

`plan_goals`, `plan_constraints`, `plan_memberships`, `plan_revisions` and a mutable `movements` catalog are not current tables. Typed goals and generic constraints were replaced by the version-owned brief. There is no implemented plan merge lineage, user skill store or performance-log aggregate.

## Implementation evidence

- [Generated database types](../../apps/api/src/database/generated.ts) and [Atlas migrations](../../database/migrations/).
- [Plan aggregate](../../apps/api/src/modules/plans/plan.aggregate.ts), [canonical content](../../apps/api/src/modules/plans/plan.canonical.ts) and [workout reads](../../apps/api/src/modules/workouts/workout.repository.ts).
- [Public API contract](../../packages/api-client/openapi.json).
