# Plan deletion, account deletion and data retention

**Status:** proposal, 2026-10-19. Owner decisions are recorded below. This supersedes the alpha constraint "no user-facing permanent deletion" in the [current handoff](../current-handoff.md).

## Why

Askesis stores personal data and health data. Chats mention injuries, illness and races; `athlete_check_ins` records `ill` and `pain`; workout logs record effort and how a session felt. UK GDPR expects storage limitation and erasure on request (without undue delay, within one month). Health data is special category data. Clearing the owner of a plan does not anonymise free-text chats, so "unlinking" a deleted plan would keep all the obligations and break the athlete's expectation. Deletion therefore means removing the rows. Anonymous aggregates without identifiers or free text may be kept.

## Owner decisions

- Deleting a plan removes its versions and content, its conversations (with runs and coaching telemetry), and its training log and check-ins.
- A deleted plan can be restored for **30 days**, then it is purged.
- Account deletion takes effect after a **7-day** grace period, during which the athlete can cancel. The account is then purged.
- Inactive accounts are not deleted automatically.
- An opt-in evaluation set of real chats is wanted later. It is out of scope here, but the purge must make adding it straightforward.

## Current state (evidence)

- Archive is the reversible "hide": archived plans are read-only (`guard_plan_version`, `guard_plan_content`, `guard_archived_plan`) and excluded from the library.
- Nothing can delete history today. Triggers reject deletes on chat messages, run events, receipts, finishes, progress batches, tool changes and visible outputs (`protect_chat_history`, `protect_live_output`); `protect_agent_run` rejects run deletion; calibrations and zones are append-only; locked versions and their content are immutable. `conversation_messages.producing_run_id` and `agent_runs.user_message_id` reference each other.
- Clerk users become athletes lazily on first request (`ensureAthlete`). There is no Clerk webhook and no account-removal command (`railway-deployment-plan.md`).
- `api_idempotency_keys` store full command responses (plan names, dates) with no pruning.
- Evaluation (`apps/bench`, `apps/evals`) uses simulated athletes only; no production chat leaves the database.

## Design

### Plan deletion (soft delete, purge after 30 days)

A deleted plan is a sub-state of an archived plan: `plans.deleted_at` with `CHECK (deleted_at IS NULL OR archived_at IS NOT NULL)`. Every existing archived-plan guard keeps it read-only, and every surface that already hides archived plans hides deleted ones too.

- `POST /api/v1/plans/{planId}/delete` (`expectedStateVersion`) requires an idle plan (`assertPlanIdle`), archives it if needed, deactivates it and sets `deleted_at`.
- `POST /api/v1/plans/{planId}/undelete` clears `deleted_at` within the window. The plan returns to Archived, so the athlete unarchives it deliberately.
- `GET /api/v1/plans/{planId}/deletion-impact` returns counts for the confirmation dialog: locked versions, conversations, messages, logged sessions and check-ins.
- `GET /api/v1/plans?collection=deleted` lists recently deleted plans with `deletedAt` and `purgeAfter`.
- `guard_archived_plan` is replaced so an archived plan may change `deleted_at`, `state_version` and `updated_at`; every other archived-plan rule is unchanged.
- Reads hide deleted plans at each ownership choke point: plan, brief, chat (`ownedPlan`, `ownedConversation`, the conversation list), training log (per-plan and all-plan reads), and workout/block reads. Conversations of a deleted plan return 404 and leave every list.

### Account deletion (7-day grace)

`athletes.deletion_requested_at` and `athletes.purge_after` (both set or both null), plus `purge_started_at`.

- `GET /api/v1/account` returns the deletion state. `POST /api/v1/account/deletion` cancels or requests cancellation of active runs, then sets `purge_after = now + 7 days`. `DELETE /api/v1/account/deletion` cancels while `purge_started_at` is null.
- While deletion is pending, authentication still succeeds, but every `/api/v1` route except the account routes returns `403 ACCOUNT_DELETION_PENDING`. The web app shows a blocking screen with the deletion date, **Cancel deletion**, **Download my data** and **Sign out**.
- Purge order: claim the athlete (`purge_started_at`, after which cancellation is refused), delete the Clerk user(s) (404 counts as done), then purge the database in one transaction. Deleting Clerk first prevents lazy provisioning from re-creating the athlete in between.
- Clerk users are deleted only when `NODE_ENV=production`. Local development shares one Clerk verification user across worktrees, so a local purge removes only database data and the next sign-in provisions an empty account.
- `POST /api/webhooks/clerk` (Svix-verified with `verifyWebhook`, enabled only when `CLERK_WEBHOOK_SIGNING_SECRET` is set) handles `user.deleted` by scheduling an immediate purge. This covers deletion from the Clerk dashboard.

