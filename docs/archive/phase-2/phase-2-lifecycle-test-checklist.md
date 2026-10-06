# Phase 2: browser verification checklist

## Current-code reconciliation — 2026-10-06

- This is a completed Phase 2 walkthrough. Recorded tmux sessions, ports, labels and counts are not reusable environment guarantees.
- Current lock requires the structured brief/calibration confirmation added after Phase 2; the original date/header-only setup is insufficient. See current lifecycle/brief guides for prerequisites.
- Library detail now uses a workout list; lifecycle, source and activation labels are separate. Use the current development guide rather than historical server sessions.

The remaining content is the original historical record. Current procedures/contracts are indexed in [the documentation index](../../README.md).

> Historical delivery record. Status, pending checks and next-step recommendations describe the original checkpoint; see the [current handoff](../../current-handoff.md) for present priorities.

Implemented on `phase-2-plan-lifecycle`: private plan library, create, edit description/dates,
validation preview, warning acknowledgement, lock, unlock, and discard. This is a lifecycle
checkpoint, not the complete Phase 2 feature set. Organization, activation/deactivation,
archive/unarchive, explicit schedule selection, and version history/restore are also implemented.

## History and restore walkthrough

1. Open a plan with at least two locked versions. If needed, unlock, edit the description,
   save, validate, and lock to create a second version.
2. In **Version history**, open **Version 1**. Inspect its original description/dates,
   saved validation findings, automatic change summary, complete content, and schedule.
3. Click **Review restore as draft**. The preview should identify the older source and current
   locked version and explain that locking later replaces the current schedule.
4. Confirm restore. Back in plan details, the draft should contain Version 1's content while
   Version 2 stays locked. History should identify Version 1 as the draft's starting point.
5. Validate and lock the restored draft. This creates Version 3, based on Version 1 and
   replacing Version 2. All three remain inspectable; Versions 1 and 2 are unchanged.
6. Try restoring Version 1 again while its identical content is current: expect a no-change
   rejection, not another draft. Restoring the current version is also blocked.
7. Unlock and revisit history: restore must be blocked until the draft is locked or discarded.
8. Archive the plan: historical content remains inspectable, but restore is blocked until unarchive.

This slice does not reset local data or deploy Railway. `pnpm test:db` verifies full restored
workout cloning, preserved lineage, new physical IDs, retry safety, stale requests, authorization,
and ancestry; UI tests verify the preview and confirmation gates.

## Organization walkthrough

1. Open an existing locked plan and rename it. The version number and content stay unchanged.
2. Activate it. Open **Plan** in the sidebar (or **View schedule** in plan details).
3. Lock and activate a second plan. Both should be available in the **Active plan** selector;
   activating the second must not deactivate the first.
4. Unlock one plan, edit its description, and save. Open its schedule and switch **Content source**
   between locked and draft. The description/dates identify the chosen source even for empty schedules.
5. Refresh the schedule. Your selected plan/source should be remembered in this browser/account.
6. Archive an unlocked active plan after reviewing the confirmation. It leaves the main Plan
   selector and library, but appears under **View archive**. Saved draft and locked content remain.
7. Inspect its archived details: name and content are read-only. Unarchive after confirming;
   it returns to the library with its draft intact, but stays inactive until explicitly activated.
8. Archive an initial, never-locked draft. Activation must be unavailable, but archive should work.
9. In two tabs, rename a plan in one, then attempt an organizational change from stale details
   in the other. Expect a conflict and an explicit refresh, not silent overwriting.

No production deployment or additional local data reset was needed for this slice. The API and
web run in detached tmux sessions `askesis-phase2-api` and `askesis-phase2-web` so they survive
the agent turn ending. The main schedule supports active plans; version-history pages also
allow historical schedule inspection, including for archived plans.

## Open the app

Visit http://localhost:5173/plans and sign in with your existing account. If sign-in sends
you to the schedule page, choose **Plan library** in the sidebar.

The development database has been migrated with the agreed clean plan-data reset. Its
one legacy plan was removed; both athlete records and the existing external identity
were preserved. Old plan content was intentionally not backed up. Railway is unchanged.

To restart locally, run `docker compose up -d --wait postgres`, then run `pnpm dev:api`
and `pnpm dev:web` in separate terminals. Existing local environment files are required.

## Main walkthrough

1. Create a plan. Duplicate names are allowed; plans have separate IDs.
2. Click **Validate and review lock** before entering dates. Missing dates should block locking.
3. Enter a description and start/end dates, then **Save draft**.
4. Validate again. An empty plan is allowed for alpha but has warnings. Confirm locking
   is disabled until you acknowledge those warnings.
5. Lock it. The page should show **Locked · version 1**, with fields disabled.
6. Unlock, reviewing the confirmation first. The locked version remains preserved.
7. Validate without changing anything. No new version should be allowed.
8. Edit and save the description, validate, and lock. You should now see **version 2**.
9. Unlock again, change the description, and discard after reviewing the confirmation.
   The page should return to version 2, without your discarded draft changes.

## Safety checks

- Change a field after validation: the old lock preview must disappear until you save and validate again.
- Edit in two tabs. Save in the first, then save the stale draft in the second. The second
  should show a conflict without silently overwriting the first. Copy any unsaved text
  before choosing **Refresh latest plan**.
- Navigate back to the library with unsaved edits: choose whether to keep editing or leave.
- Refresh a locked plan: its version and saved values should survive.

## Automated verification and remaining scope

`pnpm check` covers formatting, lint, types, unit/UI tests, builds, generated API drift,
migration checksums and dependency audit. `pnpm test:db` exercises the real PostgreSQL
lifecycle, stale confirmations, warning gates, duplicate-request serialization, immutable
history, and complete cloning of the populated 10-workout fixture.
The database suite also passes with `TZ=Europe/London`; PostgreSQL calendar dates remain
date strings rather than being shifted through UTC instants ([driver date behavior](https://node-postgres.com/features/types)).

The browser automation tab reaches sign-in, but its snapshot/evaluation calls timed out;
the authenticated visual walkthrough still needs human verification.

Next slices: fuller structural/order validators,
fixture publication, and Railway cutover. No workout or
calibration editing UI or agent mutations are included in this checkpoint.

The new screen uses the query/mutation/invalidation pattern from the
[official TanStack Query guide](https://tanstack.com/query/latest/docs/framework/react/quick-start).
Query caches are isolated by signed-in account; failed commands are not automatically retried.
