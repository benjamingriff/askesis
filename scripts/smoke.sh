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

echo 'Askesis disposable smoke test passed.'
