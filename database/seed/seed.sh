#!/bin/sh
set -eu

SEED_KEY="cardiff-half-example-v1"
SEED_FILE="${SEED_FILE:-/workspace/database/seed/cardiff-half-example.sql}"

already_applied="$(psql -Atqc "SELECT EXISTS (SELECT 1 FROM seed_runs WHERE seed_key = '${SEED_KEY}')")"

if [ "$already_applied" = "t" ]; then
  echo "Seed ${SEED_KEY} is already applied; nothing to do."
  exit 0
fi

echo "Applying seed ${SEED_KEY}..."
psql --set ON_ERROR_STOP=1 --file "$SEED_FILE"
echo "Seed ${SEED_KEY} applied."
