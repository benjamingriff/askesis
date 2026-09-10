-- Pre-alpha plan test data is disposable. Authenticated identities survive.
TRUNCATE plans, plan_versions, plan_goals, plan_constraints, training_blocks,
 training_weeks, week_targets, workouts, workout_tags, workout_steps,
 step_completions, step_targets, calibration_profiles, calibration_zones,
 plan_calibration_periods, api_idempotency_keys;
DELETE FROM seed_runs WHERE seed_key LIKE 'cardiff-half-example-%';
DROP TABLE plan_goals;
DROP TABLE plan_constraints;
ALTER TABLE plan_versions ALTER COLUMN content_schema_version SET DEFAULT 2;

CREATE TABLE plan_briefs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lineage_id uuid NOT NULL DEFAULT gen_random_uuid(),
 plan_version_id uuid NOT NULL UNIQUE REFERENCES plan_versions(id),
 goal_text text NOT NULL DEFAULT '',
 distance_unit text NOT NULL DEFAULT 'kilometres' CHECK (distance_unit IN ('kilometres', 'miles')),
 timezone text NOT NULL DEFAULT 'UTC',
 weekly_distance_status text NOT NULL DEFAULT 'unanswered' CHECK (weekly_distance_status IN ('unanswered','unknown','known')),
 weekly_distance_metres numeric(14,3),
 current_runs_status text NOT NULL DEFAULT 'unanswered' CHECK (current_runs_status IN ('unanswered','unknown','known')),
 current_runs_per_week integer,
 longest_run_status text NOT NULL DEFAULT 'unanswered' CHECK (longest_run_status IN ('unanswered','unknown','known')),
 longest_run_metres numeric(14,3),
 desired_runs_per_week integer CHECK (desired_runs_per_week BETWEEN 1 AND 14),
 context text NOT NULL DEFAULT '',
 confirmed_hash text,
 confirmed_at timestamptz,
 confirmed_edit_number integer,
 validator_version integer,
 acknowledged_warning_codes text[],
 schedule_review_required boolean NOT NULL DEFAULT false,
 CHECK ((weekly_distance_status = 'known' AND weekly_distance_metres IS NOT NULL AND weekly_distance_metres >= 0) OR (weekly_distance_status <> 'known' AND weekly_distance_metres IS NULL)),
 CHECK ((current_runs_status = 'known' AND current_runs_per_week IS NOT NULL AND current_runs_per_week >= 0) OR (current_runs_status <> 'known' AND current_runs_per_week IS NULL)),
 CHECK ((longest_run_status = 'known' AND longest_run_metres IS NOT NULL AND longest_run_metres >= 0) OR (longest_run_status <> 'known' AND longest_run_metres IS NULL)),
 CHECK ((confirmed_hash IS NULL AND confirmed_at IS NULL) OR (confirmed_hash IS NOT NULL AND confirmed_at IS NOT NULL)),
 UNIQUE(plan_version_id, lineage_id)
);
CREATE TABLE plan_brief_weekdays (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lineage_id uuid NOT NULL DEFAULT gen_random_uuid(),
 plan_version_id uuid NOT NULL REFERENCES plan_versions(id),
 weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 availability text NOT NULL CHECK (availability IN ('available','preferred','unavailable')),
 UNIQUE(plan_version_id, weekday),
 UNIQUE(plan_version_id, lineage_id)
);
CREATE TRIGGER protect_content BEFORE INSERT OR UPDATE OR DELETE ON plan_briefs
 FOR EACH ROW EXECUTE FUNCTION guard_plan_content();
CREATE TRIGGER protect_content BEFORE INSERT OR UPDATE OR DELETE ON plan_brief_weekdays
 FOR EACH ROW EXECUTE FUNCTION guard_plan_content();

ALTER TABLE calibration_profiles
 ADD COLUMN race_distance_metres numeric(14,3),
 ADD COLUMN race_duration_seconds integer,
 ADD COLUMN threshold_seconds_per_kilometre numeric(14,6),
 ADD COLUMN calculator_version text NOT NULL,
 DROP COLUMN source_description,
 ADD CONSTRAINT running_calibration_input CHECK (
  discipline = 'run' AND system = 'run_pace' AND
  ((method = 'race_result' AND race_distance_metres IS NOT NULL AND race_distance_metres BETWEEN 1609.344 AND 42195
    AND race_duration_seconds IS NOT NULL AND race_duration_seconds > 0 AND threshold_seconds_per_kilometre IS NULL)
   OR (method = 'threshold_pace' AND threshold_seconds_per_kilometre IS NOT NULL AND threshold_seconds_per_kilometre > 0
    AND race_distance_metres IS NULL AND race_duration_seconds IS NULL))
 );
ALTER TABLE calibration_zones ADD CONSTRAINT running_pace_zone CHECK (
 zone_key IN ('easy','marathon','threshold','interval','repetition') AND
 metric = 'pace' AND unit = 'seconds_per_kilometre' AND
 minimum_value IS NOT NULL AND target_value IS NOT NULL AND maximum_value IS NOT NULL AND
 minimum_value > 0 AND minimum_value <= target_value AND target_value <= maximum_value
);
