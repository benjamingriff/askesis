# Phase 3 plan brief and running pace calibration

## Status

**Refinement complete; schema and implementation contracts proposed.** This document is the accepted Phase 3 product and architecture contract produced by the pre-implementation grilling session. It refines the Phase 3 summary in the [V1 proof-of-concept development plan](./v1-poc-development-plan.md).

Implementation details may be refined without reopening this contract. A change that alters the brief fields, confirmation boundary, calibration inputs or outputs, effective-date behavior, or user-visible Phase 3 scope is a product decision.

## Objective and delivery boundary

Phase 3 gives every plan version enough explicit context and running-fitness guidance for a later agent to create an explainable schedule.

It delivers:

- A versioned, plan-specific brief.
- A temporary structured brief editor and deliberate human confirmation flow.
- Pace-only running calibration from one current race result or one estimated threshold pace.
- Persisted Easy, Marathon, Threshold, Interval, and Repetition pace guides.
- Effective-dated calibration changes that affect future workouts without rewriting workout targets.
- Shared authenticated API operations for the temporary web UI and the future agent.
- Workout presentation that resolves zone targets and identifies their calibration source.
- A representative development fixture, local verification, and deployed Railway smoke testing.

It does not deliver:

- Persistent chat, model calls, or an agent worker.
- Conversational brief collection or subjective “too easy” and “too hard” adjustment.
- Heart-rate calibration or heart-rate zones.
- Structured strength, cycling, swimming, or cross-training context.
- Date-specific availability, time-of-day availability, or calendar exceptions.
- Individually editable calculated pace guides.
- A global athlete profile, demographics, or a separate identity for the person described by a plan.
- Product-polish work beyond a clear functional Phase 3 interface.

The structured editor is temporary scaffolding. Phase 4 supplies persistent conversations and Phase 5 moves brief collection and proposed calibration changes into the agent journey. Both later paths use the Phase 3 domain API rather than introducing another representation.

## Plan-specific ownership and versioning

The brief, unit preference, timezone, calibration profiles, calculated pace guides, effective periods, and workout zone references belong to one plan version. They are copied during unlock and restore with the complete version aggregate.

There is no account-level fitness state. Two plans owned by one account may contain unrelated contexts and calibrations. A plan may describe the owner, another runner, or a hypothetical scenario without creating another athlete record.

Draft-owned content is editable. Locked content remains immutable under the Phase 2 application and PostgreSQL protections.

## Structured brief

Each plan version has at most one brief with these fields:

- One non-empty free-text goal.
- A plan-specific distance-unit preference: kilometres or miles.
- An IANA timezone, initially suggested from the browser.
- Typical current weekly running distance, or an explicit unknown answer.
- Current runs per week, or an explicit unknown answer.
- Longest recent run, or an explicit unknown answer.
- Desired runs per week.
- One recurring availability state for each weekday: available, preferred, or unavailable.
- Optional free-text constraints and planning context.

The version header remains the sole owner of start and end dates. There is no separate target date in the brief. Timing nuance belongs in the free-text goal.

The goal is deliberately untyped. Phase 3 removes the existing race/performance/consistency goal vocabulary, structured event fields, priority, and goal-specific distance or duration. There is one authoritative goal rather than a typed `plan_goals` collection and a second brief goal that could disagree with it.

General constraints are also deliberately untyped. Phase 3 removes the existing generic constraint types, severities, values, units, and weekday payloads. Weekday availability is structured separately; other limitations, preferences, injury context, lifestyle considerations, terrain access, and cross-training context use the optional free-text field. The application does not promise mechanical enforcement of statements in that field.

### Running frequency and availability

Availability is a recurring weekly pattern only:

- **Unavailable** is a hard scheduling exclusion.
- **Preferred** is an allowed day the planner should favor.
- **Available** is an allowed alternative.

An allowed day may contain one or two runs. Phase 3 does not model separate time slots. Desired runs per week may therefore exceed the number of allowed weekdays, but it cannot exceed twice that number or the absolute alpha maximum of 14. This rule concerns running workouts only; other workout disciplines are outside the structured brief.

### Units

Kilometres implies minutes per kilometre; miles implies minutes per mile. Mixed distance and pace display units are not supported in alpha.

Distances, durations, and paces use canonical storage units. Changing the unit preference changes entry and presentation without changing the represented quantities or clearing brief confirmation.

### Draft completeness and validation

Incomplete briefs are valid draft content. A brief is ready to confirm only when it has:

