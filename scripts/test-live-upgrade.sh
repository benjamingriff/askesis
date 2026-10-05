#!/usr/bin/env sh
set -eu
# Rehearse the additive Phase 6 migration on a populated, disposable Phase 5 database.
export TEST_DATABASE_PORT="${TEST_DATABASE_PORT:-55432}"
docker compose --profile test up -d --wait postgres-test
docker compose exec -T postgres-test createdb -U askesis_test askesis_live_upgrade
cleanup() { docker compose exec -T postgres-test dropdb -U askesis_test askesis_live_upgrade; }
trap cleanup EXIT INT TERM
run_sql() { docker compose exec -T postgres-test psql -U askesis_test -d askesis_live_upgrade --set ON_ERROR_STOP=1 --quiet; }
for migration in database/migrations/*.sql; do
  case "$migration" in *20261005120000_live_coaching.sql) break;; esac
  run_sql < "$migration"
done
run_sql < database/seed/cardiff-half-example.sql
run_sql <<'SQL'
INSERT INTO conversations(id,owner_id,title,next_sequence) VALUES
 ('00000000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000001','Phase 5 history',3);
INSERT INTO conversation_messages(id,conversation_id,sequence,role,content) VALUES
 ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901',1,'user','Preserve my question.');
INSERT INTO agent_runs(id,owner_id,conversation_id,user_message_id,deadline_at,status) VALUES
 ('00000000-0000-4000-8000-000000000903','00000000-0000-0000-0000-000000000001','00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000902',now()+interval '1 hour','queued');
INSERT INTO agent_tool_receipts(run_id,operation_id,tool_name,input_hash,response) VALUES
 ('00000000-0000-4000-8000-000000000903','original-operation','read_plan_context','original-hash','{"plan":null}');
UPDATE agent_runs SET status='running',started_at=now() WHERE id='00000000-0000-4000-8000-000000000903';
INSERT INTO conversation_messages(id,conversation_id,sequence,role,content,producing_run_id) VALUES
 ('00000000-0000-4000-8000-000000000904','00000000-0000-4000-8000-000000000901',2,'assistant','Preserve my answer.','00000000-0000-4000-8000-000000000903');
UPDATE agent_runs SET status='completed',finished_at=now() WHERE id='00000000-0000-4000-8000-000000000903';
INSERT INTO agent_run_events(run_id,sequence,type) VALUES ('00000000-0000-4000-8000-000000000903',1,'completed');
CREATE TABLE upgrade_snapshot(table_name text PRIMARY KEY,payload jsonb);
DO $$ DECLARE name text; payload jsonb; BEGIN
 FOR name IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'upgrade_snapshot' LOOP
  EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM %I t',name) INTO payload;
  INSERT INTO upgrade_snapshot VALUES(name,payload);
 END LOOP;
END $$;
SQL
run_sql < database/migrations/20261005120000_live_coaching.sql
run_sql <<'SQL'
DO $$ DECLARE item record; payload jsonb; BEGIN
 FOR item IN SELECT * FROM upgrade_snapshot LOOP
  EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM %I t',item.table_name) INTO payload;
  IF payload IS DISTINCT FROM item.payload THEN RAISE EXCEPTION 'Upgrade changed existing rows in %',item.table_name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM agent_run_outputs) OR EXISTS(SELECT 1 FROM agent_tool_changes) THEN RAISE EXCEPTION 'Upgrade invented historical output'; END IF;
END $$;
SQL
echo 'Populated Phase 5 plans, messages, runs and receipts survived Phase 6 unchanged.'
