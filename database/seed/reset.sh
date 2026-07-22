#!/bin/sh
set -eu

# Remove seeded application data while retaining the Atlas-managed schema.
docker compose exec -T postgres psql \
  --username "${POSTGRES_USER:-askesis}" \
  --dbname "${POSTGRES_DB:-askesis}" \
  --set ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM athletes WHERE id = '00000000-0000-0000-0000-000000000001';
DELETE FROM seed_runs WHERE seed_key = 'cardiff-half-example-v1';
COMMIT;
SQL

echo "Seed data removed. Run 'docker compose run --rm seed' to load it again."
