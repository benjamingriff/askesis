# Development seed

`cardiff-half-example.sql` inserts a two-week subset inspired by the existing Cardiff Half Marathon plan. It demonstrates:

- An athlete, plan, goals, and constraints
- A training block and weekly macro targets
- Ten scheduled workouts
- Nested sequences, repeats, efforts, and recoveries
- Semantic zone and RPE targets
- Two immutable VDOT calibration profiles
- An effective-dated calibration change after a 10k test

The Compose `seed` service runs `seed.sh` after Atlas finishes migrating. The `seed_runs` table makes startup idempotent, so the seed is only loaded into a database volume once.

The Phase 2 seed key is `cardiff-half-example-v2`. SQL creates a populated draft
with version ID `00000000-0000-0000-0000-000000000050`. Compose then runs
`publish-fixture`, which validates, hashes, locks Version 1, and activates the plan
through the real lifecycle service. Repeated publication is safe; edited fixtures
are rejected rather than overwritten. The fixture belongs to its synthetic athlete.
Publication refuses production or Railway environments; never seed Railway.

Reset preserves athlete rows and external authentication identities. It requires
table-owner privileges, disables user triggers only within its transaction, and
removes only the fixed fixture plan and seed marker.

Reset and reload only the example data:

```bash
./database/seed/reset.sh
docker compose run --rm seed
docker compose run --rm publish-fixture
```

Delete the complete local database instead:

```bash
docker compose down --volumes
docker compose up --wait
```
