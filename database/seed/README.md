# Development seed

`cardiff-half-example.sql` inserts a two-week subset inspired by the existing Cardiff Half Marathon plan. It demonstrates:

- A synthetic athlete and a version-owned plan brief
- A training block and weekly macro targets
- Ten scheduled workouts
- Nested sequences, repeats, efforts, and recoveries
- Semantic zone and RPE targets
- Semantic zone targets resolved against the synthetic athlete's calibration timeline
- Two run-pace-v1 race results, recorded by `publish-fixture`: a 5K from 11 May and a 10K test
  applying from 21 May
- A cycle-power-v1 20-minute test and a swim-css-v1 CSS test, both applying from 11 May

`publish-fixture` also creates two multi-sport plans for the synthetic athlete from
[`multisport-fixtures.ts`](../../apps/api/src/development/multisport-fixtures.ts): an Olympic
triathlon with strength (swims, rides, runs, bricks and lifts) and a Hyrox plan (stations,
compromised running and strength), covering 11–24 May 2026.

The Compose `seed` service runs `seed.sh` after Atlas finishes migrating. The `seed_runs` table makes startup idempotent, so the seed is only loaded into a database volume once.

The current seed key is `cardiff-half-example-v3`. SQL creates a populated draft
with version ID `00000000-0000-0000-0000-000000000050`. Compose then runs
`publish-fixture`, which sets the athlete timezone, records its race results, fills/confirms the brief, validates, hashes, locks Version 1 and activates the plan
through the real lifecycle service. Repeated publication is safe; edited fixtures
are rejected rather than overwritten. The fixture belongs to its synthetic athlete.
Publication refuses production or Railway environments; never seed Railway.

Reset preserves athlete rows, external authentication identities and calibration history. It
requires table-owner privileges, disables user triggers only within its transaction, and
removes only the fixed fixture plans, their publication request keys and the seed marker.

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
