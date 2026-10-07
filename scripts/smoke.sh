#!/usr/bin/env sh
set -eu

compose='docker compose -f compose.smoke.yaml'
cleanup() {
  $compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
$compose up --build --wait

health_status=$(curl --silent --output /tmp/askesis-smoke-health.json --write-out '%{http_code}' \
  http://127.0.0.1:58080/api/health)
[ "$health_status" = '200' ] || {
  echo "Smoke health check returned $health_status" >&2
  exit 1
}

protected_status=$(curl --silent --output /tmp/askesis-smoke-auth.json --write-out '%{http_code}' \
  http://127.0.0.1:58080/api/v1/workouts)
[ "$protected_status" = '401' ] || {
  echo "Protected API smoke check returned $protected_status" >&2
  exit 1
}

node -e "
const fs = require('node:fs');
const health = JSON.parse(fs.readFileSync('/tmp/askesis-smoke-health.json', 'utf8'));
const auth = JSON.parse(fs.readFileSync('/tmp/askesis-smoke-auth.json', 'utf8'));
if (health.status !== 'ok') throw new Error('Unexpected health response');
if (auth.error?.code !== 'AUTHENTICATION_REQUIRED') throw new Error('Unexpected auth response');
"

# Exercise a durable queued turn through the private worker and real SDK loop.
# The worker's scripted model makes no provider request in this disposable test.
$compose exec -T postgres psql --username askesis_smoke --dbname askesis_smoke --set ON_ERROR_STOP=1 <<'SQL'
INSERT INTO conversations(id,owner_id,title,next_sequence) VALUES
 ('00000000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000001','Worker smoke',2);
INSERT INTO conversation_messages(id,conversation_id,sequence,role,content) VALUES
 ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901',1,'user','Read my fitness.');
INSERT INTO agent_runs(id,owner_id,conversation_id,user_message_id,deadline_at) VALUES
 ('00000000-0000-4000-8000-000000000903','00000000-0000-0000-0000-000000000001','00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000902',now()+interval '2 minutes');
SQL
attempt=0
while [ "$attempt" -lt 30 ]; do
  status=$($compose exec -T postgres psql --username askesis_smoke --dbname askesis_smoke --tuples-only --no-align --command "SELECT status FROM agent_runs WHERE id='00000000-0000-4000-8000-000000000903'")
  [ "$status" = 'completed' ] && break
  [ "$status" = 'failed' ] && { echo 'Worker smoke failed.' >&2; exit 1; }
  attempt=$((attempt + 1))
  sleep 1
done
[ "$status" = 'completed' ] || { echo 'Worker smoke timed out.' >&2; exit 1; }
$compose exec -T postgres psql --username askesis_smoke --dbname askesis_smoke --set ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM agent_tool_receipts WHERE run_id='00000000-0000-4000-8000-000000000903') <> 1 THEN RAISE EXCEPTION 'Missing tool receipt'; END IF;
 IF NOT EXISTS(SELECT 1 FROM agent_run_outputs WHERE run_id='00000000-0000-4000-8000-000000000903' AND is_final AND length(content)>0) THEN RAISE EXCEPTION 'Missing durable streamed text'; END IF;
 IF NOT EXISTS(SELECT 1 FROM agent_run_measurements WHERE run_id='00000000-0000-4000-8000-000000000903') THEN RAISE EXCEPTION 'Missing stream measurements'; END IF;
 IF NOT EXISTS(SELECT 1 FROM agent_run_events WHERE run_id='00000000-0000-4000-8000-000000000903' AND type='tool_started') THEN RAISE EXCEPTION 'Missing started activity'; END IF;
 IF (SELECT count(*) FROM conversation_messages WHERE producing_run_id='00000000-0000-4000-8000-000000000903') <> 1 THEN RAISE EXCEPTION 'Missing assistant reply'; END IF;
END $$;
SQL
# A provider interruption must retain accepted text without fabricating a final message.
$compose exec -T postgres psql --username askesis_smoke --dbname askesis_smoke --set ON_ERROR_STOP=1 <<'SQL'
SELECT timings AS synthetic_stream_timings FROM agent_run_measurements
 WHERE run_id='00000000-0000-4000-8000-000000000903';
INSERT INTO conversations(id,owner_id,title,next_sequence) VALUES
 ('00000000-0000-4000-8000-000000000910','00000000-0000-0000-0000-000000000001','Interrupted stream smoke',2);
INSERT INTO conversation_messages(id,conversation_id,sequence,role,content) VALUES
 ('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000910',1,'user','Exercise partial output recovery.');
INSERT INTO agent_runs(id,owner_id,conversation_id,user_message_id,deadline_at) VALUES
 ('00000000-0000-4000-8000-000000000912','00000000-0000-0000-0000-000000000001','00000000-0000-4000-8000-000000000910','00000000-0000-4000-8000-000000000911',now()+interval '2 minutes');
SQL
attempt=0
while [ "$attempt" -lt 30 ]; do
 status=$($compose exec -T postgres psql --username askesis_smoke --dbname askesis_smoke --tuples-only --no-align --command "SELECT status FROM agent_runs WHERE id='00000000-0000-4000-8000-000000000912'")
 [ "$status" = 'failed' ] && break
 attempt=$((attempt + 1))
 sleep 1
done
[ "$status" = 'failed' ] || { echo 'Interrupted stream smoke timed out.' >&2; exit 1; }
$compose exec -T postgres psql --username askesis_smoke --dbname askesis_smoke --set ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM agent_run_outputs WHERE run_id='00000000-0000-4000-8000-000000000912' AND content='Visible text before a simulated provider failure.' AND NOT is_final) THEN RAISE EXCEPTION 'Missing incomplete output'; END IF;
 IF EXISTS(SELECT 1 FROM conversation_messages WHERE producing_run_id='00000000-0000-4000-8000-000000000912') THEN RAISE EXCEPTION 'Fabricated completed answer'; END IF;
END $$;
SQL
private_status=$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:58080/internal/agent/claim)
[ "$private_status" = '404' ] || { echo 'Private worker API reached the public proxy.' >&2; exit 1; }

echo 'Askesis disposable API/web/worker smoke test passed.'
