# Athlete dataset coverage

Generated from [catalogue.json](./v1/catalogue.json), catalogue v1, updated 2026-10-14.

Personas: **7/28 authored**. Scenarios: **8/61 authored**.

Checked means the data file exists and passes authoring validation. It does not mean the case has been run, owner-reviewed or grading-calibrated. All authored datasets remain exploratory.

Every authored scenario runs with `pnpm bench run --scenario <id>`, and `pnpm bench run --suite pilot-v1` runs the pilot in order. Planned cases still need authoring.

Regenerate with `pnpm --filter @askesis/bench datasets:coverage:update`. Validate with `pnpm --filter @askesis/bench datasets:validate`.

## Persona combinations

### running

- [ ] `run-beginner` (beginner, development): New to consistent running, wants to establish a run/walk habit before considering an event. Zero/low recent baseline; no race result; ordinary language; distinguish unknown from unanswered.
- [x] [running-improver](./v1/personas/running-improver.json) (improver, development): Existing first-half-marathon runner: three weekly runs, 22 km, recent 5 km result, three available days. Prescribe four weeks within the twelve-week goal.
- [ ] `run-intermediate` (intermediate, development): Consistent structured runner seeking a better 10 km result alongside a busy job. Use current evidence and limited time rather than treating ambition as capacity.
- [ ] `run-experienced` (experienced, holdout): Long-term runner maintaining fitness with fewer sessions and no race target. Detailed training knowledge, modest desired load, no invented event or return to past peak volume.

### cycling

- [x] [cycle-beginner](./v1/personas/cycle-beginner.json) (beginner, development): Casual rider wants comfortable longer rides, no meter or known FTP. Actionable effort guidance without requiring power calibration.
- [ ] `cycle-improver` (improver, development): Regular recreational cyclist preparing for a first organised long ride. Known weekly riding time; uneven weekday/weekend availability; indoor trainer access.
- [ ] `cycle-intermediate` (intermediate, holdout): Structured cyclist targeting a time trial with a recent power test. Appropriate power provenance, event specificity and time-based baseline.
- [ ] `cycle-experienced` (experienced, development): Years of riding, high established recent volume, wants performance work within a fixed time budget. Substantial load grounded in actual history; technical language should not obscure constraints.

### triathlon

- [ ] `triathlon-beginner` (beginner, holdout): First short triathlon; established running habit but little pool or bike practice. Uneven sport experience, pool access and no single baseline copied across sports.
- [ ] `triathlon-improver` (improver, development): Has completed a short triathlon, wants a more consistent second attempt. Coordinate all three disciplines and optional strength within a shared schedule.
- [x] [triathlon-intermediate](./v1/personas/triathlon-intermediate.json) (intermediate, development): Established multisport athlete preparing for an Olympic-distance event. Separate measured fitness evidence, a brick and realistic combined time commitments.
- [ ] `triathlon-experienced` (experienced, development): Long-term triathlete maintaining capability while work and family reduce training time. Negotiate priorities without reusing old high-volume habits.

### swimming

- [x] [swim-beginner](./v1/personas/swim-beginner.json) (beginner, development): Can swim but lacks a structured fitness habit; wants manageable pool sessions. No CSS result; clear set instructions and rest; limited pool access.
- [ ] `swim-improver` (improver, holdout): Regular pool swimmer wants more consistent distance and pacing. Interpret simple descriptions of current sessions without requiring specialist terminology.
- [ ] `swim-intermediate` (intermediate, development): Structured swimmer with a recent CSS test and a pool-distance goal. Correct pace units, repeats, recovery and pool-compatible distances.
- [ ] `swim-experienced` (experienced, development): Older lifelong swimmer, maintaining explicitly reported current capacity. Respect experience and stated recovery needs without assuming age means low fitness.

### strength

- [x] [strength-beginner](./v1/personas/strength-beginner.json) (beginner, development): New lifter wants a simple strength habit and knows no working weights. Exercise names, sets/reps/rest and effort guidance without inventing measured loads or zones.
- [ ] `strength-improver` (improver, development): Consistent basic lifting, wants a repeatable programme and manageable progression. Translate familiar exercise language into actionable prescriptions.
- [ ] `strength-intermediate` (intermediate, development): Structured lifter with reported working loads and limited weekly sessions. Suggested load versus effort target; recovery and equipment constraints.
- [ ] `strength-experienced` (experienced, holdout): Long-term lifter wants maintenance rather than new personal bests. Honour modest goals and avoid unsupported max-strength tracking claims.

