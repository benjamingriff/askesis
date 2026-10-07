# Plan brief and athlete pace guides

Current behavior verified on 2026-10-07 against the brief and performance services, calculator, workout reader and web UI. Exact names/payloads are in the [schema/API contract](../architecture/phase-3-schema-contract.md); the ownership decision is [ADR 0005](../adr/0005-athlete-owned-performance.md).

## One athlete per account

Every plan is for the signed-in athlete; an account cannot plan for another person or a hypothetical runner. Alpha still collects no demographic training profile.

A plan's versioned brief has one free-text goal, optional context, weekly distance/current frequency/longest-run baselines, desired runs, recurring weekday availability and display units. Plan start/end are the only structured goal dates. The athlete's timezone is not a brief fact: it follows the device they use.

Each baseline can be explicitly unknown; unanswered is distinct. Up to two runs are allowed per available/preferred day. Confirmation requires a feasible desired frequency and usable recurring schedule; it does not mechanically require every generated week to match the desired run count exactly.

Chat tools collect these facts. The structured editor remains available to humans. The browser converts display distance/pace input to canonical metres/seconds-per-kilometre before API submission.

## Pace guides belong to the athlete

Fitness is recorded once and every plan uses it. An athlete records a race result (one mile through marathon, with its date) or an estimated threshold pace on the Performance page, or tells the coach in any chat. The deterministic [run-pace-v1 calculator](./run-pace-v1.md) produces Easy, Marathon, Threshold, Interval and Repetition guidance with explicit approximation bands. It is not an official proprietary V.O2 table implementation; the repository does not establish a live official-calculator comparison.

A new result applies from today in the athlete's timezone, in every plan, including locked ones. Earlier workouts keep the paces they had. Before the first result, the first result also covers earlier dates. Workouts are written as zones, so no plan is edited, unconfirmed, unlocked or re-versioned when fitness changes. A mistaken result can be withdrawn; the previous one applies again. History lists every result, who recorded it (with a link to the coach's conversation) and any withdrawal.

The intermediate fitness scalar stays internal. Provenance distinguishes measured/user-supplied evidence, user estimate and agent estimate; estimated input includes a basis. No age/weather/terrain adjustment, confidence field or independent zone editing is implemented.

When the athlete reports a race in chat, the coach works out its date, compares it with current fitness without saving, and records it if it is as fast or faster. For a meaningfully slower result it first asks whether it reflects current fitness (illness, heat, hills, pacing, training run). It explains unusable distances rather than recording them, and withdraws a result the athlete says was wrong. The chat shows a "Pace guides updated" card linking to Performance.

## Confirmation, schedules and history

The human confirms current brief facts. Goal/date/baseline/availability changes invalidate that confirmation. Unit-only changes and description-only header edits preserve it. Schedule-only worker edits also preserve it. Relevant brief/date changes with workouts can require schedule review. Fitness changes never affect confirmation or review.

Generation can begin before human confirmation. Lock requires current confirmation, valid aggregate structure, running fitness for a plan with runs, resolvable zone targets and acknowledgement of all warnings. Empty/partial planning remains possible; explicit coverage distinguishes prescribed rest days from dates not yet planned, and interrupted generation is explained separately.

Brief facts, confirmation, coverage and workouts clone, hash, lock and restore together. A locked version records which fitness entries were current when it was locked. The API returns resolved pace guidance with display units; consumers must not convert an already-converted pace twice.

Evidence: [brief service](../../apps/api/src/modules/plans/brief.service.ts), [performance service](../../apps/api/src/modules/performance/performance.service.ts), [calculator tests](../../apps/api/src/modules/performance/run-pace.calculator.test.ts), [workout repository](../../apps/api/src/modules/workouts/workout.repository.ts), [Performance page](../../apps/web/src/routes/performance.tsx) and the [brief](../../apps/api/test/db/brief.service.test.ts) and [performance](../../apps/api/test/db/performance.service.test.ts) integration tests.
