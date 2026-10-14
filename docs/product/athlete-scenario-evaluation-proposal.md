# Athlete scenario evaluation framework

Status: proposal, 2026-10-12. This document defines an expansion of the existing local benchmark and validation dashboard. Broader scenario execution, suite commands and new grading behavior below remain proposed. Training-quality expectations remain provisional until reviewed.

Runner update, 2026-10-14: every authored scenario now runs through the general runner with per-sport checks, a sport-neutral reviewer (`training-plan-v3`), optional athlete voices and the `pilot-v1` suite command; see the [benchmark guide](../operations/training-plan-benchmarks.md). The retired `running-poc` scenario was renamed `running-improver` in the dataset; references to `running-poc` below mean that family.

Dataset update, 2026-10-13: the [first dataset edition](../../apps/bench/datasets/README.md) now contains seven authored personas, eight pilot scenarios and a version-pinned suite. The [coverage tracker](../../apps/bench/datasets/COVERAGE.md) distinguishes authored files from the remaining 61-case inventory and execution/review work. Provider-free authoring validation is implemented; general scenario execution, suite/model experiments and new grading/dashboard behavior remain proposed.

## Recommendation

Build a small, versioned library of athletes and situations around `apps/bench`, with results and manual review in `apps/evals`. Begin with eight inspectable cases: one per sport category and a matched annual variant, as detailed in the pilot below. Then expand to **28 core personas, 14 targeted variations and seven adaptation cases: 49 scenarios in the initial catalogue**. Run named subsets rather than the full catalogue every time.

Add a separate **12-case duration suite**, bringing the proposed catalogue to **61 scenarios**. This captures the owner's 2026-10-12 clarification: usually recommend two to three months, support an annual plan with multiple A races, allow a short sample or a modest extension beyond a year for a specific goal, and avoid prescribing multi-year A-race calendars. Duration cases reuse development personas rather than multiplying every persona by every length.

Separate the athlete from the task and from the grading rules. Someone's experience, present capacity and way of speaking are independent dimensions. A lifelong runner returning after a long break should not receive a plan based on their old peak fitness. A novice triathlete may already be an experienced cyclist. An older athlete may have substantial capacity; reduced load should follow their reported baseline, availability and recovery needs.

The framework should be useful before every training-quality rubric is finished. It must let the owner run a persona, inspect the conversation and actual saved plan, write a review, refine that case's expectations, and rerun it without losing earlier evidence.

## What exists and what needs extending

Repository evidence, inspected for this proposal:

| Area                                                                                    | Current behavior                                                                                                                                               | Proposed extension                                                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Scenario loader](../../apps/bench/src/scenario.ts), [CLI](../../apps/bench/src/cli.ts) | Only `running-poc` is accepted. Positive running distance/result fields are compulsory. The generate message always requests four weeks.                       | General scenario registry; zero and unknown baselines; per-sport facts; scenario-specific horizon, desired outcome and checkpoints.       |
| [Athlete and reviewer](../../apps/bench/src/models.ts)                                  | The simulator selects fact IDs and code renders exact strings. Both role prompts describe running. The reviewer has six criteria and no not-applicable result. | Sport-neutral role setup, authored speech variants, disclosure policies and versioned applicable criteria.                                |
| [Checks](../../apps/bench/src/checks.ts)                                                | Discovery, baseline, frequency, zones and calibration checks assume this specific runner. Completion requires a saved nonempty plan with current coverage.     | Shared invariants plus per-sport checks; explicit success contracts for creation, adaptation, discussion and justified deferral.          |
| [Dashboard analysis](../../apps/evals/server/session.ts)                                | Fact comparisons and brief labels focus on runs. Plan fitness combines workout distances into weekly totals and reads time limits from prose.                  | Structured constraints; per-sport quantities; mixed-session accounting; capability-aware labels and unknown values.                       |
| [Dashboard](../../apps/evals/README.md)                                                 | Already reads saved runs, transcripts, evidence, comparisons and grader calibration. Manual review writes `human-review.json`.                                 | Persona/scenario filters, suite coverage, checkpoint diffs, review maturity and a review queue grouped by persona.                        |
| [Calibration fixtures](../../apps/bench/src/fixtures.ts)                                | Existing acceptable and defective examples derive from a running base.                                                                                         | Positive and negative grading examples for every sport category, including valid alternative plans.                                       |
| [Local operator](../../apps/api/src/benchmark/operator.ts)                              | Fresh synthetic athlete and conversation per run, real API/worker, isolated database and snapshots.                                                            | Narrow fixture/checkpoint helpers for prepared briefs, saved plans and lifecycle cases. Keep worker credentials and ownership boundaries. |

Preserve `running-poc` version 1 and existing artifacts as a legacy regression case. A broader schema, simulator or rubric gets a new version. Do not silently reinterpret historical grades. Follow the existing [benchmark design](./training-plan-benchmarks-proposal.md), [operations guide](../operations/training-plan-benchmarks.md) and [dashboard roadmap](./validation-dashboard-roadmap.md); this proposal supplies the concrete scenario catalogue and authoring workflow.

## Coverage dimensions

Use the following dimensions as searchable metadata and authoring prompts. Do not generate their full Cartesian product.

Plan span, detailed prescription horizon and execution size are additional independent dimensions, defined in the duration section below.

