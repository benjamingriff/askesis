# Phase 3 implementation plan

## Status

**Accepted locally and deployed to Railway.** This document records the design checkpoint for the accepted [Phase 3 brief and calibration refinement](./phase-3-plan-brief-and-calibration-refinement.md). See the [walkthrough and implementation notes](./phase-3-test-checklist.md) for the running instance, verification, and final storage details. Remaining visual polish is deferred to the alpha review.

## Delivery strategy

- Begin after the Phase 2 lifecycle branch has landed and its final API/schema shapes are known.
- Develop Phase 3 on one integration branch with reviewable commits.
- Permit a destructive reset of plan-domain test data while preserving athletes and external identities.
- Keep the calculator authoritative in the core API; the web and future agent never implement formulas independently.
- Deliver the structured editor as temporary scaffolding for the later conversational flow.
- Treat authenticated Railway deployment and smoke testing as part of completion.

## Architecture

Phase 3 remains within the established boundaries:

```text
React brief and workout UI
            ↓
generated OpenAPI client
            ↓
Hono plan routes
            ↓
brief and calibration service
       ↙             ↘
pure calculator     Kysely repositories
                          ↓
                     PostgreSQL
```

- PostgreSQL stores canonical inputs, persisted calculated outputs, effective periods, and confirmation metadata.
- Pure TypeScript owns calculation, unit conversion, validation, canonical confirmation hashing, and display formatting.
- The service owns human confirmation, plan-local date selection, period replacement, stale-schedule state, concurrency, and transactions.
- Repositories own version-scoped reads and writes.
- Workout reads resolve stored symbolic zones through the owning version's timeline.
- The generated client is the only browser API contract.
- No chat tables, model SDK, worker service, event stream, global athlete profile, or new infrastructure is introduced.

## Implementation sequence

### Stage 1: calculator specification and executable golden cases

Before schema work fixes output assumptions, write a short versioned calculator specification for `run-pace-v1`:

- Record the published Daniels-Gilbert race-performance equations and units used.
- Define how a race result yields the internal fitness scalar.
- Define how a threshold-pace input yields the same calculation basis.
- Define E/M/T/I/R targets and proportional faster/slower bounds.
- Define supported numerical domains, error handling, precision, and display rounding.
- Record why slower guides have wider ranges and faster guides narrower ranges.
- Use neutral Askesis product language and avoid an official-compatibility claim.

Use Daniels and Gilbert's published [Oxygen Power](https://www.vivamarathon.com/oxygenpower.pdf) as the race-performance source and the official [V.O2 running calculator](https://vdoto2.com/calculator/) only for manual comparison. Record the exact edition, equations, coefficients, and interpretation in the versioned specification so implementation does not depend on an unrecorded web result.

Create golden cases covering at least:

- One-mile, 5K, 10K, half-marathon, marathon, and custom race inputs.
- Threshold inputs in kilometres and miles.
- Representative slow, middle, and fast runners.
- Boundary distances and invalid durations.
- Unit round trips and stable serialized values.

Compare representative race-derived outputs manually with the official V.O2 calculator and record expected tolerances. Tests use checked-in expected values and never call an external service.

This stage is a review checkpoint. If the published equations cannot reproduce defensible E/M/T/I/R guidance without copying proprietary tables or relying on an undocumented service, retain the accepted input/output contract but replace the coefficient derivation with a separately reviewed, documented Askesis approximation before proceeding.

### Stage 2: destructive schema cutover and fixture

Create one append-only Atlas migration that:

- Preserves `athletes` and `athlete_identities`.
- Resets plans, plan versions, workout content, calibrations, and fixture markers.
- Removes typed goals and generic constraints.
- Adds the one-to-one brief and weekday tables.
- Reshapes calibration profiles around race-result and threshold-pace inputs.
- Stores persisted E/M/T/I/R target and bound values.
- Retains version-owned, non-overlapping calibration periods.
- Adds brief confirmation and schedule-review metadata.
- Extends the shared draft/locked immutability protection to every new table.
- Recreates affected views, indexes, same-version foreign keys, and checks.
- Advances content-schema, canonical-hash, readiness-migration, and Atlas checksum state.

Then:

- Apply the entire migration history to an empty local database.
- Apply it to a representative Phase 2 database and prove athlete identities survive while plan test data is reset.
- Regenerate Kysely database types.
- Rebuild the Cardiff fixture with a confirmed brief, two effective calibrations, symbolic zone workouts on both sides of the boundary, and an absolute target.
- Keep Railway unseeded.

