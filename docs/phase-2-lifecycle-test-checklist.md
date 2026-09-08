# Phase 2: first browser-testable slice

Implemented on `phase-2-plan-lifecycle`: private plan library, create, edit description/dates,
validation preview, warning acknowledgement, lock, unlock, and discard. This is a lifecycle
checkpoint, not the complete Phase 2 feature set.

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

Next slices: rename/activation/archive, history/restore, fuller structural/order validators,
schedule/version navigation, fixture publication, and Railway cutover. No workout or
calibration editing UI or agent mutations are included in this checkpoint.

The new screen uses the query/mutation/invalidation pattern from the
[official TanStack Query guide](https://tanstack.com/query/latest/docs/framework/react/quick-start).
Query caches are isolated by signed-in account; failed commands are not automatically retried.
