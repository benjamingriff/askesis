# Phase 3 walkthrough

## Current-code reconciliation — 2026-10-06

- The final implementation notes accurately distinguish many original proposals from delivered behavior. Local ports/tmux sessions and recorded outcomes remain checkpoint evidence.
- Real worker and conversational brief collection now coexist with the structured editor. Current calibration includes estimate provenance, schedule coverage and later live refresh.
- Use current setup commands and the current schema/API contract when repeating this walkthrough; do not infer an official-calculator comparison from deterministic local checks.

The remaining content is the original historical record. Current procedures/contracts are indexed in [the documentation index](../../README.md).

> Historical delivery record. Status, pending checks and next-step recommendations describe the original checkpoint; see the [current handoff](../../current-handoff.md) for present priorities.

Deployed to Railway on 2026-09-10 after the local user walkthrough. Open <https://askesis.up.railway.app/plans> and sign in using your existing account. The migration resets disposable plans while preserving accounts. The separate local instance remains at <http://localhost:5174/plans>.

## Try the complete flow

1. Create a plan with dates spanning today. Enter a free-text goal, training background (or explicitly choose Unknown), desired runs, recurring weekdays, and any context. Save changes.
2. Enter a recent 5K and finish time, for example `25:00`. Calculate and save. Check the Easy, Marathon, Threshold, Interval, and Repetition guides.
3. Review and confirm the brief. Return to plan details, validate and review the lock, acknowledge the empty-plan warning, then lock. Workout generation is a later phase, so a new plan has no workouts yet.
4. Unlock the plan. Edit the brief and change only its units to miles. Save: distances and paces should convert, and confirmation should remain valid.
5. Change the goal or availability and save: confirmation should clear. Enter an estimated threshold pace in the displayed units. Confirm again and lock a new version.
6. Open version history and follow **View this version’s brief and pace guides**. The earlier version should retain its original inputs and guides.
7. Change a saved field and navigate away before saving. Check the leave-without-saving prompt.

## Calibration dates

The first calibration covers the plan from its start. Later updates apply from today in the plan timezone. Updating again on the same day replaces that day’s entry. A future-starting plan replaces its initial calibration until it begins. Older entries offer **Use again** when there is actual history; this applies that fitness from today without rewriting previous dates. Seeing a second history period requires a calibration originally entered on an earlier day. Database tests exercise these date boundaries without waiting overnight.

## Verification and limits

- API unit tests, web tests, PostgreSQL integration tests, identity-preserving migration rehearsal, generated contracts, production builds, and disposable container smoke pass.
- Browser automation could not open the local preview. Signed-in interaction remains the user acceptance check.
- Pace calculation is a versioned Daniels-based approximation, documented in [run-pace-v1.md](../../product/run-pace-v1.md), not an exact reproduction of a proprietary calculator.
- Calendar generation, conversational editing, and heart-rate targets remain outside Phase 3.

## Local processes

Detached tmux sessions: `askesis-phase3-api` (3001) and `askesis-phase3-web` (5174). Database: `askesis_phase3` in the development PostgreSQL container. Logs: `/tmp/askesis-phase3-api.log` and `/tmp/askesis-phase3-web.log`. API readiness is <http://localhost:3001/api/ready>. These are local processes, so a machine restart stops them.

## Implementation notes

The final SQL retains Phase 2 physical IDs and lineage on brief rows to reuse aggregate cloning. `plan_version_id` is unique on the scalar brief. Confirmation metadata lives on that brief. Calibration zones retain generic numeric columns with SQL checks restricting them to the five running pace guides; descriptive zone keys are consistent across storage and API. API distances and input paces are canonical metres and seconds/km; the web converts user input and display units. Saved generated guides are not recalculated on reads.

The schema contract and implementation plan capture the design checkpoint; these implementation notes record the concrete naming and storage differences. The new migration resets disposable plan data and preserves athletes and external identities. Do not seed Railway when deploying it.