### Stage 3: pure domain behavior

Implement API-local pure modules for:

- Canonical distance, duration, speed, and pace conversion.
- IANA timezone validation and plan-local date calculation.
- `run-pace-v1` calculation and stored-output formatting.
- Brief and weekday schemas with explicit unanswered, unknown, and known states.
- Brief completeness validation, errors, warnings, and stable finding codes.
- Confirmation projection, normalization, and SHA-256 hashing.
- Semantic comparison and confirmation invalidation.
- Calibration-history and affected-workout summaries.

Extend the Phase 2 complete aggregate canonicalizer and lock validator:

- Replace typed goals and constraints with the brief.
- Include raw calibration inputs, calculator version, outputs, and effective periods.
- Require current human brief confirmation before a new lock.
- Preserve the empty-schedule warning.
- Add the potentially-stale schedule warning.

Pure tests should exhaust shape alternatives and boundary behavior. Property-style tests are appropriate for unit round trips, monotonic race calculations, zone ordering, canonical stability, and non-negative proportional bands.

### Stage 4: repositories, services, and API

Add version-scoped repositories for:

- Scalar brief and all weekday answers.
- Calibration profiles and their five zone rows.
- Effective-period lookup and replacement.
- Current and historical calibration reads.
- Workouts affected on or after a calibration boundary.

Implement service transactions for:

1. Whole-form brief replacement.
2. Initial calibration creation from plan start.
3. Pre-start calibration replacement.
4. Same-day draft correction.
5. Mid-plan calibration insertion from today.
6. Reusing an earlier calibration from today.
7. Brief validation and human confirmation.

Every mutation:

- Resolves ownership from authentication.
- Requires an unarchived editable draft and expected edit number.
- Normalizes before semantic comparison.
- Increments the draft edit number once for a real content change.
- Clears confirmation only when confirmation-relevant semantics change.
- Applies the stale-schedule rule without deleting workouts.
- Uses the Phase 2 idempotency pattern where retry can duplicate an operation.

Extend plan creation so the Phase 3 web flow can submit display name, start date, and end date together while still creating the logical plan and initial draft atomically. Keep the domain capable of representing an incomplete draft for later conversational creation and interrupted edits.

Add the agreed routes:

```http
GET  /api/v1/plans/:planId/draft/brief
PUT  /api/v1/plans/:planId/draft/brief
POST /api/v1/plans/:planId/draft/brief/validate
POST /api/v1/plans/:planId/draft/brief/confirm

GET  /api/v1/plans/:planId/draft/calibrations
POST /api/v1/plans/:planId/draft/calibrations
POST /api/v1/plans/:planId/draft/calibrations/:calibrationId/use-again
```

Update aggregate draft and revision reads to include brief, confirmation, calibration history, and schedule-review state. Update workout responses with resolved canonical and formatted pace ranges plus calibration provenance.

Register routes, update OpenAPI, regenerate the client, and keep generated-artifact checks green in the same stage.

### Stage 5: functional web UI

Extend the Phase 2 TanStack Query layer with explicit queries and mutations for brief and calibration resources. Use authoritative invalidation and refetch after writes; do not add event subscriptions or optimistic content edits.

Update plan creation to collect:

- Display name.
- Start date.
- End date.

Build the dedicated draft brief experience:

- One explicit-save form for goal, unit, timezone, baseline, desired frequency, seven weekdays, and context.
- Browser-timezone suggestion without silently overwriting a stored choice.
- Clear controls for known, unknown, and unanswered baseline values.
- Race presets plus custom distance and finish duration.
- Alternative single threshold-pace entry.
- Calculation results showing E/M/T/I/R targets, proportional ranges, and concise purpose/effort descriptions.
- Completeness checklist and inline structural validation.
- Separate validation review, warning acknowledgement, and **Confirm brief** action.
- Read-only confirmed state and **Edit brief** action.
- Compact calibration history and **Use again from today**.
- Future-workout change and potentially-stale schedule notices.

Update workout presentation to show:

- Symbolic zone name.
- Resolved target and range in the plan unit.
- Calibration method and effective date.
- A clear incomplete-draft state if a symbolic target cannot resolve.

Locked revision views show the immutable brief and calibration history without edit actions. Keep visual work consistent with the current application; full product polish remains deferred.

### Stage 6: verification and Railway deployment

Run the lightweight suite:

```bash
pnpm check
```

Run local PostgreSQL and full-stack verification:

```bash
pnpm test:db
pnpm smoke
```