### gym

- [ ] `gym-beginner` (beginner, development): New gym member wants confidence and general fitness with machines and simple cardio. Clarify what “gym training” means; understandable instructions and facility-specific choices.
- [ ] `gym-improver` (improver, holdout): Regular gym attendee wants structure, variety and a sustainable habit. Goal is general fitness, not automatically racing or maximal strength.
- [ ] `gym-intermediate` (intermediate, development): Established gym routine combining resistance sessions and aerobic work. Balance modalities, available time and familiar terminology.
- [x] [gym-experienced](./v1/personas/gym-experienced.json) (experienced, development): Long-term gym attendee who speaks informally and wants a practical mixed routine. Years of attendance do not imply either high training load or specialist coaching language.

### hybrid

- [ ] `hybrid-beginner` (beginner, development): Wants enjoyable variety through simple circuits and aerobic sessions. Avoid complexity and intensity escalation just because the request mentions circuits.
- [x] [hybrid-improver](./v1/personas/hybrid-improver.json) (improver, development): Regular circuits and running, wants consistent general fitness. Disambiguate variety versus competition; preserve preferences and realistic recovery.
- [ ] `hybrid-intermediate` (intermediate, holdout): Established run/lift athlete interested in a Hyrox-style event. Mixed prescription trees, named stations, sport-specific targets and shared recovery.
- [ ] `hybrid-experienced` (experienced, development): Years of varied training; prefers autonomy and fitness maintenance over competing. Respect a preferred approach and evaluate coherent variety without assuming a race.

## core scenarios

