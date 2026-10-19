# Data deletion and retention

How plan and account deletion run, and what an operator configures or does. The product decisions and design are in the [proposal](../product/data-deletion-and-retention.md).

## What happens

| Action                                          | Immediately                                                                                                                            | Later                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Athlete deletes a plan                          | Plan archived, deactivated and hidden with its conversations, runs, training log and check-ins. Listed under Plans → Recently deleted. | Purged 30 days after deletion unless restored.                                                       |
| Athlete restores a plan                         | Returns to Archived with its history.                                                                                                  | —                                                                                                    |
| Athlete deletes their account (You → Your data) | Coaching stops; every screen is replaced by the deletion notice, which offers Keep my account, Download my data and Sign out.          | After 7 days: the Clerk user is deleted (production only), then every database row the athlete owns. |
| Clerk `user.deleted` webhook                    | Account scheduled for immediate purge.                                                                                                 | Next retention pass.                                                                                 |

The retention sweeper runs inside every API process, 30 seconds after start and then every 15 minutes. Each pass purges expired plans and accounts, deletes cached command responses older than 7 days and prunes live-journal events older than 7 days. A purged run's usage is added to `agent_usage_rollups` (no identifiers or text). Purges are recorded in `data_deletions`.

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
pnpm --filter @askesis/api retention:replay /path/to/api-logs.jsonl
```

The root `retention:run` runs inside this worktree's development environment. Against Railway, run the API package commands with the service's environment.

## Backups and replay

A restored backup predates later deletions. Every deletion transition therefore also writes a structured log line after commit, `{"deletion": {"event": …}}`, with ids and times only. The events are `plan.deleted`, `plan.restored`, `plan.purged`, `account.deletion_requested`, `account.deletion_cancelled` and `account.purged`.

- Keep API logs for longer than the oldest backup you might restore.
- After restoring a backup and applying migrations, and **before** the restored API takes traffic, export the API logs from the backup's timestamp onwards, oldest first, as JSON lines. Then run `retention:replay` on them. It re-marks soft deletions and cancellations, and re-purges purged plans and accounts. Events for rows the backup never had are no-ops. The [restore outline](./database-backup-and-restore.md#disaster-restore-outline) includes this step.

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
