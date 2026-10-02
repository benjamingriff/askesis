#!/usr/bin/env sh
set -eu
# Only the disposable local test container; never touches the development database.
export TEST_DATABASE_PORT="${TEST_DATABASE_PORT:-55432}"
docker compose --profile test up -d --wait postgres-test
docker compose exec -T postgres-test createdb -U askesis_test askesis_agent_upgrade
cleanup() { docker compose exec -T postgres-test dropdb -U askesis_test askesis_agent_upgrade; }
trap cleanup EXIT INT TERM
run_sql() { docker compose exec -T postgres-test psql -U askesis_test -d askesis_agent_upgrade --set ON_ERROR_STOP=1 --quiet; }
for migration in database/migrations/*.sql; do
  case "$migration" in *20261001120000_agent_worker.sql) break;; esac
  run_sql < "$migration"
done
run_sql < database/seed/cardiff-half-example.sql
run_sql <<'SQL'
INSERT INTO conversations(id,owner_id,title,next_sequence) VALUES
 ('00000000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000001','Upgrade provenance',2);
INSERT INTO conversation_messages(id,conversation_id,sequence,role,content) VALUES
 ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901',1,'user','Preserve this discussion.');
CREATE TABLE upgrade_snapshot(table_name text PRIMARY KEY, payload jsonb);
DO $$ DECLARE table_name text; payload jsonb; BEGIN
 FOR table_name IN SELECT unnest(ARRAY['plans','plan_versions','workouts','workout_steps','step_completions','step_targets','calibration_profiles','calibration_zones','plan_calibration_periods','conversations','conversation_messages']) LOOP
  EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM %I t', table_name) INTO payload;
  INSERT INTO upgrade_snapshot VALUES(table_name,payload);
 END LOOP;
END $$;
SQL
for migration in database/migrations/*.sql; do
  case "$migration" in *20261001120000_agent_worker.sql|*20261002090000_schedule_generation.sql) run_sql < "$migration";; esac
done
run_sql <<'SQL'
DO $$ DECLARE item record; current_payload jsonb; BEGIN
 FOR item IN SELECT * FROM upgrade_snapshot LOOP
  IF item.table_name='calibration_profiles' THEN
   EXECUTE 'SELECT jsonb_agg(to_jsonb(t)-ARRAY[''provenance'',''estimate_basis''] ORDER BY (to_jsonb(t)-ARRAY[''provenance'',''estimate_basis''])::text) FROM calibration_profiles t' INTO current_payload;
  ELSE
   EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM %I t',item.table_name) INTO current_payload;
  END IF;
  IF current_payload IS DISTINCT FROM item.payload THEN RAISE EXCEPTION 'Upgrade changed existing rows in %',item.table_name; END IF;
 END LOOP;
 IF (SELECT count(*) FROM workouts) <> 10 THEN RAISE EXCEPTION 'Workouts lost'; END IF;
 IF EXISTS(SELECT 1 FROM plan_schedule_coverage) THEN RAISE EXCEPTION 'Legacy coverage must remain unknown'; END IF;
END $$;
SQL
echo 'Phase 4 populated fixture and chat provenance survived the Phase 5 migration unchanged.'
