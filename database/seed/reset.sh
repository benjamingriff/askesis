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
BEGIN
  IF EXISTS (SELECT 1 FROM plans WHERE id = '00000000-0000-0000-0000-000000000010'
      AND owner_id <> '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Fixture plan belongs to a different account; refusing reset';
  END IF;
  FOREACH t IN ARRAY ARRAY['plans', 'plan_versions', 'plan_goals', 'plan_constraints',
    'training_blocks', 'training_weeks', 'week_targets', 'workouts', 'workout_tags',
    'workout_steps', 'step_completions', 'step_targets', 'calibration_profiles',
    'calibration_zones', 'plan_calibration_periods'] LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['step_targets', 'step_completions', 'workout_steps',
    'workout_tags', 'workouts', 'week_targets', 'training_weeks', 'training_blocks',
    'plan_calibration_periods', 'calibration_zones', 'calibration_profiles',
    'plan_goals', 'plan_constraints'] LOOP
    EXECUTE format('DELETE FROM %I WHERE plan_version_id IN (SELECT id FROM plan_versions WHERE plan_id = $1)', t)
      USING '00000000-0000-0000-0000-000000000010'::uuid;
  END LOOP;
  DELETE FROM plan_versions WHERE plan_id = '00000000-0000-0000-0000-000000000010';
  DELETE FROM plans WHERE id = '00000000-0000-0000-0000-000000000010'
    AND owner_id = '00000000-0000-0000-0000-000000000001';
  SET CONSTRAINTS ALL IMMEDIATE;
  FOREACH t IN ARRAY ARRAY['plans', 'plan_versions', 'plan_goals', 'plan_constraints',
    'training_blocks', 'training_weeks', 'week_targets', 'workouts', 'workout_tags',
    'workout_steps', 'step_completions', 'step_targets', 'calibration_profiles',
    'calibration_zones', 'plan_calibration_periods'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
  END LOOP;
END $$;
DELETE FROM seed_runs WHERE seed_key = 'cardiff-half-example-v2';
COMMIT;
SQL

echo "Seed data removed. Run 'docker compose run --rm seed' to load it again."
