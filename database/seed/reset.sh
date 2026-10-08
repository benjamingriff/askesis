#!/bin/sh
set -eu

# Remove seeded application data while retaining the Atlas-managed schema.
docker compose exec -T postgres psql \
  --username "${POSTGRES_USER:-askesis}" \
  --dbname "${POSTGRES_DB:-askesis}" \
  --set ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- This operator-only workflow requires table-owner privileges. No application
-- flag can bypass immutable history. Changes and trigger restoration are atomic.
DO $$
DECLARE t text;
DECLARE fixtures uuid[] := ARRAY['00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012']::uuid[];
DECLARE content text[] := ARRAY['step_targets', 'step_completions', 'workout_steps',
  'workout_tags', 'workouts', 'week_targets', 'training_weeks', 'training_blocks',
  'plan_schedule_coverage', 'plan_brief_weekdays', 'plan_brief_sports', 'plan_briefs'];
BEGIN
  IF EXISTS (SELECT 1 FROM plans WHERE id = ANY(fixtures)
      AND owner_id <> '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Fixture plan belongs to a different account; refusing reset';
  END IF;
  FOREACH t IN ARRAY content || ARRAY['plans', 'plan_versions'] LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
  END LOOP;
  FOREACH t IN ARRAY content LOOP
    EXECUTE format('DELETE FROM %I WHERE plan_version_id IN (SELECT id FROM plan_versions WHERE plan_id = ANY($1))', t)
      USING fixtures;
  END LOOP;
  DELETE FROM plan_versions WHERE plan_id = ANY(fixtures);
  DELETE FROM plans WHERE id = ANY(fixtures)
    AND owner_id = '00000000-0000-0000-0000-000000000001';
  SET CONSTRAINTS ALL IMMEDIATE;
  FOREACH t IN ARRAY content || ARRAY['plans', 'plan_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
  END LOOP;
END $$;
-- Fixture publication locks with fixed request keys; forget them so it can lock again.
DELETE FROM api_idempotency_keys WHERE athlete_id = '00000000-0000-0000-0000-000000000001'
  AND idempotency_key LIKE '%-publication';
DELETE FROM seed_runs WHERE seed_key = 'cardiff-half-example-v3';
COMMIT;
SQL

echo "Seed data removed. Run 'docker compose run --rm seed' to load it again."
