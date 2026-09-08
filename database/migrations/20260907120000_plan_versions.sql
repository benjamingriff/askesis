-- Intentional pre-alpha plan-domain reset. Athlete identities are preserved.
DROP VIEW weekly_plan_summary;
DROP VIEW workout_prescription_totals;
DROP TABLE plan_memberships;
TRUNCATE plans, plan_goals, plan_constraints, training_blocks, training_weeks,
    week_targets, workouts, workout_tags, workout_steps, step_completions,
    step_targets, calibration_profiles, calibration_zones, plan_calibration_periods,
    movements;
DELETE FROM seed_runs WHERE seed_key = 'cardiff-half-example-v1';

ALTER TABLE plans
    DROP CONSTRAINT plans_owner_slug_key,
    DROP CONSTRAINT plans_valid_dates,
    DROP COLUMN slug,
    DROP COLUMN description,
    DROP COLUMN start_date,
    DROP COLUMN end_date,
    DROP COLUMN status,
    DROP COLUMN schema_version;
ALTER TABLE plans RENAME COLUMN title TO display_name;
ALTER TABLE plans
    ADD COLUMN state_version integer NOT NULL DEFAULT 1 CHECK (state_version > 0),
    ADD COLUMN current_locked_version_id uuid,
    ADD COLUMN current_draft_version_id uuid,
    ADD COLUMN activated_at timestamptz,
    ADD COLUMN archived_at timestamptz,
    ADD CONSTRAINT plans_active_locked CHECK (activated_at IS NULL OR current_locked_version_id IS NOT NULL),
    ADD CONSTRAINT plans_archive_inactive CHECK (archived_at IS NULL OR activated_at IS NULL);
CREATE INDEX plans_owner_idx ON plans(owner_id);

CREATE TABLE plan_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'locked')),
    version_number integer CHECK (version_number > 0),
    edit_number integer NOT NULL DEFAULT 1 CHECK (edit_number > 0),
    description text,
    start_date date,
    end_date date,
    based_on_version_id uuid,
    supersedes_version_id uuid,
    content_schema_version integer NOT NULL DEFAULT 1 CHECK (content_schema_version > 0),
    content_hash text CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    content_hash_version integer CHECK (content_hash_version > 0),
    validator_version integer CHECK (validator_version > 0),
    validation_findings jsonb,
    acknowledged_warning_codes text[],
    change_summary jsonb,
    locked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, plan_id),
    UNIQUE (plan_id, version_number),
    FOREIGN KEY (based_on_version_id, plan_id) REFERENCES plan_versions(id, plan_id),
    FOREIGN KEY (supersedes_version_id, plan_id) REFERENCES plan_versions(id, plan_id),
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
    CHECK (
        (state = 'draft' AND version_number IS NULL AND locked_at IS NULL
            AND content_hash IS NULL AND content_hash_version IS NULL
            AND validator_version IS NULL AND validation_findings IS NULL
            AND acknowledged_warning_codes IS NULL AND change_summary IS NULL)
        OR
        (state = 'locked' AND version_number IS NOT NULL AND locked_at IS NOT NULL
            AND start_date IS NOT NULL AND end_date IS NOT NULL
            AND content_hash IS NOT NULL AND content_hash_version IS NOT NULL
            AND validator_version IS NOT NULL AND validation_findings IS NOT NULL
            AND jsonb_typeof(validation_findings) = 'array'
            AND acknowledged_warning_codes IS NOT NULL AND change_summary IS NOT NULL)
    )
);
CREATE UNIQUE INDEX plan_versions_one_draft ON plan_versions(plan_id) WHERE state = 'draft';
ALTER TABLE plans
    ADD FOREIGN KEY (current_locked_version_id, id) REFERENCES plan_versions(id, plan_id) DEFERRABLE INITIALLY DEFERRED,
    ADD FOREIGN KEY (current_draft_version_id, id) REFERENCES plan_versions(id, plan_id) DEFERRABLE INITIALLY DEFERRED;

-- Reuse existing local value constraints; move ownership to the version root.
DO $$
DECLARE t text; c record;
BEGIN
    FOREACH t IN ARRAY ARRAY['plan_goals', 'plan_constraints', 'training_blocks',
        'training_weeks', 'workouts', 'plan_calibration_periods'] LOOP
        FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = t::regclass AND confrelid = 'plans'::regclass LOOP
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c.conname);
        END LOOP;
        EXECUTE format('ALTER TABLE %I RENAME COLUMN plan_id TO plan_version_id', t);
        EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id)', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['week_targets', 'workout_tags', 'workout_steps',
        'step_completions', 'step_targets', 'calibration_profiles', 'calibration_zones'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN plan_version_id uuid NOT NULL REFERENCES plan_versions(id)', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['plan_goals', 'plan_constraints', 'training_blocks',
        'training_weeks', 'week_targets', 'workouts', 'workout_steps', 'step_targets',
        'calibration_profiles', 'calibration_zones', 'plan_calibration_periods'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN lineage_id uuid NOT NULL DEFAULT gen_random_uuid()', t);
        EXECUTE format('ALTER TABLE %I ADD UNIQUE (plan_version_id, lineage_id)', t);
        -- A uniform referenced key supports same-version child foreign keys.
        EXECUTE format('CREATE UNIQUE INDEX %I ON %I (id, plan_version_id)', t || '_version_identity', t);
    END LOOP;
