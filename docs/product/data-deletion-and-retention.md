# Plan deletion, account deletion and data retention

**Status:** proposal revision 4, 2026-10-19 (review findings F1–F8 addressed below; revision 4 adds the F6 journal checkpoint after the final proposal round). Owner decisions are recorded below. This supersedes the alpha constraint "no user-facing permanent deletion" in the [current handoff](../current-handoff.md).

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
- `POST /api/v1/plans/{planId}/undelete` clears `deleted_at` while the window is open, checked under the plan lock. From `deleted_at + 30 days` it answers 404 even if the purge has not run, and the plan leaves Recently deleted (F8). A restored plan returns to Archived, so the athlete unarchives it deliberately.
- `GET /api/v1/plans/{planId}/deletion-impact` returns counts for the confirmation dialog: locked versions, conversations, messages, logged sessions and check-ins.
- `GET /api/v1/plans?collection=deleted` lists recently deleted plans with `deletedAt` and `purgeAfter`.
- `guard_archived_plan` is replaced so an archived plan may change `deleted_at`, `state_version` and `updated_at`; every other archived-plan rule is unchanged.
- Reads hide deleted plans at each ownership choke point: plan, brief, chat (`ownedPlan`, `ownedConversation`, the conversation list), runs (`ownedRun` checks its conversation on both the locking and non-locking paths, covering run, events, output and turn reads), training log (per-plan and all-plan reads), and workout/block reads. Conversations of a deleted plan return 404 and leave every list. (F1)
- **Idempotent replays (F2).** `api_idempotency_keys.plan_id` (FK to `plans`) records the plan a cached response belongs to: the plan itself for plan commands, the brief's and log's plan, and the conversation's plan for chat commands. Before replaying, each wrapper re-checks visibility (not editability): plan commands, briefs and logs through the plan, chat through `ownedConversation`. The plan purge also deletes any of the athlete's cached responses that still name the plan, its versions, conversations or runs, such as fitness timelines or records cached before `plan_id` existed. A retry after deletion gets 404 without re-executing; after a restore it replays the original response. The plan purge deletes the plan's records.

### Account deletion (7-day grace)

`athletes.deletion_requested_at` and `athletes.purge_after` (both set or both null), plus `purge_started_at`.

- `GET /api/v1/account` returns the deletion state. `POST /api/v1/account/deletion` sets `purge_after = now + 7 days` and stops coaching. `DELETE /api/v1/account/deletion` cancels while `purge_started_at` is null.
- **Fence (F4).** One rule: no transaction holds the athlete row lock while waiting for a run, because coaching tools lock their run first and the athlete later (recording a calibration). A deletion request and the Clerk webhook both commit the marker first, with only a `NO KEY UPDATE` athlete lock (plus the journal head; the weaker lock still excludes run acceptance's share lock but not a concurrent plan deletion's commit-time foreign-key check, so the journal head cannot invert with it), and then cancel active runs in a second transaction that locks runs only. Once the marker commits, run acceptance refuses: it share-locks the athlete just before inserting a run. A worker claim cancels a queued run of a pending account, and worker tool, context and heartbeat calls are rejected; only cancellation and finish work. So the second step sees every run that will exist. If a process stops between the two steps, the next retention pass cancels the leftovers. The account purge locks the athlete's plans, conversations, runs and then the athlete, the order worker calls and plan purges use. A restored run whose plan is deleted is cancelled by the next claim instead of blocking the queue, expiry locks runs directly, and replaying `plan.deleted` ends the plan's restored coaching. Barrier-controlled tests hold a run lock in a tool-like transaction, start a deletion request or webhook, and only then take the athlete lock; both complete.
- Purge order: commit a claim (`purge_started_at`, after which cancellation is refused), delete the Clerk user(s) (404 counts as done), then purge the database in one transaction. Deleting Clerk first prevents lazy provisioning from re-creating the athlete in between. A failure after the claim leaves the account claimed and pending. The next pass retries it: Clerk deletion is idempotent, and the database purge re-checks the athlete under its row lock. A session token that outlives a purged Clerk user gets 401, not a re-provisioned account.
- Clerk users are deleted only when `NODE_ENV=production`. Local development shares one Clerk verification user across worktrees, so a local purge removes only database data and the next sign-in provisions an empty account.
- `POST /api/webhooks/clerk` (Svix-verified with `verifyWebhook`, enabled only when `CLERK_WEBHOOK_SIGNING_SECRET` is set) handles `user.deleted` by scheduling an immediate purge. This covers deletion from the Clerk dashboard.