- A non-empty goal.
- Valid plan start and end dates.
- A valid IANA timezone.
- A distance-unit preference.
- At least one allowed weekday.
- A desired run count within the double-run capacity.
- An answered current weekly distance, current run frequency, and longest-run question; each answer may explicitly be unknown.
- A current pace calibration.

The constraints and context field and preferred weekdays are optional.

Local validation rejects impossible values and invalid shapes. Plausible but unusual combinations produce warnings rather than errors. Examples include a longest run exceeding typical weekly distance or a sharp increase from current to desired frequency. Confirmation requires fresh acknowledgement of all current warnings.

## Brief confirmation

Brief confirmation is separate from plan locking:

```text
brief being edited → brief confirmed → schedule created or reviewed → plan locked
```

Only the authenticated human owner confirms the brief. The future agent may collect, structure, and propose inputs, but it cannot confirm them.

Confirmation records the draft edit number, a deterministic hash of confirmation-relevant content, the validator version, findings, acknowledgements, and confirmation time. A semantic change to the goal, dates, timezone, baseline, desired frequency, weekday availability, free-text context, calibration input, calculated guides, or calibration timeline clears confirmation. A pure unit conversion that preserves canonical quantities does not.

After confirmation, the UI presents a read-only review. **Edit brief** returns it to editing and clears confirmation when a semantic change is saved. Draft editing uses one explicit **Save changes** action rather than per-field autosave.

After Phase 3, every newly locked revision requires a current confirmed brief. A confirmed plan with no workouts may still be locked after acknowledging the existing empty-schedule warning. Restoring an already locked historical revision remains permitted.

If the goal, dates, timezone, baseline, desired frequency, weekday availability, or free-text context changes while workouts already exist, the workouts are preserved and the schedule is marked potentially stale. Locking requires acknowledgement that the schedule may need review. A calibration-only change updates symbolic future pace targets directly and returns an affected-workout summary without marking the schedule structure stale. Phase 5 may replace this conservative marker with explicit agent-generation provenance tied to the brief hash.

## Calibration input

A calibration has exactly one authoritative input method.

### Recent race result

The user enters:

- Race distance.
- Finish duration.

The UI offers common presets for 5K, 10K, half marathon, and marathon plus a custom distance. Storage uses canonical distance rather than a race-distance enum. Alpha accepts distances from one mile through marathon inclusive.

The input is treated as representative of current fitness. Phase 3 does not collect the race date, score recency, or confidence.

### Estimated threshold pace

The user enters one pace value in the plan unit. It is the authoritative calibration anchor, not an editable range.

Easy pace is never an input method. It is always calculated. Calibration notes, confidence scores, maximum heart rate, threshold heart rate, and heart-rate zones are absent.

## Pace calculator

The first calculator is an internal, deterministic, versioned implementation based on the published Daniels-Gilbert race-performance equations and the Daniels E/M/T/I/R training vocabulary.

It produces:

- Easy (E).
- Marathon (M).
- Threshold (T).
- Interval (I).
- Repetition (R).

The UI calls these Askesis pace guides and does not display an intermediate VDOT score or claim official calculator compatibility. It includes concise descriptions of the purpose, effort, and suitable workout use of each guide.

Every guide stores a target pace and faster/slower acceptable bounds. Bounds are derived proportionally from speed and training intensity: slower aerobic guidance has a wider range, while faster repetition guidance is tighter. Exact coefficients, numerical domain guards, and display rounding are fixed by a reviewed calculator-version specification and golden test cases before the schema is implemented.

The raw input, calculator version, internal fitness scalar when required, and all calculated outputs are persisted when the calibration is created. Reads never recalculate stored profiles. A later formula change creates a new calculator version and affects only newly created calibrations.

The first calculator version is verified against representative official V.O2 calculator outputs within documented tolerances, without making that service a runtime or test dependency.

Users cannot edit E/M/T/I/R values individually during alpha. To change guidance, they replace the authoritative input with a new race result or threshold estimate. Subjective feedback-driven changes are deferred to the agent.

## Effective-dated calibration

Workouts reference symbolic targets such as `run_pace:E` and `run_pace:T`, not a physical calibration profile. Workout reads resolve the target against the profile effective on the workout's scheduled date and return both the pace guide and calibration profile identifier.

The first calibration applies from the plan start so every workout in the plan can resolve a guide. If the plan has not started, another calibration replaces the initial profile for the whole plan rather than creating unused history.