| Dimension                 | Initial coverage                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sport category            | Running, cycling, triathlon, swimming, strength, gym training, hybrid athlete.                                                                                                                                                                                     |
| Experience                | Beginner: little consistent practice in this sport. Improver: regular participation, still establishing structure. Intermediate: established structured training. Experienced: long history and sport knowledge, independently of current performance or capacity. |
| Recent capacity           | Zero/low baseline; consistent moderate baseline; substantial established baseline; reduced capacity after a break. Store actual recent facts per sport rather than deriving these from experience.                                                                 |
| Life and recovery context | Flexible schedule; limited time; shift work or caregiving; explicitly reported recovery needs; older athlete with reduced availability; older athlete with maintained capacity.                                                                                    |
| Goal                      | Start a habit; finish an event; improve a performance; maintain fitness; get stronger; enjoy varied training. Include goals without an event date.                                                                                                                 |
| Evidence                  | Recent measured evidence; user estimate; stale/historical result; unknown result; no devices. Strength has no performance-zone calibration.                                                                                                                        |
| Access                    | Full facilities; home equipment; limited pool days; indoor-only cycling; no power meter; travel or temporary loss of equipment.                                                                                                                                    |
| Communication             | Plain unfamiliar language; brief answers; detailed numerical answers; knowledgeable informal language; fluent jargon with a weak current baseline; uncertain or contradictory answers.                                                                             |
| Coaching preference       | Wants guidance; has a preferred method; dislikes particular workouts; values simplicity; wants variety; needs the trade-off explained before agreeing.                                                                                                             |
| Task                      | Discovery and creation; construction from an agreed brief; feedback and adaptation; fitness update; advice without plan creation.                                                                                                                                  |

Experience is per sport. Triathlon/hybrid scenarios need a vector such as experienced cycling, intermediate running and beginner swimming. Likewise, technical strength knowledge does not establish an endurance baseline. Communication must also vary within experience bands: do not make every beginner vague and every experienced athlete analytical.

For controlled variants, change one principal factor wherever possible. For example, keep the baseline and schedule fixed when testing terse versus detailed phrasing. Composite life situations are useful too, but label them as such rather than attributing an outcome to age or language alone.

## Plan duration, prescription horizon and execution scale

Plan length must be an explicit coverage dimension. Distinguish three quantities:

- **Overall plan span:** the start/end dates and strategic phases through the athlete's goal or maintenance period.
- **Detailed prescription horizon:** the dates the athlete has agreed should have complete workouts now. An annual plan with the first four weeks prescribed can be complete for that agreed task.
- **Execution size:** the actual blocks, weeks, workouts, expanded repetitions and prescription-tree steps the agent needs to write, plus the existing content it needs to read to revise a plan.

A longer span does not necessarily imply more tool calls if most detail is deferred. Conversely, a short, dense multisport block can require more writing than a much longer simple running schedule. Record and filter all three rather than labelling everything a “long plan”.

### Proposed coaching policy

Treat these as coaching recommendations and evaluation expectations, not new server-enforced duration limits:

| Situation                               | Expected coaching behavior                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duration unspecified                    | Recommend roughly two to three months for consistency, explain why it suits the goal, and agree dates and how much to prescribe now. This is a default recommendation, not a forced duration for every event.                 |
| Ordinary short plan                     | Generally recommend at least a month. Respect an explicit shorter request while explaining its limited scope.                                                                                                                 |
| Explicit sample                         | A one-week sample is valid. Do not reject it or silently expand it, and do not treat it as an entire event preparation.                                                                                                       |
| Seasonal or annual plan                 | Support up to about twelve months when useful, with repeated training phases, review checkpoints and an agreed rolling prescription horizon. Do not automatically recommend a year for every athlete.                         |
| Specific goal just beyond twelve months | Permit a modest, explicitly justified extension; use a 56-week fixture as one concrete test, not a newly invented maximum.                                                                                                    |
| Multiple A races within a year          | Preserve accepted dates and priorities; assess the proposed preparation, taper, recovery and rebuilding between goals. Explain conflicts and negotiate priorities when needed, rather than applying a universal spacing rule. |
| Multi-year goal                         | Retain the long-term ambition as context and recommend a bounded first plan and later reviews. Avoid a fully prescribed multi-year schedule or multi-year A-race calendar.                                                    |

Use explicit calendar dates for expectations. A calendar month is not always four weeks, and a calendar year is not exactly 52 weeks. The first duration fixtures can use whole-week ranges compatible with the current schedule model; label 52 weeks as an annual approximation and retain the actual elapsed days. Date-boundary cases should separately establish how non-whole-week goal dates are represented.

Separate the recommendation task from forced-length construction. If an athlete asks “how long should I plan for?”, inspect the recommendation and agreement. For execution comparisons, give the athlete an already agreed span and prescription horizon so changes in negotiation do not masquerade as generation performance. Use the production-equivalent prepared-brief stage when isolating construction.

### Twelve duration scenarios

All parents below are development families. D01–D04 retain the same running baseline, availability and communication style; change only the agreed horizon where the goal permits. D05 reuses the hybrid persona from the core pilot and changes only its overall span. D06 adds a specific dated goal and is therefore an exception case rather than a clean duration-only comparison. Non-event comparisons avoid moving an event closer while holding an incompatible athlete goal fixed.

| ID                                 | Parent                   | Overall span / detailed horizon             | Purpose                                                                                                 |
| ---------------------------------- | ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| D01: sample                        | `run-intermediate`       | One week / one week                         | Respect an explicit sample request; complete prescriptions and truthful scope.                          |
| D02: short block                   | `run-intermediate`       | Four weeks / four weeks                     | Short ordinary plan, with context about longer consistency.                                             |
| D03: standard block                | `run-intermediate`       | Twelve weeks / twelve weeks                 | Fully prescribed typical-length reference for execution comparisons.                                    |
| D04: seasonal rolling              | `run-intermediate`       | 26 weeks / four weeks                       | Longer structure without falsely declaring the entire schedule prescribed.                              |
| D05: annual rolling                | `hybrid-improver`        | 52 weeks / four weeks                       | Matched against the core twelve-week hybrid scenario; annual phases and bounded detailed work.          |
| D06: goal beyond a year            | `run-intermediate`       | 56 weeks / four weeks                       | Justified modest overrun for a specific goal; no arbitrary one-year rejection.                          |
| D07: multisport rolling            | `triathlon-intermediate` | Twelve weeks / four weeks                   | Multisport reference for D08 at the same initial prescription horizon.                                  |
| D08: annual multiple A races       | `triathlon-intermediate` | 52 weeks / four weeks                       | Two agreed A races inside the year; strategic coherence and honest partial detail.                      |
| D09: full seasonal stress          | `run-intermediate`       | 26 weeks / 26 weeks                         | Matched against D04 to isolate detailed horizon and batching demand.                                    |
| D10: full annual multisport stress | `triathlon-intermediate` | 52 weeks / 52 weeks                         | Matched against D08, including the same A races; dense tool use and persistence.                        |
| D11: recommend a horizon           | `gym-intermediate`       | Unspecified / agreed during conversation    | Agent recommends a useful two-to-three-month starting period and negotiates initial detail.             |
| D12: multi-year request            | `triathlon-intermediate` | Requested three years / bounded alternative | Preserve the ambition, explain scope, and agree an initial plan rather than produce multi-year A races. |