- [ ] `run-beginner` (core:run-beginner, development; family `run-beginner`): New to consistent running, wants to establish a run/walk habit before considering an event. Zero/low recent baseline; no race result; ordinary language; distinguish unknown from unanswered.
- [x] [running-improver](./v1/scenarios/running-improver.json) (core:running-improver, development; family `running-improver`): Existing first-half-marathon runner: three weekly runs, 22 km, recent 5 km result, three available days. Prescribe four weeks within the twelve-week goal.
- [ ] `run-intermediate` (core:run-intermediate, development; family `run-intermediate`): Consistent structured runner seeking a better 10 km result alongside a busy job. Use current evidence and limited time rather than treating ambition as capacity.
- [ ] `run-experienced` (core:run-experienced, holdout; family `run-experienced`): Long-term runner maintaining fitness with fewer sessions and no race target. Detailed training knowledge, modest desired load, no invented event or return to past peak volume.
- [x] [cycle-beginner](./v1/scenarios/cycle-beginner.json) (core:cycle-beginner, development; family `cycle-beginner`): Casual rider wants comfortable longer rides, no meter or known FTP. Actionable effort guidance without requiring power calibration.
- [ ] `cycle-improver` (core:cycle-improver, development; family `cycle-improver`): Regular recreational cyclist preparing for a first organised long ride. Known weekly riding time; uneven weekday/weekend availability; indoor trainer access.
- [ ] `cycle-intermediate` (core:cycle-intermediate, holdout; family `cycle-intermediate`): Structured cyclist targeting a time trial with a recent power test. Appropriate power provenance, event specificity and time-based baseline.
- [ ] `cycle-experienced` (core:cycle-experienced, development; family `cycle-experienced`): Years of riding, high established recent volume, wants performance work within a fixed time budget. Substantial load grounded in actual history; technical language should not obscure constraints.
- [ ] `triathlon-beginner` (core:triathlon-beginner, holdout; family `triathlon-beginner`): First short triathlon; established running habit but little pool or bike practice. Uneven sport experience, pool access and no single baseline copied across sports.
- [ ] `triathlon-improver` (core:triathlon-improver, development; family `triathlon-improver`): Has completed a short triathlon, wants a more consistent second attempt. Coordinate all three disciplines and optional strength within a shared schedule.
- [x] [triathlon-intermediate](./v1/scenarios/triathlon-intermediate.json) (core:triathlon-intermediate, development; family `triathlon-intermediate`): Established multisport athlete preparing for an Olympic-distance event. Separate measured fitness evidence, a brick and realistic combined time commitments.
- [ ] `triathlon-experienced` (core:triathlon-experienced, development; family `triathlon-experienced`): Long-term triathlete maintaining capability while work and family reduce training time. Negotiate priorities without reusing old high-volume habits.
- [x] [swim-beginner](./v1/scenarios/swim-beginner.json) (core:swim-beginner, development; family `swim-beginner`): Can swim but lacks a structured fitness habit; wants manageable pool sessions. No CSS result; clear set instructions and rest; limited pool access.
- [ ] `swim-improver` (core:swim-improver, holdout; family `swim-improver`): Regular pool swimmer wants more consistent distance and pacing. Interpret simple descriptions of current sessions without requiring specialist terminology.
- [ ] `swim-intermediate` (core:swim-intermediate, development; family `swim-intermediate`): Structured swimmer with a recent CSS test and a pool-distance goal. Correct pace units, repeats, recovery and pool-compatible distances.
- [ ] `swim-experienced` (core:swim-experienced, development; family `swim-experienced`): Older lifelong swimmer, maintaining explicitly reported current capacity. Respect experience and stated recovery needs without assuming age means low fitness.
- [x] [strength-beginner](./v1/scenarios/strength-beginner.json) (core:strength-beginner, development; family `strength-beginner`): New lifter wants a simple strength habit and knows no working weights. Exercise names, sets/reps/rest and effort guidance without inventing measured loads or zones.
- [ ] `strength-improver` (core:strength-improver, development; family `strength-improver`): Consistent basic lifting, wants a repeatable programme and manageable progression. Translate familiar exercise language into actionable prescriptions.
- [ ] `strength-intermediate` (core:strength-intermediate, development; family `strength-intermediate`): Structured lifter with reported working loads and limited weekly sessions. Suggested load versus effort target; recovery and equipment constraints.
- [ ] `strength-experienced` (core:strength-experienced, holdout; family `strength-experienced`): Long-term lifter wants maintenance rather than new personal bests. Honour modest goals and avoid unsupported max-strength tracking claims.
- [ ] `gym-beginner` (core:gym-beginner, development; family `gym-beginner`): New gym member wants confidence and general fitness with machines and simple cardio. Clarify what “gym training” means; understandable instructions and facility-specific choices.
- [ ] `gym-improver` (core:gym-improver, holdout; family `gym-improver`): Regular gym attendee wants structure, variety and a sustainable habit. Goal is general fitness, not automatically racing or maximal strength.
- [ ] `gym-intermediate` (core:gym-intermediate, development; family `gym-intermediate`): Established gym routine combining resistance sessions and aerobic work. Balance modalities, available time and familiar terminology.
- [x] [gym-experienced](./v1/scenarios/gym-experienced.json) (core:gym-experienced, development; family `gym-experienced`): Long-term gym attendee who speaks informally and wants a practical mixed routine. Years of attendance do not imply either high training load or specialist coaching language.
- [ ] `hybrid-beginner` (core:hybrid-beginner, development; family `hybrid-beginner`): Wants enjoyable variety through simple circuits and aerobic sessions. Avoid complexity and intensity escalation just because the request mentions circuits.
- [x] [hybrid-improver](./v1/scenarios/hybrid-improver.json) (core:hybrid-improver, development; family `hybrid-improver`): Regular circuits and running, wants consistent general fitness. Disambiguate variety versus competition; preserve preferences and realistic recovery.
- [ ] `hybrid-intermediate` (core:hybrid-intermediate, holdout; family `hybrid-intermediate`): Established run/lift athlete interested in a Hyrox-style event. Mixed prescription trees, named stations, sport-specific targets and shared recovery.
- [ ] `hybrid-experienced` (core:hybrid-experienced, development; family `hybrid-experienced`): Years of varied training; prefers autonomy and fitness maintenance over competing. Respect a preferred approach and evaluate coherent variety without assuming a race.