Once the plan has started, a new calibration always applies from “today” in the plan's IANA timezone. In one transaction the API:

1. Creates and persists the new calculated profile.
2. Ends the previously effective period at today's date.
3. Starts the new profile's period at today's date.
4. Leaves workout prescriptions unchanged.

The effective ranges are half-open. A workout on the boundary date uses the new profile. Same-day correction replaces the current draft profile rather than stacking multiple zero-length periods.

An older calibration can be selected with **Use again from today**. This creates a new effective period referencing the earlier profile already copied into the draft; it does not rewrite meaningful history. Calibration history is visible as a compact, read-only list of effective dates, source inputs, and calculated guides.

Absolute pace targets remain fixed. Only symbolic E/M/T/I/R targets resolve through the timeline.

## Temporary Phase 3 UI

Creating a plan collects a display name, start date, and end date, then atomically creates an incomplete draft. The user completes the remaining fields on a dedicated brief and calibration page.

The functional UI provides:

1. An editable brief form with explicit unknown answers and weekday availability.
2. Race-result or threshold-pace calibration entry.
3. Calculated E/M/T/I/R review with explanatory copy.
4. A completeness checklist, validation findings, warning acknowledgement, and separate confirmation action.
5. A read-only confirmed state with an explicit edit action.
6. Compact calibration history and **Use again from today**.
7. Workout pace rendering with its resolved calibration source.
8. A potentially-stale schedule warning after relevant brief changes.

The UI remains functional scaffolding for later conversation-driven creation. It does not introduce a wizard, autosave, calendar exceptions, subjective adjustment controls, or a full plan-content editor.

## API and authority boundary

The core API owns brief validation, confirmation, calibration calculation, effective-period changes, stale-schedule state, canonicalization, concurrency, and authorization. The browser only collects and presents values. The future agent uses the same domain operations and never calculates or writes zones directly.

All reads and mutations are owner-scoped and explicitly identify the draft or immutable revision. Draft mutations require the expected draft edit number. Retryable commands use the Phase 2 idempotency contract. No request accepts an athlete or owner identifier from the client.

Exact route schemas are defined in the Phase 3 schema contract. The required capabilities are:

- Read and replace the draft brief.
- Calculate and persist a race-result or threshold calibration.
- Confirm the brief after validation and warning acknowledgement.
- Read calibration history.
- Reapply a historical calibration from today.
- Return resolved calibration data with zone-based workout targets.

## Data reset and migration policy

All plan-domain data remains disposable test data until the alpha is declared tested and ready for release. Phase 3 may perform another direct plan-domain reset when it materially simplifies the schema. Athlete and external-identity rows must survive.

Atlas remains the sole migration owner and deployed migration files remain append-only. Railway receives no development fixture.

## Testing and fixture boundary

The Cardiff development fixture is rebuilt to contain:

- A complete confirmed brief.
- A running calibration with persisted E/M/T/I/R guides.
- A later effective calibration.
- Zone-referenced workouts before and on or after the effective boundary.
- At least one absolute pace target that remains unchanged.

Required verification covers calculator golden cases, unit conversion, confirmation invalidation, warning acknowledgement, double-run availability capacity, effective-date resolution, same-day replacement, reapplication from today, canonical hashing, cloning and restore, locked-content immutability, owner authorization, OpenAPI generation, and the functional browser journey.

Phase 3 is complete only after the migration, API, calculator, UI, and fixture pass local checks and the deployed Railway application passes authenticated smoke testing.

## Completion criteria

Phase 3 is complete when:

- A user can create an incomplete plan and progressively complete its running brief.
- The brief is plan-version-specific and requires no global profile.
- The accepted fields and explicit unknown states determine confirmation readiness.
- A race result or threshold pace creates persisted, versioned E/M/T/I/R guides.
- Calculated guides cannot be edited individually.
- Initial and subsequent calibration periods follow the agreed effective-date rules.
- Future zone-based workouts resolve through the newest applicable calibration without row-by-row rewrites.
- Calibration history and source attribution are visible.
- Relevant brief changes clear confirmation and flag existing schedules as potentially stale.
- New revisions cannot be locked without a current human-confirmed brief.
- Empty schedules remain lockable with acknowledgement.
- The future agent can use the same API surface without needing database access or duplicated calculation logic.
- The Cardiff fixture proves resolution on both sides of a calibration boundary.
- Local checks and authenticated Railway validation pass.
