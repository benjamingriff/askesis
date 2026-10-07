# ADR 0005: Athlete-owned performance calibration

- **Status:** Accepted; replaces the version-owned calibration and plan-scoped timezone described in the [Phase 3 contract](../architecture/phase-3-schema-contract.md) before 2026-10-07.
- **Decision checkpoint:** 2026-10-07.
- **Recorded:** 2026-10-07.

## Context

Calibration was plan content. Each plan version owned its profiles, zones and effective periods; they were cloned, hashed and locked with the schedule. Recording a new race result therefore meant unlocking every active plan, recalibrating each draft, reconfirming its brief and locking again. That model also allowed a plan to describe another person or a hypothetical runner.

Two product changes made this wrong. An account now has exactly one athlete, so fitness is a fact about that person, not about a plan. Swimming, cycling and strength work are planned next, so an athlete will hold several independent calibrations (run pace, swim pace, cycling power, per-movement strength).

## Decision

Fitness belongs to the athlete. `athlete_calibrations` is an append-only timeline per athlete and **system**. Each entry stores its validated input (JSON), calculator version, provenance and estimate basis, the day of the race or test (`observed_on`), the day it applies from (`effective_from`) and who recorded it (the athlete, or a coaching run and therefore its conversation). `athlete_calibration_zones` stores the calculated zones. Rows are immutable apart from a single retraction; a database trigger enforces this.

- **Versioning is the timeline.** A new entry supersedes earlier ones from its effective date. A mistaken entry is retracted and the previous one applies again. There is no draft or lock for fitness.
- **Effective from today.** A new entry applies from today in the athlete's timezone, never earlier, so recording a result cannot change paces already shown for past workouts. A past race keeps its date in `observed_on`.
- **Plans reference, never copy.** Workouts keep symbolic zone targets (`zone_system`, `zone_key`). Reads resolve them against the owner's timeline on the workout date: the latest active entry effective by then, or the first entry for dates before it. Calibration is not plan content: it is not cloned, hashed (content schema 4), confirmed or restored, and recording fitness never edits, unconfirms or unlocks a plan.
- **Locking.** A plan locks only when its athlete has calibrated every system its workout disciplines need, and its zone targets resolve. Each locked version stores `calibration_basis`, the entries current at lock, as provenance outside the content hash.
- **Calculator registry.** Each system registers its input schema, deterministic calculator, zone order and discipline in code. `run_pace` (run-pace-v1) was the only system at this decision; new sports add a system rather than columns. [ADR 0006](./0006-multisport-plans.md) added `cycle_power` and `swim_pace`.
- **Device timezone.** The athlete's timezone comes from the device. Clients send `X-Askesis-Timezone` on every request; the API stores a valid change on the athlete. Background work such as the coaching worker uses the stored value. The plan brief no longer has a timezone.
- **Coach tools.** The worker reads the timeline, previews a result against the current entry without saving, records a result and retracts one. These tools work with or without a plan. The prompt asks the coach to record faster results directly, to question a meaningfully slower one before lowering fitness, and to refuse results outside the supported distances.

## Alternatives

- **Keep calibration version-owned, add athlete defaults.** Rejected: every update would still require unlocking, reconfirming and relocking each plan.
- **Plans pin an entry and explicitly rebase.** Rejected as the default because plans would silently drift from current fitness. A per-plan pin could be added later if a plan ever needs frozen paces; it would be versioned plan content.
- **Back-dated effective dates.** Rejected: they would rewrite paces on workouts the athlete has already seen.
- **Wide per-system columns.** Rejected in favour of validated JSON input with a calculator version, so new systems need no schema change for their inputs.

## Consequences

One result updates every plan at once, including locked ones, without new versions. Locked versions remain immutable in structure and hash, but their resolved paces follow the athlete and can differ from the paces seen when they were locked; `calibration_basis` records what applied at lock. Restoring an old version uses current fitness.

The migration truncated pre-alpha plan, brief and coaching data; athletes and identities survived. Distance units remain a brief preference for now.

## Evidence

[Migration](../../database/migrations/20261007120000_athlete_performance.sql), [performance service](../../apps/api/src/modules/performance/performance.service.ts), [calculator registry](../../apps/api/src/modules/performance/performance.calibrators.ts), [workout resolution](../../apps/api/src/modules/workouts/workout.repository.ts), [timezone sync](../../apps/api/src/auth/athlete-provisioning.ts), [coach tools](../../apps/api/src/modules/agent/agent.schemas.ts), [prompt](../../apps/agent/src/prompt.ts), [Performance page](../../apps/web/src/routes/performance.tsx) and the [performance integration tests](../../apps/api/test/db/performance.service.test.ts).