## variation scenarios

- [ ] `v01-returning-athlete` (V01, development; family `run-intermediate`): returning athlete. Long history but a prolonged break and a much lower recent baseline; plan from present facts.
- [ ] `v02-older-reduced-capacity` (V02, development; family `strength-intermediate`): older, reduced capacity. Older experienced athlete explicitly requests fewer sessions and more recovery; age plus reported needs form a composite case.
- [ ] `v03-age-control` (V03, development; family `swim-experienced`): age control. Change age only to a younger adult, retaining the same capacity and constraints; inspect unexplained age-based changes.
- [ ] `v04-very-limited-time` (V04, development; family `hybrid-improver`): very limited time. Short sessions and caregiving commitments; negotiate priorities within the stated budget.
- [ ] `v05-no-power-measurement` (V05, development; family `cycle-beginner`): no power measurement. Cannot measure watts or perform the proposed power test; maintain useful RPE instructions and honest estimates, acknowledge the calibration/test limitation.
- [ ] `v06-no-swim-performance-data` (V06, development; family `swim-beginner`): no swim performance data. Does not know pace or CSS; avoid repeated requests for unavailable evidence and inspect any proposed estimate/test.
- [ ] `v07-no-known-lifting-loads` (V07, development; family `strength-beginner`): no known lifting loads. Cannot report working weights; clear effort-based prescriptions, no invented supplied load.
- [ ] `v08-home-equipment-only` (V08, development; family `gym-beginner`): home equipment only. Dumbbells/bands and no commercial gym; every prescribed exercise must fit the stated equipment.
- [ ] `v09-uneven-multisport-capacity` (V09, development; family `triathlon-intermediate`): uneven multisport capacity. Strong cycling but markedly limited current swim capacity; retain distinct sport baselines and priorities.
- [ ] `v10-sparse-answers` (V10, development; family `run-beginner`): sparse answers. Same facts, shorter plain-language responses and some explicit unknowns; focused discovery without endless questioning.
- [ ] `v11-incompatible-ambition` (V11, development; family `cycle-experienced`): incompatible ambition. Requests a load/event outcome incompatible with the fixed schedule; inspect explanation, negotiation and the final agreed contract.
- [ ] `v12-terminology-mismatch` (V12, development; family `gym-intermediate`): terminology mismatch. Equivalent facts in informal language with ambiguous “sets” or “sessions”; clarify material ambiguity rather than guessing.
- [ ] `v13-jargon-without-capacity` (V13, development; family `hybrid-improver`): jargon without capacity. Same recent baseline, fluent training jargon; inspect whether vocabulary alone changes prescribed load.
- [ ] `v14-health-boundary-disclosure` (V14, development; family `running-improver`): health-boundary disclosure. Replace the no-current-restrictions fact with a material current pain/restriction disclosure; test acknowledgement and appropriate limits or deferral, not diagnosis.

## adaptation scenarios

- [ ] `a01-availability-change` (A01, development; family `running-improver`): availability change. Thursday becomes unavailable. Move affected future training, preserve unrelated content and accurately describe changes.
- [ ] `a02-fitness-update` (A02, development; family `cycle-improver`): fitness update. Supplies a new measured power result with its date. Correct provenance and effective-date behavior; calibration-only update preserves schedule content.
- [ ] `a03-facility-loss` (A03, development; family `triathlon-improver`): facility loss. Loses pool access temporarily. Negotiate a feasible adjustment without pretending other sports substitute exactly for swimming.
- [ ] `a04-fatigue-feedback` (A04, development; family `swim-intermediate`): fatigue feedback. Says week one was too demanding and asks to revise future sessions. Acknowledge feedback, adapt the scoped future horizon and preserve earlier content.
- [ ] `a05-equipment-change` (A05, development; family `strength-improver`): equipment change. Has only dumbbells for the next fortnight. Actionable substitutions, appropriate effort guidance, no unsupported exercises.
- [ ] `a06-missed-week` (A06, development; family `gym-intermediate`): missed week. Missed training and wants help resuming. Use stated chat feedback; do not invent workout completion data or automatically cram missed work in.
- [ ] `a07-preference-change` (A07, development; family `hybrid-experienced`): preference change. Dislikes circuits and wants simpler separate sessions. Preserve the goal while changing structure and accurately updating the brief.

