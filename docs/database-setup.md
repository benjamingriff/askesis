# Local database setup

## Prerequisite

Install Docker with the Compose plugin. Atlas and `psql` run inside containers, so neither needs to be installed on the host.

## Start PostgreSQL

```bash
docker compose up -d
```

Compose starts PostgreSQL 17, runs all versioned Atlas migrations, and loads the example Cardiff plan if that seed has not previously run in the volume. The complete default Compose stack then starts the API and web application; see [Local application development](./local-development.md).

The `migrate` and `seed` containers are one-shot jobs and should show `Exited (0)` after successful startup. PostgreSQL, API, and web containers remain running.

Inspect their state and logs:

```bash
docker compose ps -a
docker compose logs migrate seed api web
```

## Connect with psql

Open an interactive session inside the database container:

```bash
docker compose exec postgres psql -U askesis -d askesis
```

Connect from a host database client with:

```text
Host: localhost
Port: 5432
Database: askesis
Username: askesis
Password: askesis
```

Copy `.env.example` to `.env` to override the defaults, especially if port 5432 is already occupied.

## Atlas migrations

Atlas configuration lives in `database/atlas.hcl`. Migrations live in `database/migrations/` and are checksummed by `atlas.sum`. Atlas records applied versions in `atlas_schema_revisions`.

View migration status:

```bash
docker compose run --rm migrate migrate status --env local
```

Create an empty migration:

```bash
docker compose run --rm migrate migrate new descriptive_name --env local
```

Edit the generated SQL, then recalculate the migration checksum:

```bash
docker compose run --rm migrate migrate hash --env local
```

Apply pending migrations:

```bash
docker compose run --rm migrate
```

Do not edit a migration after it has been shared or applied outside a disposable local database. Add a new migration instead.

## Seed lifecycle

The Compose seed service checks `seed_runs` before applying `database/seed/cardiff-half-example.sql`. This makes repeated `docker compose up -d` calls safe.

Remove and reload only the example data:

```bash
./database/seed/reset.sh
docker compose run --rm seed
```

Destroy the complete local database, including migration history, then recreate it:

```bash
docker compose down --volumes
docker compose up -d
```

Stop the database without deleting it:

```bash
docker compose down
```

## Verify the setup

```bash
docker compose exec -T postgres psql -U askesis -d askesis \
  -c "SELECT week_number, workout_count, estimated_run_distance_metres / 1000 AS estimated_km FROM weekly_plan_summary ORDER BY week_number;"
```

The seed should report five workouts and 39 km for Week 1, followed by five workouts and 41.5 km for Week 2.
