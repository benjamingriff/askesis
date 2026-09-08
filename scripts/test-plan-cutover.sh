#!/usr/bin/env sh
set -eu

# Uses only the isolated postgres-test container, never the development service.
docker compose --profile test up -d --wait postgres-test
docker compose exec -T postgres-test createdb -U askesis_test askesis_cutover_test
cleanup() {
  docker compose exec -T postgres-test dropdb -U askesis_test askesis_cutover_test
}
trap cleanup EXIT INT TERM

run_sql() {
  docker compose exec -T postgres-test psql -U askesis_test -d askesis_cutover_test \
    --set ON_ERROR_STOP=1 --quiet
}
run_sql < database/migrations/20260318120000_initial_schema.sql
run_sql < database/migrations/20260722153000_auth_identities.sql
run_sql <<'SQL'
INSERT INTO athletes(id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Cutover fixture');
INSERT INTO plans(owner_id, slug, title, start_date, end_date, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'legacy', 'Legacy plan', '2026-09-01', '2026-09-30', 'active');
INSERT INTO calibration_profiles(owner_id, discipline, system, method)
VALUES ('00000000-0000-0000-0000-000000000001', 'run', 'pace', 'test');
INSERT INTO athlete_identities(athlete_id, provider, provider_subject)
VALUES ('00000000-0000-0000-0000-000000000001', 'test', 'cutover-preserved-identity');
SQL
run_sql < database/migrations/20260907120000_plan_versions.sql
run_sql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM athlete_identities
      WHERE provider_subject = 'cutover-preserved-identity'
        AND athlete_id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Cutover lost athlete identity';
  END IF;
  IF EXISTS (SELECT 1 FROM plans) OR EXISTS (SELECT 1 FROM workouts)
      OR EXISTS (SELECT 1 FROM calibration_profiles) THEN
    RAISE EXCEPTION 'Cutover retained legacy plan data';
  END IF;
END $$;
SQL
run_sql < database/tests/plan-version-invariants.sql
run_sql < database/seed/cardiff-half-example.sql
run_sql <<'SQL'
DO $$ BEGIN
  IF (SELECT count(*) FROM workouts) <> 10 THEN
    RAISE EXCEPTION 'Versioned fixture did not load';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM athlete_identities WHERE provider_subject = 'cutover-preserved-identity') THEN
    RAISE EXCEPTION 'Reseed lost athlete identity';
  END IF;
END $$;
SQL
sed -n '/^BEGIN;$/,/^COMMIT;$/p' database/seed/reset.sh | run_sql
run_sql <<'SQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM plans) THEN
    RAISE EXCEPTION 'Fixture reset retained plans';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM athlete_identities WHERE provider_subject = 'cutover-preserved-identity') THEN
    RAISE EXCEPTION 'Fixture reset lost athlete identity';
  END IF;
END $$;
SQL
echo 'Plan cutover, identity preservation, guards, and reseed checks passed.'
