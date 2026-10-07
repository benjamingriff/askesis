#!/usr/bin/env sh
set -eu
# Rehearse the athlete-performance cutover on a populated, disposable Phase 6 database.
export TEST_DATABASE_PORT="${TEST_DATABASE_PORT:-55432}"
docker compose --profile test up -d --wait postgres-test
docker compose exec -T postgres-test createdb -U askesis_test askesis_performance_upgrade
cleanup() { docker compose exec -T postgres-test dropdb -U askesis_test askesis_performance_upgrade; }
trap cleanup EXIT INT TERM
run_sql() { docker compose exec -T postgres-test psql -U askesis_test -d askesis_performance_upgrade --set ON_ERROR_STOP=1 --quiet; }
for migration in database/migrations/*.sql; do
  case "$migration" in *20261007120000_athlete_performance.sql) break;; esac
  run_sql < "$migration"
done
run_sql < database/seed/cardiff-half-example.sql
run_sql <<'SQL'
INSERT INTO athlete_identities(athlete_id,provider,provider_subject) VALUES
 ('00000000-0000-0000-0000-000000000001','test','performance-preserved-identity');
INSERT INTO plan_briefs(plan_version_id,goal_text,timezone) VALUES
 ('00000000-0000-0000-0000-000000000050','Legacy goal','Europe/London');
INSERT INTO calibration_profiles(id,plan_version_id,discipline,system,method,fitness_value,
  threshold_seconds_per_kilometre,calculator_version) VALUES
 ('00000000-0000-4000-8000-000000000801','00000000-0000-0000-0000-000000000050','run','run_pace',
  'threshold_pace',50,300,'run-pace-v1');
INSERT INTO calibration_zones(plan_version_id,profile_id,zone_key,metric,minimum_value,target_value,maximum_value,unit)
 VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-4000-8000-000000000801','easy','pace',380,400,420,'seconds_per_kilometre');
INSERT INTO plan_calibration_periods(plan_version_id,profile_id,system,effective_from) VALUES
 ('00000000-0000-0000-0000-000000000050','00000000-0000-4000-8000-000000000801','run_pace','2026-05-11');
INSERT INTO conversations(id,owner_id,plan_id,title,next_sequence) VALUES
 ('00000000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010','Legacy history',2);
INSERT INTO conversation_messages(id,conversation_id,sequence,role,content) VALUES
 ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901',1,'user','Legacy question');
INSERT INTO agent_runs(id,owner_id,conversation_id,plan_id,user_message_id,deadline_at,status) VALUES
 ('00000000-0000-4000-8000-000000000903','00000000-0000-0000-0000-000000000001',
  '00000000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000010',
  '00000000-0000-4000-8000-000000000902',now()+interval '1 hour','queued');
INSERT INTO agent_tool_receipts(run_id,operation_id,tool_name,input_hash,response) VALUES
 ('00000000-0000-4000-8000-000000000903','legacy','set_fitness_calibration','hash','{}');
SQL
run_sql < database/migrations/20261007120000_athlete_performance.sql
run_sql <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM athlete_identities WHERE provider_subject='performance-preserved-identity') THEN
  RAISE EXCEPTION 'Cutover lost athlete identity';
 END IF;
 IF EXISTS (SELECT 1 FROM plans) OR EXISTS (SELECT 1 FROM conversations)
   OR EXISTS (SELECT 1 FROM agent_runs) OR EXISTS (SELECT 1 FROM seed_runs) THEN
  RAISE EXCEPTION 'Cutover retained disposable plan or coaching data';
 END IF;
 IF to_regclass('calibration_profiles') IS NOT NULL OR to_regclass('plan_calibration_periods') IS NOT NULL THEN
  RAISE EXCEPTION 'Plan-owned calibration tables remain';
 END IF;
 IF (SELECT timezone FROM athletes WHERE id='00000000-0000-0000-0000-000000000001') <> 'UTC' THEN
  RAISE EXCEPTION 'Athlete timezone default missing';
 END IF;
END $$;
SQL
run_sql < database/seed/cardiff-half-example.sql
run_sql < database/tests/plan-version-invariants.sql
echo 'Populated Phase 6 data cut over to athlete performance; identities survived and the fixture reseeds.'