D09/D10 are opt-in execution stress cases, not a policy that the coach should recommend months of immutable detail. Record them as separate execution variants of the same athlete families. A sound recommendation to use rolling detail can pass coaching judgment while not satisfying a benchmark whose predeclared construction task requires full coverage. Report that distinction rather than rewriting its success contract after the run. For advice/negotiation cases, an accepted shorter horizon is an explicitly allowed outcome.

### Execution measures and additional probes

The current [tool schema](../../apps/api/src/modules/agent/agent.schemas.ts) caps each schedule batch at 100 workouts, 52 week entries and 20 blocks, and each workout at 100 prescription steps. The [schedule handler](../../apps/api/src/modules/agent/agent.schedule.ts) additionally caps the total at 2,000 steps per batch. These are per-batch limits, not a one-year plan limit. [Worker configuration](../../apps/agent/src/config.ts) caps SDK turns at 40 and output tokens at 16,000 per model call; the [API](../../apps/api/src/modules/agent/agent.service.ts) caps accepted tool executions at 200 per run. SDK turns, tool executions and athlete messages are different counters. The current benchmark's `planningWeeks <= 12` and `goalWeeks <= 52` restrictions must also be replaced before these cases can run.

Capture accepted/failed tool calls, model calls, batch sizes, cumulative tokens, tool latency, elapsed time, persisted workout/step counts and exact coverage gaps. Record when the last successful write occurred and why execution stopped. Useful derived measures are time/tokens per completed prescribed week and per workout, displayed with session density and prescription complexity. Do not reward cheap output that achieves efficiency by omitting recovery steps or simplifying agreed detail.

Keep the same production limits for the first matched comparison. A later diagnostic run with changed limits is a different configuration and must be labelled; never raise limits silently until a long case passes. A deliberate stress-limit failure measures the current runtime boundary and should be reported separately from ordinary athlete-facing coaching quality.

The most useful companion probes are:

| Probe                    | What to vary or trigger                                                                 | What to inspect                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Session density          | Few versus many sessions under a feasible agreed availability contract.                 | Number of writes, overlapping sessions, daily limits and shared time budgets.                                                     |
| Prescription complexity  | Simple steady sessions versus nested intervals, swim sets, lifts and mixed circuits.    | Batch splitting, valid parent references, repeat expansion and retained actionable detail.                                        |
| Event/phase complexity   | One versus multiple A races, optional B/C races, repeated phases and a near-term event. | Coherent strategic structure and event priorities, separately from detailed coverage.                                             |
| Later-week degradation   | Compare early, middle and final prescribed weeks of a full long schedule.               | Constraint adherence, missing or repetitive detail, progression and race-date drift throughout the plan.                          |
| Rolling extension        | Extend D05/D08 in successive agreed chunks after chat feedback.                         | Consistent phase intent, correct new coverage, no duplicated weeks and preservation of earlier/unrelated work.                    |
| Large existing plan      | Revise a small date range near the end of a populated annual fixture.                   | Bounded schedule reads, appropriate IDs and scoped edits without rewriting the entire plan.                                       |
| Interruption or conflict | Stop after a known accepted batch, or introduce a controlled concurrent edit.           | Partial coverage remains honest, saved chunks persist, conflicts are reported, and later permitted continuation uses fresh state. |
| Calendar boundaries      | Cross year end or leap day; request an event on a non-week boundary.                    | Correct dates and representation of edge weeks without pretending 52 weeks equals a calendar year.                                |

These probes are a prioritised follow-on list, not extra cases counted in the 61. Add them as reviewed scenarios or clearly labelled execution variants when implemented. For long-plan review, inspect every week with deterministic checks and use per-block/week evidence for model/human review. If evidence must be chunked for a reviewer, record the chunks and preserve findings; do not silently grade only the first month of a fully prescribed year.

## The 28 core personas

Each row is an athlete family with one initial conversation-to-plan scenario. The outlines below are authoring briefs; exact ages, recent baselines, available days, session limits, facilities, dates and evidence must be frozen in validated scenario files before execution. These are test situations, not prescribed training doses.

The seven rows marked **holdout** are reserved families. Do not use their plans to tune the coaching prompt, or include their close derivatives in development suites. Author and validate their contracts before reserving them. If a holdout is later used for iteration, promote it to development and replace it with a fresh reserved family.

