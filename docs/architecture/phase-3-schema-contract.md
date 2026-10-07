# Brief and athlete calibration schema/API contract

Current implementation, verified 2026-10-07. Calibration moved from plan versions to the athlete in [ADR 0005](../adr/0005-athlete-owned-performance.md). The original Phase 3 proposals are retained in the [delivery archive](../archive/phase-3/phase-3-implementation-plan.md).

## Brief rows and units

`plan_briefs` has a physical UUID, lineage ID and unique `plan_version_id`; the version ID is not its primary key. It stores goal/context as strings (empty is allowed), `distance_unit`, baseline status/value pairs, desired runs and confirmation metadata. It has no timezone: the athlete's timezone is stored on `athletes` (see below).

Baseline distance fields use metres. Absolute input pace uses seconds per kilometre. The human UI and worker prepare canonical values; the brief API does not interpret a numeric value in the selected display unit. Known baseline values are finite, nonnegative and bounded; current run frequency is an integer. Desired runs is nullable or an integer from 1 to 14. Each baseline answer is `unanswered`, `unknown` or `known`; unanswered and unknown have null values. The current frequency status column is `current_runs_status`.

Seven `plan_brief_weekdays` rows have physical UUID/lineage and unique version/day pairs, ISO days 1–7 and available/preferred/unavailable states. PUT saves the complete seven-day set transactionally.

## Confirmation and validation

Confirmation fields live on `plan_briefs`: `confirmed_at`, `confirmed_edit_number`, `confirmed_hash`, `validator_version`, `acknowledged_warning_codes` and `schedule_review_required`. Brief validation findings are calculated; there is no `brief_validation_findings` storage column. Final lock evidence is on `plan_versions`.

The confirmation hash includes relevant dates and facts; display unit, physical row IDs and calibration are excluded. The read's confirmed state compares stored and current hashes. Confirmation records validator version 1 and does not increment the semantic draft edit number.

Goal, valid dates, answered baselines (explicit unknown is accepted), a usable recurring schedule and feasible desired frequency are required for confirmation. A missing schedule remains a lock warning, allowing a confirmed brief to lock before workouts exist.

Semantic brief/date changes invalidate confirmation. Unit-only changes increment the edit number but preserve confirmation and do not mark the schedule stale. Description-only header edits also preserve confirmation. Brief/date changes with existing prescriptions can mark them for schedule review. Worker schedule-only edits preserve confirmation. Calibration changes never touch a plan's edit number, confirmation or schedule review.

## Athlete timezone

`athletes.timezone` (default `UTC`) is the IANA zone of the device the athlete last used. Clients send `X-Askesis-Timezone` on every request; authentication validates it with `Intl.DateTimeFormat` and stores a change. Invalid or missing headers keep the stored value. Request handling uses the updated value; background work (the coaching worker) uses the stored one. "Today" for calibration and coaching context is the calendar date in this zone.

## Athlete calibration timeline

`athlete_calibrations` is append-only per athlete and `system`. `run_pace` is the only system. Each entry stores `method`, validated `input` JSON (`race_result` with `distanceMetres` 1,609.344–42,195 and integer `durationSeconds`, or `threshold_pace` with `secondsPerKilometre`), `calculator_version`, internal `fitness_value`, provenance (`user_supplied`, `user_estimate` or `agent_estimate`), optional estimate basis, optional `observed_on` (the race or test day, not after `effective_from`), `effective_from`, `recorded_at`, `recorded_by_run_id` (null for the athlete) and retraction fields. There is no confidence, subjective adjustment, demographic profile or individually editable zone API.

`athlete_calibration_zones` stores generic `metric`, `unit`, `minimum_value`, `target_value` and `maximum_value` per zone key. Running keys are `easy`, `marathon`, `threshold`, `interval` and `repetition`; single-letter E/M/T/I/R are display/calculator terminology, not persisted zone keys. The API presents zones as `minimum`/`target`/`maximum`; for pace, minimum is the faster bound.

Triggers reject deletes and every update except one retraction (`retracted_at`, optional `retracted_by_run_id`). A new entry is effective from today in the athlete's timezone. Recording an entry identical to today's current entry (input, method, provenance, basis, observed date) is a no-op. Retracting an already retracted entry is a no-op; retracting another athlete's entry is not found.

Calculators are registered per system in code with their input schema, zone order and discipline. Each system's workouts (`run_pace` for `run`) need at least one active entry before a plan with that discipline can lock (`performance.<system>_required`).

## Workout resolution and versioning

Symbolic zone targets resolve against the plan owner's timeline on the workout date: the latest active entry with `effective_from` on or before that date (later `recorded_at` wins on the same day), or the first active entry for dates before it. No active entry, or one without the zone key, yields unresolved guidance and a `ZONE_UNRESOLVED` lock error. Absolute pace targets remain absolute. Resolved running paces are returned in the selected display unit with the resolving `calibrationId`, `effectiveFrom`, method and calculator version; consumers must use the returned unit. The public projection does not expose the internal fitness value.

Calibration is not version content. Unlock/restore clone briefs and coverage with the schedule; hashing (content schema 4, hash version 4, validator version 4) excludes calibration. A locked version records `calibration_basis`, the `{ system, calibrationId, effectiveFrom }` entries current at lock, outside its hash; revisions return it as `calibrationBasis`. Restore accepts content schema 4 only. [Coverage](../../apps/api/src/modules/plans/schedule-generation.ts) is version-owned; run generation metadata separately describes intended/prescribed progress and interruption.

Each insert or retraction emits a `performance.changed` live notification for the athlete; clients refresh performance, workout and plan reads.

## Routes

```http
GET  /api/v1/plans/:planId/draft/brief
PUT  /api/v1/plans/:planId/draft/brief
GET  /api/v1/plans/:planId/revisions/:revisionId/brief
POST /api/v1/plans/:planId/draft/brief/validate
POST /api/v1/plans/:planId/draft/brief/confirm
GET  /api/v1/performance
POST /api/v1/performance/calibrations
POST /api/v1/performance/calibrations/preview
POST /api/v1/performance/calibrations/:calibrationId/retract
```

Brief writes require owner access, an unarchived draft, expected draft/edit identity and compatible idle/run state. Performance reads return `timezone`, `today`, the entry in effect today for each system and every entry newest first. Record and retract accept an optional `idempotencyKey`. Preview calculates zones beside the current entry without saving. See exact request schemas in [brief.schemas.ts](../../apps/api/src/modules/plans/brief.schemas.ts), [performance.schemas.ts](../../apps/api/src/modules/performance/performance.schemas.ts) and [OpenAPI](../../packages/api-client/openapi.json).

## Evidence

[Brief service](../../apps/api/src/modules/plans/brief.service.ts), [performance service](../../apps/api/src/modules/performance/performance.service.ts), [calculator](../../apps/api/src/modules/performance/run-pace.calculator.ts), [brief migration](../../database/migrations/20260909120000_plan_briefs.sql) and [athlete performance migration](../../database/migrations/20261007120000_athlete_performance.sql). Equations/range policy are documented in [run pace v1](../product/run-pace-v1.md); repository tests are not evidence of comparison against a live official calculator.
