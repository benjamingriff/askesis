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

The Phase 2 seed key is `cardiff-half-example-v2`. During schema-foundation work,
the fixture is a populated initial draft with version ID
`00000000-0000-0000-0000-000000000050`. Publication will use the lifecycle service
once canonical hashing and validation are implemented. The transitional Plan
route accepts `?planVersionId=00000000-0000-0000-0000-000000000050` for inspection.

Reset preserves athlete rows and external authentication identities. It requires
table-owner privileges, disables user triggers only within its transaction, and
removes only the fixed fixture plan and seed marker.

Reset and reload only the example data:

```bash
./database/seed/reset.sh
docker compose run --rm seed
```

Delete the complete local database instead:

```bash
docker compose down --volumes
docker compose up --wait
```
