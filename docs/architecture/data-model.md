# Current domain model

Verified against migrations, generated database types and API services on 2026-10-07. [Storage architecture](./storage-architecture.md) lists the tables; [plan-version invariants](./phase-2-schema-contract.md) describe lifecycle transactions.

## Ownership and identity

`athletes` supplies the internal UUID and the athlete's timezone. `athlete_identities` maps a Clerk identity to that UUID. Authenticated requests lazily create a missing mapping, update its last-seen time and store the device timezone reported in `X-Askesis-Timezone`. Clerk profile changes are not continuously synchronized into the athlete row.

An account has exactly one athlete, and every plan is for that athlete. A plan has one `owner_id`. Public reads and commands derive the athlete from the authenticated session. Alpha has no membership table, sharing roles, demographic training profile or separate identity for another runner.

## Logical plans and versions

`plans` contains `display_name`, ownership, `state_version`, current draft/locked pointers and activation/archive timestamps. It is organizational metadata. Dates and description belong to `plan_versions`, not the logical plan.

A new plan owns an editable draft. Lock promotes that same version row to an immutable numbered version; unlock clones locked content into a new draft. Child rows receive new physical UUIDs and retain lineage IDs. Restoring history copies a supported historical version into a draft; it does not move the current locked pointer backwards.

A version contains its header, brief and weekdays, prescribed schedule coverage, blocks, weeks, week targets, workouts, tags, workout steps, completions and targets. It does not contain calibration. Hashing uses canonical semantic content, not physical row UUIDs or chat history. Content uses schema/hash/validator version 4; the athlete-performance cutover removed earlier versions. A locked version also records `calibration_basis`, the athlete calibration entries current at lock, as provenance outside its hash.

## Brief

Each version has at most one `plan_briefs` row. It holds free-text goal/context, distance unit and confirmation metadata. `plan_brief_sports` holds one baseline per sport the plan trains (`run`, `cycle`, `swim`, `strength`): current and desired sessions, and for all but strength a weekly volume and longest session (metres for run and swim, seconds for cycle). Baseline answers distinguish unanswered, explicitly unknown and known. API distances are metres; UI display units are `km` or `mi`, with swim distances per 100 m or yd. Seven `plan_brief_weekdays` rows express available/preferred/unavailable days.

## Athlete calibration

Fitness belongs to the athlete ([ADR 0005](../adr/0005-athlete-owned-performance.md)). `athlete_calibrations` is an append-only timeline per athlete and system (`run_pace`, `cycle_power` and `swim_pace`; [ADR 0006](../adr/0006-multisport-plans.md)). An entry stores validated input JSON, calculator version, internal fitness value, provenance and estimate basis, the race or test date, the date it applies from (today in the athlete's timezone when recorded), who recorded it (the athlete or a coaching run) and an optional single retraction. `athlete_calibration_zones` holds generic metric/unit/min/target/max values. Running zone keys are `easy`, `marathon`, `threshold`, `interval` and `repetition`; cycling zones are watts and swim zones seconds per 100 metres. Strength has no calibration. The internal fitness value is not a user-facing score.

Workout reads resolve symbolic zones against the plan owner's timeline using the workout date: the latest active entry effective by then, or the first entry for earlier dates. Calibration never rewrites stored symbolic workout targets or plan content, so one entry updates every plan, including locked versions, from its effective date.

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

A workout's sport is `run`, `cycle`, `swim`, `strength` or `mixed`; an effort's is `run`, `cycle`, `swim`, `strength`, `row`, `ski_erg` or `other`, inherited from the workout unless the workout is mixed ([ADR 0006](../adr/0006-multisport-plans.md)). Coaching tools prescribe duration, distance, repetition or open completions with zone, run pace, swim pace, power, RPE, reps-in-reserve, suggested load (kilograms) or instruction targets. Zones are stored in the system of the effort's sport. Workout logging and completed-performance tracking are not delivered.

`movement_definitions` is an immutable vocabulary that steps can reference. It replaces the early `movements` proposal; coaching currently names exercises with step labels instead. `week_targets` provides optional prescribed weekly targets; current agent tools do not author these targets.

`workout_prescription_totals` derives explicit distance/duration through nested repeats. `weekly_plan_summary` aggregates prescribed workout estimates. These views do not estimate completion from zone pace or calculate actual training load.

## Conversations, execution and delivery

A conversation belongs to one athlete and may be associated with one logical plan. Messages and runs retain context/version/edit attribution independently of later draft deletion. Runs own credentials, leases, model settings, usage, safe events, receipts, output and timing records. No per-user spending enforcement or monetary cost calculation is implemented.

Live journal rows notify an owner which resources changed, including `performance.changed` for calibration entries. They carry identifiers rather than authoritative plan content or model text. Clients refetch owner-authorized HTTP projections; durable output survives journal pruning.

## Removed early concepts

`plan_goals`, `plan_constraints`, `plan_memberships`, `plan_revisions`, a mutable `movements` catalog and the version-owned `calibration_profiles`, `calibration_zones` and `plan_calibration_periods` are not current tables. Typed goals and generic constraints were replaced by the version-owned brief; plan calibration was replaced by the athlete timeline. There is no implemented plan merge lineage, user skill store or completed-workout log.

## Implementation evidence

- [Generated database types](../../apps/api/src/database/generated.ts) and [Atlas migrations](../../database/migrations/).
- [Plan aggregate](../../apps/api/src/modules/plans/plan.aggregate.ts), [canonical content](../../apps/api/src/modules/plans/plan.canonical.ts), [performance service](../../apps/api/src/modules/performance/performance.service.ts) and [workout reads](../../apps/api/src/modules/workouts/workout.repository.ts).
- [Public API contract](../../packages/api-client/openapi.json).