END $$;
ALTER TABLE calibration_profiles DROP COLUMN owner_id;
ALTER TABLE week_targets ADD FOREIGN KEY (week_id, plan_version_id) REFERENCES training_weeks(id, plan_version_id);
ALTER TABLE workout_tags ADD FOREIGN KEY (workout_id, plan_version_id) REFERENCES workouts(id, plan_version_id);
ALTER TABLE workout_steps ADD FOREIGN KEY (workout_id, plan_version_id) REFERENCES workouts(id, plan_version_id);
ALTER TABLE step_completions ADD FOREIGN KEY (step_id, plan_version_id) REFERENCES workout_steps(id, plan_version_id);
ALTER TABLE step_targets ADD FOREIGN KEY (step_id, plan_version_id) REFERENCES workout_steps(id, plan_version_id);
ALTER TABLE calibration_zones ADD FOREIGN KEY (profile_id, plan_version_id) REFERENCES calibration_profiles(id, plan_version_id);
ALTER TABLE plan_calibration_periods ADD FOREIGN KEY (profile_id, plan_version_id) REFERENCES calibration_profiles(id, plan_version_id);

ALTER TABLE movements RENAME TO movement_definitions;
ALTER TABLE movement_definitions DROP CONSTRAINT movements_name_key;
ALTER TABLE movement_definitions
    ADD COLUMN lineage_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN definition_number integer NOT NULL DEFAULT 1 CHECK (definition_number > 0),
    ADD COLUMN supersedes_definition_id uuid,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD UNIQUE (lineage_id, definition_number),
    ADD UNIQUE (id, lineage_id),
    ADD FOREIGN KEY (supersedes_definition_id, lineage_id) REFERENCES movement_definitions(id, lineage_id);

CREATE TABLE api_idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id),
    command_scope text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 299),
    response_body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    UNIQUE (athlete_id, command_scope, idempotency_key)
);

-- Every writer acquires the same plan lock before inspecting publication state.
-- Checking OLD as well as NEW prevents moving protected rows into another draft.
CREATE FUNCTION guard_plan_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id uuid; target_plan uuid; version_state text; archived timestamptz;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.plan_version_id <> OLD.plan_version_id THEN
        RAISE EXCEPTION 'Content cannot change version ownership' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN version_id := OLD.plan_version_id;
    ELSE version_id := NEW.plan_version_id; END IF;
    SELECT plan_id INTO target_plan FROM plan_versions WHERE id = version_id;
    SELECT archived_at INTO archived FROM plans WHERE id = target_plan FOR UPDATE;
    SELECT state INTO version_state FROM plan_versions WHERE id = version_id FOR UPDATE;
    IF version_state IS DISTINCT FROM 'draft' OR archived IS NOT NULL THEN
        RAISE EXCEPTION 'Plan content is read-only' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION guard_plan_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_plan uuid; archived timestamptz;
BEGIN
    IF TG_OP = 'DELETE' THEN target_plan := OLD.plan_id; ELSE target_plan := NEW.plan_id; END IF;
    SELECT archived_at INTO archived FROM plans WHERE id = target_plan FOR UPDATE;
    IF archived IS NOT NULL THEN
        RAISE EXCEPTION 'Archived plan is read-only' USING ERRCODE = '23514';
    END IF;
    IF TG_OP <> 'INSERT' THEN
        IF OLD.state = 'locked' THEN
            RAISE EXCEPTION 'Locked version is immutable' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.plan_id <> OLD.plan_id) THEN
            RAISE EXCEPTION 'Version identity is immutable' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.state <> 'draft' THEN
        RAISE EXCEPTION 'Versions must start as drafts' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER protect_plan_version BEFORE INSERT OR UPDATE OR DELETE ON plan_versions
    FOR EACH ROW EXECUTE FUNCTION guard_plan_version();

