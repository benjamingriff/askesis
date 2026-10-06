# Brief and running calibration schema/API contract

Current implementation, verified 2026-10-06. The original Phase 3 proposals are retained in the [delivery archive](../archive/phase-3/phase-3-implementation-plan.md).

## Brief rows and units

`plan_briefs` has a physical UUID, lineage ID and unique `plan_version_id`; the version ID is not its primary key. It stores goal/context as strings (empty is allowed), `distance_unit`, timezone, baseline status/value pairs, desired runs and confirmation metadata.

Baseline distance fields use metres. Absolute input pace uses seconds per kilometre. The human UI and worker prepare canonical values; the brief API does not interpret a numeric value in the selected display unit. Known baseline values are finite, nonnegative and bounded; current run frequency is an integer. Desired runs is nullable or an integer from 1 to 14. Each baseline answer is `unanswered`, `unknown` or `known`; unanswered and unknown have null values. The current frequency status column is `current_runs_status`.

Seven `plan_brief_weekdays` rows have physical UUID/lineage and unique version/day pairs, ISO days 1–7 and available/preferred/unavailable states. PUT saves the complete seven-day set transactionally. The timezone must be an IANA zone accepted by `Intl.DateTimeFormat`.

## Confirmation and validation

Confirmation fields live on `plan_briefs`: `confirmed_at`, `confirmed_edit_number`, `confirmed_hash`, `validator_version`, `acknowledged_warning_codes` and `schedule_review_required`. Brief validation findings are calculated; there is no `brief_validation_findings` storage column. Final lock evidence is on `plan_versions`.

The confirmation hash includes relevant dates, facts and calibration; display unit and physical row IDs are excluded. The read's confirmed state compares stored and current hashes. Confirmation records validator version 1 and does not increment the semantic draft edit number.

Goal, valid dates, answered baselines (explicit unknown is accepted), a usable recurring schedule, feasible desired frequency and calibration are required for confirmation. A missing schedule remains a lock warning, allowing a confirmed brief to lock before workouts exist.

Semantic brief/date/calibration changes invalidate confirmation. Unit-only changes increment the edit number but preserve confirmation and do not mark the schedule stale. Description-only header edits also preserve confirmation. Brief/date changes with existing prescriptions can mark them for schedule review; calibration changes alone do not mark their structure stale. Worker schedule-only edits preserve confirmation.

## Profiles, zones and periods

`calibration_profiles` stores run discipline/system `run_pace`, `race_result` or `threshold_pace`, raw input, calculator version and internal fitness output. Provenance is `user_supplied`, `user_estimate` or `agent_estimate`; estimated inputs retain an estimate basis. There is no confidence, subjective adjustment, demographic profile or individually editable zone API.

`calibration_zones` retains generic `metric`, `minimum_value`, `target_value`, `maximum_value` and `unit` columns. Running keys are `easy`, `marathon`, `threshold`, `interval` and `repetition`; single-letter E/M/T/I/R are display/calculator terminology, not persisted zone keys.

`plan_calibration_periods` records profile assignment per version/system with inclusive `effective_from` and exclusive nullable `effective_until`. An exclusion constraint prevents overlaps. The first calibration starts at plan start. A replacement before the start replaces that initial period; once underway it starts today in the plan timezone. Draft updates close prior periods, replace same-day/later periods and remove unreferenced profiles/zones. This editable timeline is not an append-only event log; locked versions retain their original timeline.

Saving identical latest inputs/output provenance is a no-op. Reusing the currently effective profile is also a no-op; reusing an earlier profile preserves its stored calculator output rather than recalculating it. Only profiles owned by the target draft can be reused.

## Workout resolution and versioning

Symbolic zone targets resolve by workout date in the same plan version. No matching period yields unresolved guidance, with validation blocking an uncovered zone prescription. Absolute pace targets remain absolute. When the coach saves a pace target without a zone target, the API also stores the calibrated zone that pace falls in (the containing range, else the nearest target) so clients can show the effort by zone; the pace itself is unchanged. Resolved running paces are returned in the selected display unit; consumers must use the returned unit. The public projection does not expose the internal fitness value as a score.

Unlock/restore clone briefs, profile/zone identities, effective periods and coverage with the schedule. Hashing includes persisted semantic calibration content and provenance for current schema versions. Earlier locked version hashes are preserved.

Calibration responses return current brief/calibration state, not a separate list of all affected future workouts. Live plan invalidation and workout reads refresh pace guidance. [Coverage](../../apps/api/src/modules/plans/schedule-generation.ts) is version-owned; run generation metadata separately describes intended/prescribed progress and interruption.

## Routes

```http
GET  /api/v1/plans/:planId/draft/brief
PUT  /api/v1/plans/:planId/draft/brief
GET  /api/v1/plans/:planId/revisions/:revisionId/brief
POST /api/v1/plans/:planId/draft/brief/validate
POST /api/v1/plans/:planId/draft/brief/confirm
GET  /api/v1/plans/:planId/draft/calibrations
POST /api/v1/plans/:planId/draft/calibrations
POST /api/v1/plans/:planId/draft/calibrations/:calibrationId/use-again
```

Writes require owner access, an unarchived draft, expected draft/edit identity and compatible idle/run state. See exact request schemas in [brief.schemas.ts](../../apps/api/src/modules/plans/brief.schemas.ts) and [OpenAPI](../../packages/api-client/openapi.json).

## Evidence

[Brief service](../../apps/api/src/modules/plans/brief.service.ts), [calculator](../../apps/api/src/modules/plans/pace.calculator.ts), [brief migration](../../database/migrations/20260909120000_plan_briefs.sql) and [generation/provenance migration](../../database/migrations/20261002090000_schedule_generation.sql). Equations/range policy are documented in [run pace v1](../product/run-pace-v1.md); repository tests are not evidence of comparison against a live official calculator.
