# Plan brief and running pace calibration

Current behavior verified on 2026-10-06 against the brief service, calculator, workout reader and review UI. Exact names/payloads are in the [schema/API contract](../architecture/phase-3-schema-contract.md).

## Plan-specific context

Alpha does not collect a global athlete/demographic training profile. A plan can describe its owner, another person or a hypothetical scenario without another runner identity. Its versioned brief has one free-text goal, optional context, weekly distance/current frequency/longest-run baselines, desired runs, recurring weekday availability, display units and IANA timezone. Plan start/end are the only structured goal dates.

Each baseline can be explicitly unknown; unanswered is distinct. Up to two runs are allowed per available/preferred day. Confirmation requires a feasible desired frequency and usable recurring schedule; it does not mechanically require every generated week to match the desired run count exactly.

Chat tools collect these facts. The structured editor remains available to humans. This is no longer a temporary pre-chat-only workflow. The browser converts display distance/pace input to canonical metres/seconds-per-kilometre before API submission.

## Calibration and pace guides

Calibration accepts a race result (one mile through marathon) or threshold pace. The deterministic [run-pace-v1 calculator](./run-pace-v1.md) stores Easy, Marathon, Threshold, Interval and Repetition guidance with explicit approximation bands. It is not an official proprietary V.O2 table implementation; the repository does not establish a live official-calculator comparison.

The intermediate fitness scalar stays internal. Provenance distinguishes measured/user-supplied evidence, user estimate and agent estimate; estimated input includes a basis. No age/weather/terrain adjustment, confidence field, independent zone editing or global fitness profile is implemented.

Initial calibration starts at plan start; after the plan begins, a new calibration starts today in its timezone. A draft may replace its same-day/later effective periods. Workout zone targets resolve by scheduled date, preserving earlier guidance in locked versions. Earlier profiles can be used again without recalculating their stored output. The API returns current brief/calibration state rather than an affected-future-workout report.

## Confirmation, schedules and history

The human confirms current facts and calibration. Goal/date/baseline/availability/calibration changes invalidate that confirmation. Unit-only changes and description-only header edits preserve it. Schedule-only worker edits also preserve it. Relevant brief/date changes with workouts can require schedule review; calibration alone does not make workout structure stale.

Generation can begin before human confirmation. Lock requires current confirmation, valid aggregate structure and acknowledgement of all warnings. Empty/partial planning remains possible; explicit coverage distinguishes prescribed rest days from dates not yet planned, and interrupted generation is explained separately.

Brief facts, confirmation, calibration outputs/effective periods, coverage and workouts clone, hash, lock and restore together. Historical locks preserve their original outputs. The API returns resolved pace guidance with display units; consumers must not convert an already-converted pace twice.

Evidence: [brief service](../../apps/api/src/modules/plans/brief.service.ts), [calculator tests](../../apps/api/src/modules/plans/pace.calculator.test.ts), [workout repository](../../apps/api/src/modules/workouts/workout.repository.ts) and [brief integration tests](../../apps/api/test/db/brief.service.test.ts).