### Purge path through the immutability guards

One module, `apps/api/src/modules/account/purge.ts`, owns all hard deletion. It runs `set_config('askesis.purge', 'on', true)` (transaction-local). A new SQL function `askesis_purging()` reads that setting. The blocking guards allow `DELETE` only while it is on. The calibration guard additionally permits clearing `recorded_by_run_id`/`retracted_by_run_id` while it is on, because a plan's runs may have recorded athlete-owned calibrations that survive the plan. The live-journal triggers skip while it is on. No other code sets the flag, and normal paths stay immutable.

Plan purge, in dependency order: clear surviving references to the plan's runs (calibrations, logs) → tool changes, receipts, events, outputs, progress batches, measurements and finishes → messages and runs in one statement (they reference each other) → conversations → workout logs and check-ins → example edition → version content → versions → the plan → live events naming the plan, conversations or runs.

Account purge: every plan via the plan purge, then plan-less conversations, calibrations and zones, idempotency keys, live journal, identities and the athlete row.

Before deleting runs, the purge adds their usage into `agent_usage_rollups(day, provider, model, prompt_version, status)` (runs, input/output tokens, tool calls). That table holds no identifiers or text and is kept indefinitely. A `data_deletions` ledger records each purged athlete id, request time and purge time, so a backup restore can re-apply deletions. The id is a random UUID with nothing left to join to.

### Retention job

A retention sweeper runs in every execution mode, every 15 minutes, with `FOR UPDATE SKIP LOCKED` claims. It:

1. Purges plans with `deleted_at` older than 30 days.
2. Purges accounts whose `purge_after` has passed.
3. Prunes idempotency records older than 7 days.

`pnpm --filter @askesis/api retention:run [--as-of <ISO time>]` runs one pass on demand. `--as-of` is refused in production; it lets local testing fast-forward.

### Data export

`GET /api/v1/account/export` returns a JSON download: profile, every plan (each version's header and semantic content, brief), conversations with messages, training log, check-ins and calibration history. It is available during the grace period.

### Web

- Plan options menu: **Delete plan…** (danger). The dialog shows the impact counts and the 30-day restore window.
- Plans gains a **Recently deleted** collection beside Library and Archived. Each card shows its purge date and **Restore**.
- You → **Your data**: **Download my data** and **Delete account…**. The account dialog explains what is removed and the 7-day window, and requires typing `DELETE`.

### Opt-in evaluation set later

Adding the eval set later needs no change to this design:

- **Consent:** a future `athlete_consents(athlete_id, purpose, text_version, granted_at, withdrawn_at)` table.
- **Samples:** an `eval_samples` store copied at consent time, keyed by athlete and source conversation.
- **Purge:** both tables reference `athletes`, so adding them is one ordered step in `purge.ts`. Withdrawal deletes the athlete's samples.
- **Safety net:** the completeness test below fails until the new tables are purged.

### Completeness test

A database test snapshots row counts for every table in the public schema, creates an athlete with plans, versions, chats, runs, receipts, logs, check-ins, calibrations and idempotency records, then purges it. Counts must return to the snapshot, except the rollup and ledger tables. A second variant does the same for one plan while the athlete's other data survives. New owner-scoped tables fail this test until the purge handles them.

## Retention policy

| Data                                  | Retention                                                          |
| ------------------------------------- | ------------------------------------------------------------------ |
| Plans, chats, logs, calibrations      | While the account exists; archived plans until the athlete deletes |
| Deleted plan                          | 30 days restorable, then purged                                    |
| Account after deletion request        | 7 days, then purged; backups roll off within their window          |
| Inactive accounts                     | Kept (no automatic deletion for now)                               |
| Idempotency records                   | 7 days                                                             |
| Live journal                          | 7 days (existing pruning)                                          |
| Usage rollups, deletion ledger        | Indefinitely (no personal data)                                    |
| Server logs, Sentry, database backups | Operator-configured; target 30–90 days, backups ≤30 days           |

## Out of scope

- The opt-in eval set itself.
- A public privacy notice and explicit health-data consent at sign-up. Both need legal review and are recorded as release checks.
- Pruning run telemetry while keeping transcripts.
- The mobile prototype.

## Validation

- Database tests: plan and account completeness, restore within the window, purge after it, the grace-period block and cancellation, Clerk deletion before the database purge (with a fake client), webhook signature rejection and acceptance, idempotency pruning, hidden deleted plans on every read path, and immutability still enforced without the purge flag.
- `pnpm check`, `pnpm test:db`, `pnpm migrations:check`, `pnpm generate:check`.
- Browser walkthrough with the verification account: delete and restore a plan; purge it with `retention:run --as-of`; request, cancel and re-request account deletion; download the export; purge with `--as-of`, then sign in again to an empty account.
