# ADR 0006: Multi-sport plans

- **Status:** Accepted; extends [ADR 0005](./0005-athlete-owned-performance.md) and replaces the running-only alpha scope.
- **Decision checkpoint:** 2026-10-07.
- **Recorded:** 2026-10-07.

## Context

Alpha planned running only. The owner wants plans that train cycling, swimming and supporting strength, alone or together: a pure swimmer, a triathlon with strength, or Hyrox with strength. The storage model already allowed several disciplines and target types, but the coaching tools forced every workout and step to `run`, the lock check read only the workout's sport, the brief asked running questions, and `run_pace` was the only calibration system.

The owner decided: plans can mix sports; no heart-rate zones for now; cycling uses FTP (including an estimate) with an RPE alongside; strength is prescribed with reps in reserve and suggested weights and has **no** performance calibration, because it supports mainly aerobic plans rather than being tracked as fitness.

## Decision

- **Sport vocabulary.** A workout's `primary_discipline` is `run`, `cycle`, `swim`, `strength` or `mixed`. An effort step's `discipline` is `run`, `cycle`, `swim`, `strength`, `row`, `ski_erg` or `other` (transitions). A mixed workout (a brick or a Hyrox simulation) names each effort's sport; other workouts' efforts inherit the workout's. Database checks enforce both lists.
- **Two new calibration systems,** registered in the calculator registry like `run_pace`: `cycle_power` ([cycle-power-v1](../product/cycle-power-v1.md): a known FTP, a 20-minute test × 0.95 or a ramp test's best minute × 0.75, giving Coggan watt zones) and `swim_pace` ([swim-css-v1](../product/swim-css-v1.md): an all-out 400 and 200 critical swim speed test or a known CSS pace, giving zones in seconds per 100 metres). Inputs stay validated JSON, so no new columns were needed.
- **Zones follow the step's sport.** The coach writes `{type: zone, key}`; the API stores it in the system of the effort's sport and rejects keys from another system. Pace targets apply to runs, swim pace to swims, power to rides, and RIR and load to strength. As for running, an explicit pace or power without a zone also gets the calibrated zone it falls in.
- **Strength without calibration.** Lifts are repetition completions with an `rir` (or `rpe`) target and an optional `load` in kilograms that the coach suggests from the conversation. Exercises are named by step labels; the `movement_definitions` vocabulary stays unused for now.
- **Locking reads step sports.** A plan locks only when every calibrated sport used by a workout or an effort step has an active entry, so a brick needs both FTP and running pace. Zone targets also still need a calibration on their date to be saved.
- **Per-sport brief.** `plan_brief_sports` holds one versioned baseline per sport the plan trains: current and desired sessions, plus weekly volume and longest session for run and swim (metres) and cycle (seconds). Strength records sessions only. The running columns on `plan_briefs` were moved there as each existing brief's `run` baseline (keeping the brief's lineage) and dropped. Up to two sessions of any sport per available day.
- **Performance shows the sports that apply.** The performance state reports `usedByPlans`: systems whose sport appears in an unarchived plan's brief or workouts. The Performance page shows those and any calibrated system; other sports are added on request. Nothing is required until a plan that uses the sport is locked, and the coach is instructed to record evidence or a labelled estimate (and schedule a test) when a plan needs one.

## Alternatives

- **Strength calibration per exercise** (a one-rep-max timeline keyed by movement). Rejected for now: it needed a subject column on the athlete timeline and per-movement resolution, for a feature that supports rather than drives these plans. It can be added later without undoing this decision.
- **Heart-rate zones for riders without power.** Deferred by the owner; RPE alongside power covers riders without a meter.
- **Keep running columns and add other sports beside them.** Rejected: two representations of the same fact and special cases in every reader.
- **Ask for every sport's calibration up front.** Rejected: a runner should never be asked for an FTP.

## Consequences

Existing running plans are unchanged in meaning; their briefs read as a single run baseline. The content hash gains the brief sports, so the hash version is now 5; stored hashes of earlier locks remain historical evidence and every comparison recomputes from current content. The migration rehearsal (`pnpm test:multisport:upgrade`) checks draft and locked briefs. Prompt contract `multisport-coach-v1` replaces `running-coach-v3`; older workers are not ready until upgraded. Swim paces display per 100 m or per 100 yd and suggested loads in kilograms or pounds, chosen in settings.

## Evidence

[Migration](../../database/migrations/20261008120000_multisport.sql), [sport vocabulary](../../apps/api/src/modules/plans/disciplines.ts), [calculators](../../apps/api/src/modules/performance/), [schedule tool](../../apps/api/src/modules/agent/agent.schedule.ts), [brief service](../../apps/api/src/modules/plans/brief.service.ts), [prompt](../../apps/agent/src/prompt.ts), [web sports](../../apps/web/src/lib/sports.ts) and the [coaching](../../apps/api/test/db/agent.test.ts) and [brief](../../apps/api/test/db/brief.service.test.ts) integration tests.