| ID / sport                           | Experience            | Athlete and goal                                                                                         | Distinguishing test                                                                                |
| ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `run-beginner`                       | Beginner              | New to consistent running, wants to establish a run/walk habit before considering an event.              | Zero/low recent baseline; no race result; ordinary language; distinguish unknown from unanswered.  |
| `running-poc`                        | Improver              | Existing first-half-marathon runner: three weekly runs, 22 km, recent 5 km result, three available days. | Keep the current four-week prescription within the twelve-week goal as the regression anchor.      |
| `run-intermediate`                   | Intermediate          | Consistent structured runner seeking a better 10 km result alongside a busy job.                         | Use current evidence and limited time rather than treating ambition as capacity.                   |
| `run-experienced` — **holdout**      | Experienced           | Long-term runner maintaining fitness with fewer sessions and no race target.                             | Detailed training knowledge, modest desired load, no invented event or return to past peak volume. |
| `cycle-beginner`                     | Beginner              | Casual rider wants comfortable longer rides, no meter or known FTP.                                      | Actionable effort guidance alongside honestly labelled estimated calibration.                      |
| `cycle-improver`                     | Improver              | Regular recreational cyclist preparing for a first organised long ride.                                  | Known weekly riding time; uneven weekday/weekend availability; indoor trainer access.              |
| `cycle-intermediate` — **holdout**   | Intermediate          | Structured cyclist targeting a time trial with a recent power test.                                      | Appropriate power provenance, event specificity and time-based baseline.                           |
| `cycle-experienced`                  | Experienced           | Years of riding, high established recent volume, wants performance work within a fixed time budget.      | Substantial load grounded in actual history; technical language should not obscure constraints.    |
| `triathlon-beginner` — **holdout**   | Beginner in triathlon | First short triathlon; established running habit but little pool or bike practice.                       | Uneven sport experience, pool access and no single baseline copied across sports.                  |
| `triathlon-improver`                 | Improver              | Has completed a short triathlon, wants a more consistent second attempt.                                 | Coordinate all three disciplines and optional strength within a shared schedule.                   |
| `triathlon-intermediate`             | Intermediate          | Established multisport athlete preparing for an Olympic-distance event.                                  | Separate measured fitness evidence, a brick and realistic combined time commitments.               |
| `triathlon-experienced`              | Experienced           | Long-term triathlete maintaining capability while work and family reduce training time.                  | Negotiate priorities without reusing old high-volume habits.                                       |
| `swim-beginner`                      | Beginner              | Can swim but lacks a structured fitness habit; wants manageable pool sessions.                           | No CSS result; clear set instructions and rest; limited pool access.                               |
| `swim-improver` — **holdout**        | Improver              | Regular pool swimmer wants more consistent distance and pacing.                                          | Interpret simple descriptions of current sessions without requiring specialist terminology.        |
| `swim-intermediate`                  | Intermediate          | Structured swimmer with a recent CSS test and a pool-distance goal.                                      | Correct pace units, repeats, recovery and pool-compatible distances.                               |
| `swim-experienced`                   | Experienced           | Older lifelong swimmer, maintaining explicitly reported current capacity.                                | Respect experience and stated recovery needs without assuming age means low fitness.               |
| `strength-beginner`                  | Beginner              | New lifter wants a simple strength habit and knows no working weights.                                   | Exercise names, sets/reps/rest and effort guidance without inventing measured loads or zones.      |
| `strength-improver`                  | Improver              | Consistent basic lifting, wants a repeatable programme and manageable progression.                       | Translate familiar exercise language into actionable prescriptions.                                |
| `strength-intermediate`              | Intermediate          | Structured lifter with reported working loads and limited weekly sessions.                               | Suggested load versus effort target; recovery and equipment constraints.                           |
| `strength-experienced` — **holdout** | Experienced           | Long-term lifter wants maintenance rather than new personal bests.                                       | Honour modest goals and avoid unsupported max-strength tracking claims.                            |
| `gym-beginner`                       | Beginner              | New gym member wants confidence and general fitness with machines and simple cardio.                     | Clarify what “gym training” means; understandable instructions and facility-specific choices.      |
| `gym-improver` — **holdout**         | Improver              | Regular gym attendee wants structure, variety and a sustainable habit.                                   | Goal is general fitness, not automatically racing or maximal strength.                             |
| `gym-intermediate`                   | Intermediate          | Established gym routine combining resistance sessions and aerobic work.                                  | Balance modalities, available time and familiar terminology.                                       |
| `gym-experienced`                    | Experienced           | Long-term gym attendee who speaks informally and wants a practical mixed routine.                        | Years of attendance do not imply either high training load or specialist coaching language.        |
| `hybrid-beginner`                    | Beginner              | Wants enjoyable variety through simple circuits and aerobic sessions.                                    | Avoid complexity and intensity escalation just because the request mentions circuits.              |
| `hybrid-improver`                    | Improver              | Regular circuits and running, wants consistent general fitness.                                          | Disambiguate variety versus competition; preserve preferences and realistic recovery.              |
| `hybrid-intermediate` — **holdout**  | Intermediate          | Established run/lift athlete interested in a Hyrox-style event.                                          | Mixed prescription trees, named stations, sport-specific targets and shared recovery.              |
| `hybrid-experienced`                 | Experienced           | Years of varied training; prefers autonomy and fitness maintenance over competing.                       | Respect a preferred approach and evaluate coherent variety without assuming a race.                |

### Sport categories versus application disciplines

These seven categories describe user goals. The [current application contract](../adr/0006-multisport-plans.md) has four brief sports: `run`, `cycle`, `swim`, `strength`. Workouts can also be `mixed`; their steps can include `row`, `ski_erg` and transitions.

- Triathlon maps to run/cycle/swim, with strength only when agreed.
- Strength prioritises resistance training. Gym training describes a setting and a broader habit/fitness goal; it can use strength plus agreed aerobic sports or mixed sessions.
- Hybrid describes an agreed combination of resistance and aerobic work. A general fitness hybrid case must not silently become a Hyrox event case.

Keep these as catalogue tags rather than adding artificial `gym` or `triathlon` sports to the domain model. For mixed sessions, report workout count separately from sport exposures: a cycle/run brick is one scheduled workout containing two disciplines, and its time counts once toward the daily budget. Author the scenario's frequency semantics explicitly.

The current prompt frames strength as supporting endurance and lacks dedicated strength-performance tracking. Standalone strength/gym cases therefore also test product scope. Failures may justify a product or prompt decision rather than simply a stronger model. Label specialist max-strength, physique or technical swimming coaching expectations as uncovered until separately defined; do not imply that supporting their workout representation proves specialist coaching quality.

## Fourteen targeted variations

Each variation is one concrete scenario attached to a development persona, not an automatic expansion across all 28. Record its parent and changed facts. Language variants use equivalent authored facts so the simulator cannot improve the athlete's knowledge.