CREATE FUNCTION check_plan_pointers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_plan uuid; p plans; v plan_versions;
BEGIN
    IF TG_TABLE_NAME = 'plans' THEN target_plan := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN target_plan := OLD.plan_id;
    ELSE target_plan := NEW.plan_id; END IF;
    SELECT * INTO p FROM plans WHERE id = target_plan;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF p.current_locked_version_id IS NULL AND p.current_draft_version_id IS NULL THEN
        RAISE EXCEPTION 'Plan requires a current version' USING ERRCODE = '23514';
    END IF;
    IF p.current_locked_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM plan_versions WHERE id = p.current_locked_version_id AND plan_id = p.id AND state = 'locked'
    ) THEN RAISE EXCEPTION 'Invalid locked pointer' USING ERRCODE = '23514'; END IF;
    IF p.current_draft_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM plan_versions WHERE id = p.current_draft_version_id AND plan_id = p.id AND state = 'draft'
    ) THEN RAISE EXCEPTION 'Invalid draft pointer' USING ERRCODE = '23514'; END IF;
    FOR v IN SELECT * FROM plan_versions WHERE plan_id = p.id LOOP
        IF v.state = 'draft' AND v.id IS DISTINCT FROM p.current_draft_version_id THEN
            RAISE EXCEPTION 'Orphan draft' USING ERRCODE = '23514';
        END IF;
        IF v.based_on_version_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM plan_versions WHERE id = v.based_on_version_id AND state = 'locked' AND id <> v.id
        ) THEN RAISE EXCEPTION 'Invalid base version' USING ERRCODE = '23514'; END IF;
        IF v.supersedes_version_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM plan_versions WHERE id = v.supersedes_version_id AND state = 'locked' AND id <> v.id
        ) THEN RAISE EXCEPTION 'Invalid superseded version' USING ERRCODE = '23514'; END IF;
    END LOOP;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER plan_pointer_integrity AFTER INSERT OR UPDATE ON plans
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_plan_pointers();
CREATE CONSTRAINT TRIGGER version_pointer_integrity AFTER INSERT OR UPDATE OR DELETE ON plan_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_plan_pointers();

CREATE FUNCTION guard_archived_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id THEN
        RAISE EXCEPTION 'Plan identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.archived_at IS NOT NULL AND (
        NEW.archived_at IS NOT NULL OR NEW.display_name <> OLD.display_name
        OR NEW.current_locked_version_id IS DISTINCT FROM OLD.current_locked_version_id
        OR NEW.current_draft_version_id IS DISTINCT FROM OLD.current_draft_version_id
        OR NEW.activated_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'Archived plan is read-only' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER protect_archived_plan BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION guard_archived_plan();

CREATE FUNCTION guard_movement_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Movement definition is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER protect_movement_definition BEFORE UPDATE ON movement_definitions
    FOR EACH ROW EXECUTE FUNCTION guard_movement_definition();

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['plan_goals', 'plan_constraints', 'training_blocks',
        'training_weeks', 'week_targets', 'workouts', 'workout_tags', 'workout_steps',
        'step_completions', 'step_targets', 'calibration_profiles', 'calibration_zones',
        'plan_calibration_periods'] LOOP
        EXECUTE format('CREATE TRIGGER protect_content BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_plan_content()', t);
    END LOOP;
END $$;

CREATE VIEW workout_prescription_totals AS
WITH RECURSIVE expanded AS (
    SELECT s.*, 1::bigint AS multiplier FROM workout_steps s WHERE parent_step_id IS NULL
    UNION ALL
    SELECT s.*, p.multiplier * CASE WHEN p.kind = 'repeat' THEN p.repeat_count ELSE 1 END
    FROM workout_steps s JOIN expanded p ON s.parent_step_id = p.id
)
SELECT e.plan_version_id, e.workout_id, e.discipline,
    COALESCE(sum(c.numeric_value * e.multiplier) FILTER (WHERE c.completion_type = 'duration' AND c.unit = 'seconds'), 0) AS duration_seconds,
    COALESCE(sum(c.numeric_value * e.multiplier) FILTER (WHERE c.completion_type = 'distance' AND c.unit = 'metres'), 0) AS distance_metres,
    COALESCE(sum(c.numeric_value * e.multiplier) FILTER (WHERE c.completion_type = 'repetitions' AND c.unit = 'repetitions'), 0) AS repetitions
FROM expanded e JOIN step_completions c ON c.step_id = e.id
WHERE e.kind = 'effort' GROUP BY e.plan_version_id, e.workout_id, e.discipline;

CREATE VIEW weekly_plan_summary AS
SELECT tw.id AS week_id, tw.plan_version_id, tw.week_number, tw.title, tw.start_date, tw.end_date,
    count(w.id) AS workout_count,
    COALESCE(sum(w.estimated_duration_seconds), 0) AS estimated_duration_seconds,
    COALESCE(sum(w.estimated_distance_metres) FILTER (WHERE w.primary_discipline = 'run'), 0) AS estimated_run_distance_metres,
    COALESCE(sum(w.estimated_distance_metres) FILTER (WHERE w.primary_discipline = 'cycle'), 0) AS estimated_cycle_distance_metres,
    COALESCE(sum(w.estimated_distance_metres) FILTER (WHERE w.primary_discipline = 'swim'), 0) AS estimated_swim_distance_metres
FROM training_weeks tw LEFT JOIN workouts w ON w.week_id = tw.id
GROUP BY tw.id;
