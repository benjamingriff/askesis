# Local database setup

Verified against [Compose](../../compose.yaml), [Atlas](../../database/atlas.hcl), [seed](../../database/seed/seed.sh) and [fixture publisher](../../apps/api/src/development/publish-fixture.ts) on 2026-10-06.

## Start and connect

Configure ignored root `.env` from `.env.example`, including valid Clerk development keys for browser use, then:

```bash
docker compose up --build -d
docker compose ps -a
docker compose logs migrate seed publish-fixture api web
```

PostgreSQL is version 17. Migrate should exit successfully before API/web start. Historical seed/publication jobs are optional in the `fixtures` profile; account-owned examples use [manual seeding](./example-plan.md). Defaults are localhost:5432, database/user/password `askesis`; override them for local use with the Compose environment variables. Atlas and `psql` run in containers.

```bash
docker compose exec postgres psql -U askesis -d askesis
```

Examples assume default database/user names; adjust commands when overriding them. Full application setup is in [local development](./local-development.md).

## Atlas migrations

`database/migrations/atlas.sum` checksums the ordered migration files. Atlas stores its revision rows in `atlas_schema_revisions.atlas_schema_revisions`.

```bash
docker compose run --rm migrate migrate status --env local
docker compose run --rm migrate migrate new descriptive_name --env local
```

Edit the new SQL, then:

```bash
docker compose run --rm migrate migrate hash --env local
docker compose run --rm migrate
```

Never modify deployed/shared migrations; add another migration. The current API readiness checkpoint is `20261007120000`. Regenerate database types after applying schema changes, with the correct process-level `DATABASE_URL`.

## Seed lifecycle

`seed_runs` guards key `cardiff-half-example-v3`. SQL creates a populated draft with version UUID `00000000-0000-0000-0000-000000000050` owned by the synthetic athlete. The separate publisher fills/validates the brief and calibration, confirms, promotes the draft to locked version 1 and activates the logical plan. It uses lifecycle services rather than bypassing immutable-content triggers. Repeated publication accepts an untouched fixture; edited fixtures are rejected rather than overwritten.

The fixture does not belong to an arbitrary signed-in Clerk user. Never run these historical seed/publication jobs on Railway; they reject production/Railway configuration. The separate [account-owned example](./example-plan.md) supports hosted deployment.

To remove and reload only the fixed example plan:

```bash
./database/seed/reset.sh
docker compose run --rm seed
docker compose run --rm publish-fixture
```

Reset requires table-owner privileges, disables user triggers only inside its transaction and refuses a plan with a different owner. It removes fixture-owned plan data and the seed marker, retaining athlete/authentication rows. It is not an account deletion procedure.

The following intentionally deletes the complete local volume, including unrelated development data:

```bash
docker compose down --volumes
docker compose up --build -d
```

Use `docker compose down` alone to retain the database.

## Verify the setup

```bash
docker compose exec -T postgres psql -U askesis -d askesis \
  -c "SELECT week_number, workout_count, estimated_run_distance_metres / 1000 AS estimated_km FROM weekly_plan_summary WHERE plan_version_id = '00000000-0000-0000-0000-000000000050' ORDER BY week_number;"
```

The published fixture should report five workouts/39 km for week 1 and five/41.5 km for week 2. [Example queries](./example-queries.md) inspect current schema, version context and prescriptions.