| Variation                       | Parent                   | Change and behavior to inspect                                                                                                                                        |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V01: returning athlete          | `run-intermediate`       | Long history but a prolonged break and a much lower recent baseline; plan from present facts.                                                                         |
| V02: older, reduced capacity    | `strength-intermediate`  | Older experienced athlete explicitly requests fewer sessions and more recovery; age plus reported needs form a composite case.                                        |
| V03: age control                | `swim-experienced`       | Change age only to a younger adult, retaining the same capacity and constraints; inspect unexplained age-based changes.                                               |
| V04: very limited time          | `hybrid-improver`        | Short sessions and caregiving commitments; negotiate priorities within the stated budget.                                                                             |
| V05: no power measurement       | `cycle-beginner`         | Cannot measure watts or perform the proposed power test; maintain useful RPE instructions and honest estimates, acknowledge the calibration/test limitation.          |
| V06: no swim performance data   | `swim-beginner`          | Does not know pace or CSS; avoid repeated requests for unavailable evidence and inspect any proposed estimate/test.                                                   |
| V07: no known lifting loads     | `strength-beginner`      | Cannot report working weights; clear effort-based prescriptions, no invented supplied load.                                                                           |
| V08: home equipment only        | `gym-beginner`           | Dumbbells/bands and no commercial gym; every prescribed exercise must fit the stated equipment.                                                                       |
| V09: uneven multisport capacity | `triathlon-intermediate` | Strong cycling but markedly limited current swim capacity; retain distinct sport baselines and priorities.                                                            |
| V10: sparse answers             | `run-beginner`           | Same facts, shorter plain-language responses and some explicit unknowns; focused discovery without endless questioning.                                               |
| V11: incompatible ambition      | `cycle-experienced`      | Requests a load/event outcome incompatible with the fixed schedule; inspect explanation, negotiation and the final agreed contract.                                   |
| V12: terminology mismatch       | `gym-intermediate`       | Equivalent facts in informal language with ambiguous “sets” or “sessions”; clarify material ambiguity rather than guessing.                                           |
| V13: jargon without capacity    | `hybrid-improver`        | Same recent baseline, fluent training jargon; inspect whether vocabulary alone changes prescribed load.                                                               |
| V14: health-boundary disclosure | `running-poc`            | Replace the no-current-restrictions fact with a material current pain/restriction disclosure; test acknowledgement and appropriate limits or deferral, not diagnosis. |

V14 requires a separately reviewed boundary rubric and explicit allowed outcomes before it is scored. Do not turn medical conditions into ordinary low-load modifiers. More specialised return-to-training, pregnancy/postpartum or rehabilitation cases can be authored later with relevant expertise; the initial suite makes no claim to cover them.

Together the base library and variations cover new starters, regular improvers, high-capacity athletes, experienced athletes with modest goals, returners, older athletes, athletes crossing sports, time-poor athletes, people without data/devices, and athletes whose language misrepresents their training capacity.

## Seven adaptation scenarios

Use one development family per sport category. Each adaptation is a distinct case with a versioned starting fixture and before/after checkpoints. A creation-then-adaptation trajectory is also useful later; it costs a full creation stage and should be reported separately from adaptation from a fixed plan.

| ID                       | Parent               | Event                                                               | Required evidence                                                                                     |
| ------------------------ | -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A01: availability change | `running-poc`        | Thursday becomes unavailable.                                       | Move affected future training, preserve unrelated content and accurately describe changes.            |
| A02: fitness update      | `cycle-improver`     | Supplies a new measured power result with its date.                 | Correct provenance and effective-date behavior; calibration-only update preserves schedule content.   |
| A03: facility loss       | `triathlon-improver` | Loses pool access temporarily.                                      | Negotiate a feasible adjustment without pretending other sports substitute exactly for swimming.      |
| A04: fatigue feedback    | `swim-intermediate`  | Says week one was too demanding and asks to revise future sessions. | Acknowledge feedback, adapt the scoped future horizon and preserve earlier content.                   |
| A05: equipment change    | `strength-improver`  | Has only dumbbells for the next fortnight.                          | Actionable substitutions, appropriate effort guidance, no unsupported exercises.                      |
| A06: missed week         | `gym-intermediate`   | Missed training and wants help resuming.                            | Use stated chat feedback; do not invent workout completion data or automatically cram missed work in. |
| A07: preference change   | `hybrid-experienced` | Dislikes circuits and wants simpler separate sessions.              | Preserve the goal while changing structure and accurately updating the brief.                         |

The creation runner currently stops when coverage is reached. Adaptation needs an explicit checkpoint state machine so it does not exit before sending the event. Fixed-plan setup belongs to the local operator, not to coach permissions. The owner remains responsible for confirmation/locking. A later locked-plan boundary case must not give the coach unlock powers.

## Scenario contract and authoring

Use checked-in JSON validated by Zod, consistent with the existing harness. Reuse small typed definitions; avoid a general scenario scripting language. A resolved, immutable scenario is always exported with the run.

The task contract must carry separate overall plan dates and detailed coverage dates, requested versus accepted horizons, and whether the case tests recommendation, ordinary generation or forced execution stress. Execution-size metadata comes from the actual exported trees and tool trace, rather than assuming a number of weeks implies a fixed number of writes.

| Part          | Content                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Stable ID, schema/content version, parent, development/holdout split, tags, owner notes and review status.                                                                  |
| Athlete       | Per-sport history and recent baseline; goals, preferences, equipment, evidence and recovery/availability facts. Zero, unknown and unanswered are distinct.                  |
| Communication | Opening message and authored equivalent fact strings for the selected speech style; disclosure rules and permitted clarification/negotiation.                               |
| Task          | Creation/prepared-brief/adaptation/discussion; agreed dates and horizon; initial fixture; outcome contract and bounded checkpoints.                                         |
| Constraints   | Structured available days, per-day/per-week time budgets, access restrictions, requested frequency semantics and units. Exact constraints must not depend on parsing prose. |
| Expectations  | Applicable deterministic assertions, versioned rubric/anchors and explicit permitted outcomes. Identify what must be discovered and what is optional.                       |
| Execution     | Scenario clock/timezone, message/time/token limits and model configuration recorded in the experiment manifest.                                                             |

