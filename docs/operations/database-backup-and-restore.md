# Database backup and restore

## Status

Procedure reviewed against the current PostgreSQL schema/configuration on 2026-10-06. No hosted backup, retention setting or disaster restore was performed by this documentation audit.

The local and private Railway prototype uses PostgreSQL. Railway-managed automated backups must be verified before inviting alpha users. Until then, this document defines the manual fallback procedure.

## Safety rules

- Never put a database URL in source control, shell history, logs, or chat.
- Create backups before destructive or difficult-to-reverse migrations.
- Restore into a new empty database first; do not overwrite the only copy of a database.
- Keep backup files outside the repository.
- Treat backups as sensitive because they contain account, plan, and chat data.
- Verify a backup by restoring it. A successful `pg_dump` command alone is not sufficient.

## Local backup

Back up the Docker Compose development database in PostgreSQL custom format:

```bash
mkdir -p "$HOME/askesis-backups"
docker compose exec -T postgres \
  pg_dump -U askesis -d askesis --format=custom --no-owner --no-acl \
  > "$HOME/askesis-backups/askesis-$(date +%Y%m%d-%H%M%S).dump"
```

The destination is deliberately outside the repository.

## Hosted backup

Obtain the private or temporary administrative PostgreSQL URL through Railway's secret-variable tooling without printing or committing it. Then run from a trusted machine with PostgreSQL client tools installed:

```bash
mkdir -p "$HOME/askesis-backups"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file "$HOME/askesis-backups/askesis-$(date +%Y%m%d-%H%M%S).dump"
```

Unset the shell variable afterwards:

```bash
unset DATABASE_URL
```

Prefer private connectivity or Railway's supported administrative connection method. Do not expose PostgreSQL publicly on an ongoing basis merely to run backups.

## Restore verification

Create a separate empty PostgreSQL database and restore the dump into it:

```bash
createdb askesis_restore_check
pg_restore \
  --dbname askesis_restore_check \
  --no-owner \
  --no-acl \
  "$HOME/askesis-backups/<backup-file>.dump"
```

Run basic checks:

```bash
psql askesis_restore_check -c 'select count(*) from athletes;'
psql askesis_restore_check -c 'select count(*) from plans;'
psql askesis_restore_check -c 'select count(*) from workouts;'
psql askesis_restore_check -c \
  'select version, applied from atlas_schema_revisions.atlas_schema_revisions order by version;'
```

Then start an API instance pointed at the restored database and verify `/api/ready` and representative authenticated reads.

Remove the verification database after the check:

```bash
dropdb askesis_restore_check
```

## Disaster restore outline

1. Stop the worker and API services to stop application writes. There is no implemented maintenance-mode switch. Preserve the database and operator access.
2. Preserve the damaged database; do not immediately delete it.
3. Provision a new empty PostgreSQL database.
4. Restore the most recent verified backup.
5. Apply any later append-only Atlas migrations.
6. Point a private API instance at the restored database.
7. Verify readiness, identity mappings, version pointers/hashes, briefs/coverage, athlete calibration timelines, conversations and representative owner-authorized reads. Restored queued/leased runs need deliberate review: startup sweep can expire old work; do not replay model sessions automatically.
8. Switch application traffic only after verification.
9. Record the incident, backup timestamp, data-loss window, and corrective action.

## Before the private alpha

- Enable and verify the backup capability available on the selected Railway plan.
- Record backup frequency and retention.
- Perform at least one full restore rehearsal.
- Decide who can access backups.
- Encrypt any backup stored outside Railway.
- Define the acceptable recovery point and recovery time for the prototype.