## duration scenarios

- [ ] `d01-sample` (D01, development; family `run-intermediate`): sample. One week / one week Respect an explicit sample request; complete prescriptions and truthful scope.
- [ ] `d02-short-block` (D02, development; family `run-intermediate`): short block. Four weeks / four weeks Short ordinary plan, with context about longer consistency.
- [ ] `d03-standard-block` (D03, development; family `run-intermediate`): standard block. Twelve weeks / twelve weeks Fully prescribed typical-length reference for execution comparisons.
- [ ] `d04-seasonal-rolling` (D04, development; family `run-intermediate`): seasonal rolling. 26 weeks / four weeks Longer structure without falsely declaring the entire schedule prescribed.
- [x] [hybrid-improver-annual](./v1/scenarios/hybrid-improver-annual.json) (D05, development; family `hybrid-improver`): annual rolling. 52 weeks / four weeks Matched against the core twelve-week hybrid scenario; annual phases and bounded detailed work.
- [ ] `d06-goal-beyond-a-year` (D06, development; family `run-intermediate`): goal beyond a year. 56 weeks / four weeks Justified modest overrun for a specific goal; no arbitrary one-year rejection.
- [ ] `d07-multisport-rolling` (D07, development; family `triathlon-intermediate`): multisport rolling. Twelve weeks / four weeks Multisport reference for D08 at the same initial prescription horizon.
- [ ] `d08-annual-multiple-a-races` (D08, development; family `triathlon-intermediate`): annual multiple A races. 52 weeks / four weeks Two agreed A races inside the year; strategic coherence and honest partial detail.
- [ ] `d09-full-seasonal-stress` (D09, development; family `run-intermediate`): full seasonal stress. 26 weeks / 26 weeks Matched against D04 to isolate detailed horizon and batching demand.
- [ ] `d10-full-annual-multisport-stress` (D10, development; family `triathlon-intermediate`): full annual multisport stress. 52 weeks / 52 weeks Matched against D08, including the same A races; dense tool use and persistence.
- [ ] `d11-recommend-a-horizon` (D11, development; family `gym-intermediate`): recommend a horizon. Unspecified / agreed during conversation Agent recommends a useful two-to-three-month starting period and negotiates initial detail.
- [ ] `d12-multi-year-request` (D12, development; family `triathlon-intermediate`): multi-year request. Requested three years / bounded alternative Preserve the ambition, explain scope, and agree an initial plan rather than produce multi-year A races.

## Follow-on execution probes

- [ ] `session-density`: Few versus many sessions within feasible availability
- [ ] `prescription-complexity`: Steady sessions versus nested intervals, swim sets, lifts and mixed circuits
- [ ] `event-phase-complexity`: Multiple A/B/C events and repeated phases
- [ ] `later-week-quality`: Inspect early, middle and final prescribed weeks
- [ ] `rolling-extension`: Extend successive chunks after feedback while preserving earlier work
- [ ] `large-plan-edit`: Revise a bounded range near the end of an annual fixture
- [ ] `interruption-conflict`: Accepted partial batches, cancellation and controlled concurrent edits
- [ ] `calendar-boundaries`: Year end, leap day and non-week goal dates

## Remaining framework work

- [x] General runner support for the new scenario schema, zero/unknown baselines and explicit prescription horizons.
- [x] Per-sport deterministic checks and a sport-neutral reviewer prompt.
- [ ] Reviewer anchors and per-sport dashboard quantities beyond training load.
- [ ] Model experiments with fixed simulator/reviewer models and isolated trial state.
- [ ] Domain-clock consistency, adaptation checkpoints and full-horizon stress telemetry.
- [ ] Owner review of all eight pilot outputs; calibrated training-quality anchors before quality gates.
- [ ] At least one acceptable and one defective reviewer fixture per sport category; reuse reviewed running fixtures where suitable.

Authoring order: run and inspect the eight pilot cases, then fill remaining core personas and reviewed variations. Reserved holdout families stay out of development suites.