Maintain three views: coach-visible application state/messages, simulator-private facts and disclosure policy, and evaluator-private expectations. The simulator never sees the rubric, and hidden facts never enter coach context through fixture metadata. Grade use of facts against a checkpoint knowledge ledger; separately grade failure to ask for a material fact.

Continue selecting fact IDs with code rendering exact values. For speech variation, choose from reviewed, equivalent fact strings rather than allowing freeform invention. Unknown responses, requests to proceed and negotiated alternatives also need scenario-appropriate renderers. Log selected intent, fact IDs, wording variant and fact revision per message.

Facts can change only through declared events or permitted negotiation. Record the original request and the athlete's accepted alternative; do not silently lower expectations to whatever the coach generated. Invalid simulator disclosures invalidate the trial and remain visible as such, distinct from coach failures.

For comparisons, resolve dates once for the experiment and use the same effective clock and fixture for every trial. Thread it through domain performance reads/writes and date-sensitive checks, not just message placeholders. Keep cancellation deadlines and worker heartbeats on real time. This is necessary before comparing fixtures across days or testing effective-dated calibration changes.

### Manual cases

Provide a simple copy-and-edit template and a validation/list command before a GUI authoring tool. The author chooses the parent, changes facts, writes an opening message/event, and declares the expected outcome. Validation rejects duplicate IDs, invalid units/dates and conflicting constraints before provider calls.

New manual cases start as **exploratory**. They can run and receive human notes immediately; only their reviewed exact constraints are binding. Keep provisional model judgments visibly provisional. Progress through exploratory → owner-reviewed → grading-calibrated. Promote a recurring failure into a regression case after reviewing the scenario, not merely because one model disliked its output.

If real conversations later become fixtures, explicitly author a synthetic/de-identified case rather than committing raw account evidence. Existing human reviews stay alongside run artifacts; grading fixtures and their labels are separate versioned assets.

## Evaluation and result presentation

Keep execution validity, exact constraints, coaching quality and human opinion separate. A case passing after three attempts does not erase two failures.

1. **Execution validity:** setup/provider errors, limits, cancellation, invalid simulator actions and missing assessments. Retain partial evidence and show counts; these are not interchangeable with an unsuitable plan.
2. **Exact checks:** correct disciplines/dates/horizon; actual persisted prescriptions; baseline/provenance fidelity; allowed days and time/equipment constraints; daily session limit; no unwanted plan; scoped adaptation and lifecycle invariants. A draft does not need human confirmation to pass creation.
3. **Judged quality:** goal fit, progression from current facts, recovery, actionable sport-specific prescriptions, personalization, focused discovery, truthful claims and adaptation. Use applicable criteria with pass/fail/uncertain/not-applicable, severity and real evidence references. Unknown facts or incomplete duration estimates must remain unknown, not count as zero or pass.
4. **Human review:** fit for purpose/needs revision/unfit, per-criterion agreement, failure tags, notes and corrections. Add a clear “cannot assess” state where necessary and retain review/grader versions.

Creation ordinarily expects a saved plan; advice-only expects no new plan. A predeclared negotiation/deferral case can succeed with an appropriate explanation and no schedule. Give that outcome its own contract rather than treating every missing plan as incomplete or letting a simulator's satisfaction determine success.

Use a shared quality rubric with sport-specific anchors. Running/swimming quantities are metres; cycling baselines are seconds; strength uses sessions plus prescribed sets/repetitions/effort. Expand nested repeats and attribute mixed-session quantities to steps. Show known durations, estimates and missing durations separately. Do not sum running, cycling and swimming distance into a training-load score or average unrelated sport-zone counts. A frequency target may be exact, a range or an accepted negotiated value; it is not universally three sessions.

Grader calibration should initially include at least **one acceptable and one deliberately defective fixture per category**. These 14 reviewer-only fixtures are additional to the 61 coaching scenarios. Include credible alternatives, not one reference schedule every good plan must match. Review missed defects, false alarms and uncertain judgments before turning training-quality criteria into gates. Hard constraint failures cannot be offset by pleasant conversation.

The dashboard should let the owner filter by sport, experience, current capacity, language, task, split and review maturity; open a persona's trial history; inspect prescriptions and checkpoint diffs; and save/continue through its review queue. Display suite coverage and missing/unreviewed cells, not just a blended quality number. Compare paired cases under fixed simulator/reviewer settings, with per-sport results and denominators. Broad comparisons should weight scenario families equally rather than letting a sport with more runs dominate. Preserve legacy quality-score displays but label rubric/check versions and exclude not-applicable criteria from denominators.

## Suites and run workflow

| Suite              | Cases                                                                                                                                                           | Use                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `smoke`            | Seven development cases: `running-poc`, `cycle-beginner`, `triathlon-intermediate`, `swim-beginner`, `strength-beginner`, `gym-experienced`, `hybrid-improver`. | First exploration and quick checks after a harness/prompt change.              |
| `core-development` | 21 core personas.                                                                                                                                               | Routine broad iteration without using reserved families.                       |
| `edge`             | V01–V14.                                                                                                                                                        | Targeted robustness; boundary cases wait for their reviewed outcome contracts. |
| `adaptation`       | A01–A07.                                                                                                                                                        | Feedback, updates and preservation.                                            |
| `holdout`          | Seven reserved core families.                                                                                                                                   | Later evaluation of a frozen candidate, not daily tuning.                      |
| `regression`       | Reviewed failures promoted over time.                                                                                                                           | Keep known defects fixed; size grows independently of the initial catalogue.   |

The additional `duration` suite selects D01–D12. Exclude D09/D10 from ordinary runs unless execution stress is explicitly selected; every skipped/unselected case is visible in suite coverage. Add span, detailed horizon, execution variant, workout density and complexity to the dashboard filters. Keep coaching-quality comparisons separate from forced full-horizon stress results.