Before merge:

- Rehearse the Phase 3 reset from the final Phase 2 schema.
- Verify athlete identities survive and plan data is reset.
- Seed and reset the Cardiff fixture repeatedly.
- Exercise incomplete, warned, confirmed, edited, stale-schedule, locked, unlocked, and restored states.
- Verify an initial, pre-start replacement, same-day correction, mid-plan update, and historical reapplication.
- Confirm workouts resolve the expected profile on both sides of a date boundary.
- Confirm absolute targets remain fixed.
- Confirm locked content rejects mutation in PostgreSQL as well as the API.
- Confirm another owner cannot discover brief, calibration, or workout data.
- Review logs and Sentry payloads to ensure free-text context and calibration inputs are not emitted.

For Railway:

1. Merge the complete Phase 3 branch to `main` after local checks pass.
2. Let the Atlas pre-deploy command perform the reset migration.
3. Verify readiness reports the Phase 3 migration.
4. Create a fresh plan through the public authenticated web application.
5. Complete, validate, and confirm its brief using both calibration methods across separate drafts.
6. Inspect calculated guides and a zone-resolved workout through the public web origin.
7. Verify timezone-derived “today” behavior in the hosted API.
8. Confirm Railway contains no development fixture.
9. Inspect API/web logs and Sentry, then record results in the handoff.

## Test matrix

### Lightweight CI tests

- Brief request and response schema parsing.
- Explicit unanswered, unknown, known, and zero-value behavior.
- Weekday completeness and double-run capacity.
- Race and threshold input discrimination.
- Calculator golden values, numerical domains, monotonicity, and output ordering.
- Unit conversion and formatting.
- IANA timezone validation and local-date boundary tests with a fixed clock.
- Brief validation codes, warnings, and acknowledgement.
- Confirmation projection and hash stability.
- Confirmation invalidation and unit-only preservation.
- Potentially-stale schedule state.
- Route-to-service behavior and stable error envelopes.
- Query invalidation and all functional UI states.
- Generated OpenAPI/client consistency.

### Local PostgreSQL tests

- Clean migration and destructive Phase 2-to-3 cutover.
- Athlete and identity preservation.
- Brief ownership and weekday uniqueness.
- Calibration input-shape and five-zone completeness.
- Same-version profile, zone, period, and workout references.
- Effective-period non-overlap and boundary resolution.
- Initial, pre-start, same-day, today, and reapplication transactions.
- Concurrent draft edit and idempotency conflicts.
- Complete unlock and restore cloning with physical-ID remapping and lineage retention.
- Canonical content equality and lock validation.
- Locked brief and calibration immutability triggers.
- Hidden owner authorization.
- Fixture workouts resolving different profiles across the boundary.

### Browser smoke journey

1. Create a plan with name and dates.
2. Save a partial brief and return to it.
3. Complete unknown and known baseline answers and recurring availability.
4. Create a race-result calibration and inspect E/M/T/I/R explanations.
5. Review and acknowledge a warning, then confirm the brief.
6. Edit a material field and observe confirmation clear.
7. Reconfirm and lock an empty schedule after its warning.
8. Unlock, add a new calibration, and inspect future-workout changes.
9. Use an earlier calibration again from today.
10. Inspect immutable history and calibration provenance on a workout.

## Commit and review shape

Suggested reviewable commits:

1. Accept Phase 3 refinement, schema contract, and implementation plan.
2. Specify `run-pace-v1` and add executable golden calculator tests.
3. Add the destructive schema migration, database types, and Cardiff fixture rewrite.
4. Add brief schemas, validation, confirmation hashing, and aggregate integration.
5. Add calibration calculation, repositories, transactions, and database tests.
6. Add brief/calibration routes, workout resolution, OpenAPI, and generated client.
7. Add the temporary brief, confirmation, history, and workout UI.
8. Complete local verification, Railway deployment, and handoff updates.

Intermediate commits on the feature branch need not preserve Phase 2 application compatibility. The final branch must pass the full agreed checks.

## Review checkpoint

Before Phase 3 implementation begins, review and approve:

- The accepted refinement contract.
- The one-to-one brief and weekday representation.
- Removal of typed goals and generic constraints.
- Race-result and threshold-only calibration inputs.
- Persisted, versioned E/M/T/I/R outputs.
- Effective-from-today behavior and same-day replacement.
- Human confirmation and lock prerequisite.
- Workout zone resolution and stale-schedule warning.
- The destructive test-data reset.
- The six implementation stages and Railway completion gate.
