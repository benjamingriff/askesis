# Data deletion and retention

How plan and account deletion run, and what an operator configures or does. The product decisions and design are in the [proposal](../product/data-deletion-and-retention.md).

## What happens

| Action                                          | Immediately                                                                                                                            | Later                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Athlete deletes a plan                          | Plan archived, deactivated and hidden with its conversations, runs, training log and check-ins. Listed under Plans → Recently deleted. | Purged 30 days after deletion unless restored.                                                       |
| Athlete restores a plan                         | Returns to Archived with its history.                                                                                                  | —                                                                                                    |
| Athlete deletes their account (You → Your data) | Coaching stops; every screen is replaced by the deletion notice, which offers Keep my account, Download my data and Sign out.          | After 7 days: the Clerk user is deleted (production only), then every database row the athlete owns. |
| Clerk `user.deleted` webhook                    | Account scheduled for immediate purge.                                                                                                 | Next retention pass.                                                                                 |

The retention sweeper runs inside every API process, 30 seconds after start and then every 15 minutes. Each pass purges expired plans and accounts, deletes cached command responses older than 7 days and prunes live-journal events older than 7 days. A purged run's usage is added to `agent_usage_rollups` (no identifiers or text). Each pass also cancels coaching left running for accounts pending deletion, and ships the deletion journal.

## Configuration

- `CLERK_WEBHOOK_SIGNING_SECRET` (optional, `whsec_…`): enables `POST /api/webhooks/clerk`. In the Clerk dashboard, add an endpoint at the public API origin for the `user.deleted` event and copy its signing secret into the API service. Without it the route returns 404.
- Clerk users are deleted by the purge only when `NODE_ENV=production`. Elsewhere the purge removes database rows and leaves the Clerk user, so the next sign-in provisions an empty account. That keeps the shared local verification user usable across worktrees.
- Keep Clerk's own self-service account deletion disabled. The app's flow provides the grace period, the data export and run cancellation; the webhook covers deletions made from the dashboard.

## Commands

```bash
# One retention pass now. Outside production, --as-of pretends it is later, to test purges.
pnpm retention:run
pnpm retention:run -- --as-of 2026-12-01T00:00:00Z

# Re-apply deletions recorded after a backup was taken (see below).
pnpm --filter @askesis/api retention:replay /path/to/api-logs.jsonl [--through <sequence>] [--allow-gaps]
```

The root `retention:run` runs inside this worktree's development environment. Against Railway, run the API package commands with the service's environment.

## Backups and replay

A restored backup predates later deletions. Every deletion transition is therefore recorded in `deletion_journal`, in the same transaction that makes it. Entries carry ids and times only, under a gapless sequence taken from one head row, so the sequence follows commit order. They are then shipped to the API logs as `{"deletion": {"sequence", "event", "subjectId", "at"}}`: right after commit, and again by every retention pass for anything a crash left unshipped. Shipping ignores `LOG_LEVEL` (only `silent` suppresses it), and the events are `plan.deleted`, `plan.restored`, `plan.purged`, `account.deletion_requested`, `account.deletion_cancelled` and `account.purged`.

- Keep API logs for longer than the oldest backup you might restore.
- Every retention pass also logs a checkpoint, `{"deletionCheckpoint": {"sequence"}}`: the highest sequence up to which every entry has been shipped. It tells a replay where the journal ended.
- After restoring a backup and applying migrations, and **before** the restored API takes traffic, export the API logs from the backup's timestamp up to now as JSON lines (any order; duplicates are fine) and run `retention:replay` on them. Entries at or below the restored journal head are skipped. The rest must run without gaps up to the journal's end: `--through <sequence>` if you can read `deletion_journal_head` from the damaged database (step 2 of the restore preserves it), otherwise the latest checkpoint in the export. A missing entry, a truncated tail or an export with no checkpoint stops the replay before anything changes, naming what is missing. Find the missing lines, or accept the loss with `--allow-gaps`. Each entry commits with its journal row, so an interrupted replay can be run again. The [restore outline](./database-backup-and-restore.md#disaster-restore-outline) includes this step.
- Remaining exposure: entries committed after the last checkpoint and never shipped, when the damaged database cannot be read. Shipping normally follows commit within a second.

## Retention

| Data                                          | Kept                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Plans, chats, logs, check-ins, calibrations   | While the account exists; archived plans until the athlete deletes them |
| Deleted plan                                  | 30 days, restorable, then purged                                        |
| Account after a deletion request              | 7 days, then purged                                                     |
| Inactive accounts                             | Not deleted automatically                                               |
| Cached command responses, live-journal events | 7 days                                                                  |
| Usage rollups, deletion ledger                | Indefinitely (no personal data)                                         |
| API logs, Sentry events, database backups     | Operator-configured; logs must outlive backups                          |

Model providers keep request data under their own API terms. The worker disables OpenAI response storage; check the Anthropic terms in use.

## Adding a table

`TABLE_RETENTION` in `apps/api/src/modules/account/purge.ts` classifies every table. The deletion test fails if a table is missing from it. If the table holds athlete data, it fails until the account fixture populates the table and the purge deletes those rows. A future opt-in evaluation store is added the same way: its consent and sample tables reference the athlete, so withdrawing consent and purging the account both delete them.