Proposed CLI surface, **not available today**:

```sh
pnpm bench scenarios --list
pnpm bench scenarios --validate
pnpm bench run --scenario cycle-beginner
pnpm bench suite --suite smoke --repeat 1 --label broad-baseline
pnpm bench suite --suite core-development --repeat 3 --label prompt-candidate
pnpm bench suite --suite duration --repeat 1 --label horizon-exploration
```

Start sequentially in the current isolated environment. A suite gets an experiment ID, resolved scenario/fixture hashes, a frozen configuration and one trial index per case/repeat. Each trial has a fresh athlete/conversation, including fixture state for adaptation. Keep the existing portable per-run artifacts and add an experiment index plus checkpoint snapshots; avoid changing artifact directory layout merely to group runs.

Capture partial results after every trial. Resume only unfinished trial IDs with the exact recorded configuration; any explicit retry creates a new attempt and preserves the failed one. Keep scripted wiring results out of live coaching-quality summaries. A launch panel can wrap these same commands later, following the dashboard roadmap.

For exploration, one run per smoke case is seven conversations. Three repeats are 21. The original 49-case athlete catalogue remains independently runnable; adding all 12 duration cases gives 61, or 366 conversations for baseline versus candidate with three repeats, before simulator and reviewer calls. Stress cases can cost substantially more than ordinary cases and need separate estimates/limits. Do not make the full matrix the default. Measure actual tokens/time on the seven-case pilot; show a budget estimate and enforce total call/token/elapsed limits for batches. Any monetary estimate needs a dated price table and must label missing usage. Freeze simulator and reviewer models explicitly rather than inheriting whichever coach model is being tried.

## Delivery sequence and acceptance

### First implementation: an eight-case model pilot

The first useful implementation is a complete author → run → inspect → compare loop for **eight cases**, rather than filling the 61-case catalogue immediately. Keep the current coaching prompt unchanged during this pilot so scenario/harness work does not become a simultaneous prompt experiment.

Use the seven `smoke` cases and an additional `hybrid-improver-annual` scenario. The ordinary `hybrid-improver` has a twelve-week general-fitness span; its annual variant has a 52-week span. Both prescribe the first four weeks and retain the same athlete, baseline, availability, communication style and non-event goal. This is a controlled comparison of overall span, not a claim to test fully prescribed annual generation. Full twelve-week and seasonal/annual stress cases follow after this loop is trustworthy.

The annual hybrid variant is D05 in the duration suite, so the pilot draws seven core cases plus one duration case from the 61-case catalogue. It is not an additional persona or an uncounted scenario.

#### Authoring and composition

Start with three small, checked-in data collections:

The authored pilot uses `apps/bench/datasets/v1/{personas,scenarios,suites}` to keep the edition together, with `catalogue.json` tracking its coverage. The layout below describes responsibilities; the existing legacy scenario remains at its original path. Model experiment configuration has not been authored yet.

```text
apps/bench/
  personas/       # Seven authored athlete fact sheets with communication styles
  scenarios/      # Eight tasks referencing those athletes; running-poc v1 retained
  suites/         # pilot-v1.json: explicit ordered list of the eight case IDs
  experiments/    # Model/configuration matrices; identifiers and settings, no keys
```

A persona owns sport experience, recent baselines, equipment, availability, preferences and the facts it can disclose. A scenario owns the opening request, task, dates/span, detailed horizon, permitted outcomes and private evaluation expectations. A suite selects cases. An experiment selects the suite, coach configurations, fixed simulator/reviewer configurations and repetitions.

Compose a case by referencing a persona and applying explicit, typed field overrides. Arrays such as available days are replaced deliberately; avoid a generic deep-merge language. Validate the resolved case and export its full contents and hash. Keep canonical structured facts as the source for both exact assertions and authored message templates, so numerical expectations cannot drift away from what the athlete says. Private facts are not prefilled into the coach's brief: the coach learns them through disclosed messages and ordinary tool state.

An illustrative scenario pair, using a proposed format:

```json
{
  "id": "hybrid-improver-annual",
  "version": 1,
  "personaId": "hybrid-improver",
  "task": "conversation_to_plan",
  "planSpanWeeks": 52,
  "prescriptionWeeks": 4,
  "openingMessage": "I'd like a year-long general fitness plan, with the first month fully prescribed for now."
}
```

Its sibling uses the same persona with a twelve-week span and corresponding opening/horizon wording. Resolve actual dates once per experiment. The loader compiles the authoring references into the richer scenario contract above; this shorthand is not the entire executable schema.

For the first cases, manually author concrete combinations that collectively cover novice/experienced language, measured/unknown fitness, limited equipment and mixed sports. Labels are metadata, not permission to invent capacity. The simulator selects approved fact IDs and intents; reviewed wording renders the selected facts. There is no runtime random persona generation. Adding a later case is normally a new data file/override and an entry in a suite, plus new checks only if it introduces a genuinely new capability.

#### Implementation boundaries

Deliver the pilot through three connected pieces:

1. **General scenario execution:** replace literal running-only selection with a validated registry and legacy loader; generalise message rendering, required-discovery IDs, horizon completion, checks and reviewer anchors. Accept known zero/unknown baselines. Keep the six existing reviewer dimensions initially and apply sport-specific anchors; introduce not-applicable only with matching artifact/dashboard handling. Add provider-free fixtures that exercise every pilot discipline without pretending to assess coaching quality.
2. **Suite/model execution:** extract single-trial logic from CLI argument parsing into a callable function. A sequential experiment runner builds/sets up once, owns the worktree lock, and invokes trials without reacquiring that same lock. Reuse the isolated API/database where healthy, restart/stop the worker as configuration requires, and create a fresh athlete/conversation per trial. Write an experiment manifest/index that maps case/configuration/repeat IDs to the existing run directories. Persist partial outcomes after every trial; never overwrite or retry failed runs automatically. Provider/authentication failures stop the batch, while ordinary poor-plan results remain outcomes and do not prevent the next trial.
3. **Useful dashboard results:** read experiment membership and persona/span metadata; correct sport-specific analysis and totals; allow filtering to the pilot and matching the same case across models. Reuse conversation evidence, manual review and existing model comparison. Show missing, invalid and unfinished runs explicitly, plus per-scenario differences and token/time/tool counts. A dashboard launch panel, GUI persona editor and elaborate statistical ranking are later work.

