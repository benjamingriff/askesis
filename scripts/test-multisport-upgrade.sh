#!/usr/bin/env sh
set -eu
# Rehearse the multi-sport migration on a populated, disposable database: running briefs in
# draft and locked versions become run baselines without touching locked content otherwise.
export TEST_DATABASE_PORT="${TEST_DATABASE_PORT:-55432}"
docker compose --profile test up -d --wait postgres-test
docker compose exec -T postgres-test createdb -U askesis_test askesis_multisport_upgrade
cleanup() { docker compose exec -T postgres-test dropdb -U askesis_test askesis_multisport_upgrade; }
trap cleanup EXIT INT TERM
run_sql() { docker compose exec -T postgres-test psql -U askesis_test -d askesis_multisport_upgrade --set ON_ERROR_STOP=1 --quiet; }
for migration in database/migrations/*.sql; do
  case "$migration" in *20261008120000_multisport.sql) break;; esac
  run_sql < "$migration"
done
run_sql < database/seed/cardiff-half-example.sql
run_sql <<'SQL'
BEGIN;
INSERT INTO plan_briefs(plan_version_id,lineage_id,goal_text,weekly_distance_status,weekly_distance_metres,
  current_runs_status,current_runs_per_week,longest_run_status,longest_run_metres,desired_runs_per_week)
 VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-4000-8000-000000000a01','Locked goal',
  'known',40000,'known',5,'unknown',NULL,5);
UPDATE plan_versions SET state='locked', version_number=1, content_hash=repeat('a',64),
  content_hash_version=4, validator_version=1, validation_findings='[]',
  acknowledged_warning_codes='{}', change_summary='{}', locked_at=now()
 WHERE id='00000000-0000-0000-0000-000000000050';
UPDATE plans SET current_draft_version_id=NULL, current_locked_version_id='00000000-0000-0000-0000-000000000050'
 WHERE id='00000000-0000-0000-0000-000000000010';
INSERT INTO plan_versions(id,plan_id,based_on_version_id)
 VALUES ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000050');
UPDATE plans SET current_draft_version_id='00000000-0000-0000-0000-000000000051'
 WHERE id='00000000-0000-0000-0000-000000000010';
INSERT INTO plan_briefs(plan_version_id,lineage_id,goal_text,desired_runs_per_week)
 VALUES ('00000000-0000-0000-0000-000000000051','00000000-0000-4000-8000-000000000a01','Draft goal',4);
COMMIT;
SQL
run_sql < database/migrations/20261008120000_multisport.sql
run_sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM plan_brief_sports WHERE plan_version_id='00000000-0000-0000-0000-000000000050'
   AND lineage_id='00000000-0000-4000-8000-000000000a01' AND sport='run' AND weekly_volume=40000
   AND current_sessions_per_week=5 AND longest_session_status='unknown' AND desired_sessions_per_week=5) THEN
  RAISE EXCEPTION 'Locked running brief did not become a run baseline';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM plan_brief_sports WHERE plan_version_id='00000000-0000-0000-0000-000000000051'
   AND lineage_id='00000000-0000-4000-8000-000000000a01' AND current_sessions_status='unanswered'
   AND weekly_volume_status='unanswered' AND desired_sessions_per_week=4) THEN
  RAISE EXCEPTION 'Draft running brief did not keep its lineage and answers';
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_briefs'
   AND column_name IN ('weekly_distance_metres','desired_runs_per_week')) THEN
  RAISE EXCEPTION 'Running-only brief columns remain';
 END IF;
 BEGIN
  UPDATE plan_brief_sports SET desired_sessions_per_week=6
   WHERE plan_version_id='00000000-0000-0000-0000-000000000050';
  RAISE EXCEPTION 'Locked baseline edit unexpectedly succeeded';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT count(*) FROM pg_constraint WHERE conname IN
   ('workouts_primary_discipline_check','workout_steps_discipline_check')) <> 2
   OR NOT valid_target_unit('pace','seconds_per_100_metres') THEN
  RAISE EXCEPTION 'Sport vocabulary or swim pace unit missing';
 END IF;
END $$;
SQL
run_sql < database/tests/plan-version-invariants.sql
echo 'Running briefs became run baselines in draft and locked versions; locked content stayed immutable.'