### Purge path through the immutability guards

One module, `apps/api/src/modules/account/purge.ts`, owns all hard deletion. It runs `set_config('askesis.purge', 'on', true)` (transaction-local). A new SQL function `askesis_purging()` reads that setting. The blocking guards allow `DELETE` only while it is on. The calibration guard additionally permits clearing `recorded_by_run_id`/`retracted_by_run_id` while it is on, because a plan's runs may have recorded athlete-owned calibrations that survive the plan. The live-journal triggers skip while it is on. No other code sets the flag, and normal paths stay immutable.

Plan purge, in dependency order: usage rollup → clear surviving references to the plan's runs (calibrations, logs) → tool changes, receipts, events, outputs, progress batches, measurements and finishes → messages and runs in one statement (they reference each other) → conversations (all runs of every conversation bound to the plan, including runs created before binding) → workout logs and check-ins → example edition → idempotency records → redaction of other conversations' tool results → version content → versions → the plan → live events naming the plan, conversations or runs.

**Copies in other conversations (F5).** `read_training_log` and `record_workout_log` read and write across plans. Their full responses persist in `agent_tool_receipts.response`, so a run in plan B or a standalone chat can hold plan A's logs and check-ins. Receipts are replayed only within their own run. The purge therefore replaces the response of any of the athlete's surviving receipts that names the plan, its conversations or its runs with `{"redacted": …}`. `protect_chat_history` allows exactly this update, of `response` only, while purging. Message references cannot cross plans (`feedbackReferences` requires the conversation's plan). Free text the coach wrote is out of scope.

Account purge: every plan via the plan purge, then plan-less conversations, calibrations and zones, idempotency keys, live journal, identities and the athlete row.

In the same transaction as the deletion, the purge adds the runs' usage into `agent_usage_rollups(day, provider, model, prompt_version, status)` (runs, input/output tokens, tool calls). A retried purge finds no runs, so it cannot double-count. That table holds no identifiers or text and is kept indefinitely.

**Backups (F6).** A restored backup predates later deletions, and so does its own copy of any ledger. The design therefore has three parts:

- **Durable capture.** Every transition (`plan.deleted`, `plan.restored`, `plan.purged`, `account.deletion_requested`, `account.purge_due` when the webhook brings the deadline forward, `account.deletion_cancelled`, `account.purged`) is appended to `deletion_journal` in the transaction that makes it.
- **Ordering and completeness.** Sequences come from a single head row (`deletion_journal_head`), the pattern `live_event_heads` uses. They are therefore gapless and follow commit order, including per subject, since callers already hold the subject's lock.
- **Independent persistence.** Entries are shipped to the API logs, which are kept apart from the database: right after commit, and again by every retention pass for anything unshipped (crash recovery, at least once). Shipping uses its own logger level, so only `LOG_LEVEL=silent` suppresses it.

`retention:replay` reads the shipped lines in any order and deduplicates them by sequence, skipping entries at or below the restored head. **Completeness checkpoint:** every retention pass also logs the highest sequence up to which every entry has been shipped. The replay requires the entries after the restored head to run without gaps up to the journal's end. That end is `--through` when the operator can read the damaged database's head, otherwise the latest logged checkpoint. A missing interior entry, a truncated tail, or an export with no checkpoint (including an empty one) refuses before changing anything; `--allow-gaps` accepts a known loss. Each entry is then applied in sequence, committing with its journal row, so the journal continues and an interrupted replay can be repeated. Remaining exposure: entries committed after the last checkpoint and never shipped, when the damaged database is unreadable.

### Retention job

A retention sweeper runs in every execution mode, every 15 minutes, with `FOR UPDATE SKIP LOCKED` claims. It:

1. Purges plans with `deleted_at` older than 30 days.
2. Purges accounts whose `purge_after` has passed.
3. Prunes idempotency records older than 7 days.
4. Prunes live-journal events older than 7 days. The journal trigger only prunes busy accounts. (F7)

`pnpm --filter @askesis/api retention:run [--as-of <ISO time>]` runs one pass on demand. `--as-of` is refused in production; it lets local testing fast-forward.

### Data export

`GET /api/v1/account/export` returns a JSON download: profile, every plan (each version's header and semantic content, brief), conversations with messages (including the feedback snapshots they carried, and for each athlete message its coaching run's status and any visible text beyond the final reply, such as a stopped reply), training log, check-ins and calibration history. It is available during the grace period.

### Web

- Plan options menu: **Delete plan…** (danger). The dialog shows the impact counts and the 30-day restore window.
- Plans gains a **Recently deleted** collection beside Library and Archived. Each card shows its purge date and **Restore**.
- You → **Your data**: **Download my data** and **Delete account…**. The account dialog explains what is removed and the 7-day window, and requires typing `DELETE`.

### Opt-in evaluation set later

Adding the eval set later needs no change to this design:

- **Consent:** a future `athlete_consents(athlete_id, purpose, text_version, granted_at, withdrawn_at)` table.
- **Samples:** an `eval_samples` store copied at consent time, keyed by athlete and source conversation.
- **Purge:** both tables reference `athletes`, so adding them is one ordered step in `purge.ts`. Withdrawal deletes the athlete's samples.
- **Safety net:** the classification test below fails until the new tables are classified and covered.

### Completeness tests (F3)

- **Classification.** `purge.ts` exports `TABLE_RETENTION`, classifying every table as `account`, `plan`, `conversation` or `kept`. `kept` is only for tables without personal data: rollups, the ledger, workers, movement vocabulary and seed bookkeeping. A test fails for any public table missing from it.
- **Coverage.** The account test populates every non-`kept` table for the athlete and fails if any is left empty. A new owner table therefore needs a fixture and a purge step.
- **Identities.** After an account purge, no `athlete_id`/`owner_id` column and no JSON column mentions the athlete. After a plan purge, no plan, version, conversation, run or resource reference column, and no JSON column, mentions the purged ids. Another plan of the same athlete, and another athlete, stay readable with their logs. Whole-database row counts return to the pre-fixture snapshot as a supplementary check.
- **Interleavings.** A message sent after the marker is refused; a run queued just before it is cancelled at claim. Deletion requests and the webhook complete against a tool holding a run lock and then taking the athlete lock. Cancellation after a failed Clerk deletion is refused, and the next pass completes the purge. Replays after deletion return 404 and work again after restore. Restoring a plan just before, at and after its deadline. Journal replay onto pre-deletion data from out-of-order, duplicated lines; refusal, with nothing changed, on an interior gap, a truncated tail, an empty export or entries without a checkpoint; `--through` and `--allow-gaps`; idempotent re-run; and shipping of entries left unshipped. The deadlock tests release the tool only once Postgres reports the deletion waiting on a lock.

## Retention policy

| Data                                  | Retention                                                          |
| ------------------------------------- | ------------------------------------------------------------------ |
| Plans, chats, logs, calibrations      | While the account exists; archived plans until the athlete deletes |
| Deleted plan                          | 30 days restorable, then purged                                    |
| Account after deletion request        | 7 days, then purged; backups roll off within their window          |
| Inactive accounts                     | Kept (no automatic deletion for now)                               |
| Idempotency records                   | 7 days                                                             |
| Live journal                          | 7 days (retention pass)                                            |
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