For the first batch, preflight every coach configuration and require explicit simulator/reviewer models. Use models compatible with the current OpenAI runtime; other provider families require separate adapters. Match reasoning and other runtime settings where supported, or label them as different configurations. Unsupported settings fail preflight rather than silently changing. Freeze scenario, prompt, date context, simulator and grading versions across the experiment. Save prompt text once with its hash for provenance even though this pilot has no candidate-prompt injection.

#### Running and reviewing the pilot

Proposed commands, unavailable until implemented:

```sh
# Inspect and validate local case data; no provider calls.
pnpm bench scenarios --list
pnpm bench scenarios --validate

# One persona/task, using the existing coach environment configuration.
pnpm bench run --scenario cycle-beginner

# Eight cases against the existing coach configuration.
pnpm bench suite --suite pilot-v1 --repeat 1 --label pilot-baseline

# The same cases across the explicitly configured coach model matrix.
pnpm bench experiment --config apps/bench/experiments/pilot-models.json

# Existing viewer command remains unchanged.
pnpm dev:evals
```

The experiment file contains suite ID, coach model IDs/reasoning settings, fixed simulator/reviewer IDs, repeats and call/token/time limits. Secrets use the existing env-file/1Password mechanism. A dry-run/preflight lists the planned case/configuration matrix and limits without creating athletes or making paid model calls; known past usage can inform an explicitly uncertain cost estimate.

Run eight baseline conversations first and inspect all eight, including actual prescriptions and any judge disagreement. Correct scenario/harness faults before using them for comparison. Then add two coach candidates: **eight cases × three models × one trial = 24 conversations total**. Alternatively, start with just one candidate for 16. One trial is an exploratory sample, not evidence of dependable superiority. After review, repeat the two most useful configurations three times on the frozen eight-case suite: 48 new conversations, reporting reliability and keeping the earlier single-trial experiment separate.

The pilot is delivered when all eight cases are selectable, a model matrix runs sequentially with identical case inputs and isolated athletes, old running artifacts still load, sport quantities are correctly displayed, and the owner can inspect/review every result. Validate configuration/fact boundaries, per-sport checks, coverage, batch isolation, interruption and legacy reads before live runs; verify dashboard behavior in the real local browser with saved evidence. Broaden the catalogue and add full-horizon stress/adaptation only after reviewing this pilot's output.

These are implementation stages, not calendar commitments. Deliver the usable eight-case pilot before waiting for all 61 cases or every specialist rubric. Include explicit overall/detailed dates in Stage 1's schema. Add short, standard and rolling annual duration cases alongside Stage 3; enable full seasonal/annual stress only after batch telemetry and partial-result handling are validated. Rolling extension and large-plan revision probes follow Stage 4's checkpoints and clock support.

| Stage                             | Deliverable                                                                                                                                                                         | Acceptance                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Generalise the creation path   | Registry, typed schema, neutral fact rendering/simulator/reviewer, shared plus sport checks, structured constraints and per-sport dashboard analysis. Author the seven smoke cases. | Each case exports an inspectable real conversation and saved prescription; sport labels/units/unknowns are correct. Legacy running artifacts remain readable. |
| 2. Make repeated exploration easy | Named suites, sequential repeats, experiment index, bounded execution and resume semantics, filters and manual templates.                                                           | One command runs seven cases; interruptions retain results; the owner can review one persona and rerun it without overwriting evidence.                       |
| 3. Fill the catalogue             | Author remaining core cases and 14 variants; assign reserved families; add sport grading anchors and calibration examples.                                                          | Coverage gaps are visible; variants are reproducible; owner review can distinguish scenario defects, coach defects and judge defects.                         |
| 4. Add adaptation                 | Versioned saved-plan fixtures, authoritative test clock, checkpoint state machine, scoped diffs and seven events.                                                                   | Every event is delivered; before/after prescriptions are retained; appropriate changes and preserved content can both be checked.                             |
| 5. Compare and harden judgments   | Explicit prompt snapshots/injection and paired baseline/candidate cohorts; calibrated quality checks; heldout evaluation after candidate selection.                                 | Same fixtures/configuration underpin comparisons; failures and uncertainty stay visible; no unreviewed clinical or specialist expectation becomes a gate.     |

Validation for implementation should cover scenario validation and legacy loading; fact/role isolation; sport-specific positive/negative checks; unknown and zero baselines; mixed repetitions and time accounting; valid non-plan outcomes; batch isolation, interruption and resume; and adaptation completion/preservation. Duration validation adds exact overall versus prescribed dates, recommendation/negotiation outcomes, multi-batch limits, complete final-week detail, multiple-event structure and calendar boundaries. Use provider-free wiring cases first, then inspect one real live output per smoke sport. For dashboard behavior changes, verify the real local dashboard and save browser evidence under the repository's browser-verification workflow.

## Later additions

Add cases in response to inspected gaps rather than doubling every axis at once. Useful extensions are a knowledgeable athlete new to another sport; an athlete with high historical fitness and contradictory recent evidence; shift patterns that change each week; multiple events with different priorities; units/timezone boundaries; asking for advice without permission to create a plan; locked-plan editing requests; disrupted or cancelled generation; mobility/equipment adaptations; and a preferred methodology that needs clarification.

Higher-performance specialists, youth athletes and condition-specific training need their own agreed scope and relevant review. Add demographics when they materially change an established requirement or test a specific bias hypothesis, not as automatic proxies for fitness. The catalogue provides measurable coverage of selected situations; it is not exhaustive evidence for every athlete or for real-world training outcomes.
