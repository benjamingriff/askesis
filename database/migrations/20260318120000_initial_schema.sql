-- Initial normalised training plan schema.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE athletes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    slug text NOT NULL,
    title text NOT NULL CHECK (length(trim(title)) > 0),
    description text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plans_valid_dates CHECK (end_date >= start_date),
    CONSTRAINT plans_owner_slug_key UNIQUE (owner_id, slug)
);

CREATE TABLE plan_goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    goal_type text NOT NULL CHECK (goal_type IN ('race', 'performance', 'consistency', 'fitness', 'other')),
    priority text NOT NULL CHECK (priority IN ('primary', 'secondary', 'stretch')),
    discipline text,
    event_name text,
    event_date date,
    distance_value numeric(12,3) CHECK (distance_value > 0),
    distance_unit text CHECK (distance_unit IN ('metres', 'kilometres', 'miles')),
    target_duration_seconds integer CHECK (target_duration_seconds > 0),
    description text,
    CONSTRAINT plan_goals_distance_complete CHECK (
        (distance_value IS NULL AND distance_unit IS NULL)
        OR (distance_value IS NOT NULL AND distance_unit IS NOT NULL)
    )
);
CREATE INDEX plan_goals_plan_idx ON plan_goals(plan_id);

CREATE TABLE plan_constraints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    constraint_type text NOT NULL CHECK (constraint_type IN (
        'weekly_duration_max', 'weekly_distance_max', 'hard_sessions_max',
        'preferred_rest_day', 'required_rest_day', 'long_workout_duration_max',
        'recovery_week_frequency', 'other'
    )),
    severity text NOT NULL CHECK (severity IN ('hard', 'soft', 'target')),
    discipline text,
    numeric_value numeric(12,3),
    unit text,
    day_of_week smallint CHECK (day_of_week BETWEEN 1 AND 7),
    description text
);
CREATE INDEX plan_constraints_plan_idx ON plan_constraints(plan_id);

CREATE TABLE training_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    title text NOT NULL,
    description text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    CONSTRAINT training_blocks_valid_dates CHECK (end_date >= start_date),
    CONSTRAINT training_blocks_plan_position_key UNIQUE (plan_id, position),
    CONSTRAINT training_blocks_id_plan_key UNIQUE (id, plan_id)
);
CREATE INDEX training_blocks_plan_dates_idx ON training_blocks(plan_id, start_date, end_date);

CREATE TABLE training_weeks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    block_id uuid NOT NULL,
    week_number integer NOT NULL CHECK (week_number > 0),
    position integer NOT NULL CHECK (position > 0),
    title text NOT NULL,
    description text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    CONSTRAINT training_weeks_valid_dates CHECK (end_date >= start_date),
    CONSTRAINT training_weeks_block_fk FOREIGN KEY (block_id, plan_id)
        REFERENCES training_blocks(id, plan_id) ON DELETE CASCADE,
    CONSTRAINT training_weeks_plan_number_key UNIQUE (plan_id, week_number),
    CONSTRAINT training_weeks_block_position_key UNIQUE (block_id, position),
    CONSTRAINT training_weeks_id_plan_key UNIQUE (id, plan_id)
);
CREATE INDEX training_weeks_plan_dates_idx ON training_weeks(plan_id, start_date, end_date);

CREATE TABLE week_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    week_id uuid NOT NULL REFERENCES training_weeks(id) ON DELETE CASCADE,
    metric text NOT NULL CHECK (metric IN (
        'distance', 'duration', 'hard_session_count', 'strength_session_count', 'training_load'
    )),
    discipline text,
    minimum_value numeric(12,3),
    target_value numeric(12,3),
    maximum_value numeric(12,3),
    unit text NOT NULL,
    CONSTRAINT week_targets_has_value CHECK (
        minimum_value IS NOT NULL OR target_value IS NOT NULL OR maximum_value IS NOT NULL
    ),
    CONSTRAINT week_targets_valid_range CHECK (
        (minimum_value IS NULL OR target_value IS NULL OR minimum_value <= target_value)
        AND (target_value IS NULL OR maximum_value IS NULL OR target_value <= maximum_value)
        AND (minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value)
    ),
    CONSTRAINT week_targets_unique_metric UNIQUE NULLS NOT DISTINCT (week_id, metric, discipline)
);

CREATE TABLE movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    category text NOT NULL,
    primary_discipline text NOT NULL DEFAULT 'strength',
    instructions text
);

CREATE TABLE workouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    week_id uuid NOT NULL,
    scheduled_date date NOT NULL,
    position integer NOT NULL CHECK (position > 0),
    title text NOT NULL,
    description text,
    purpose text,
    primary_discipline text NOT NULL,
    priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    estimated_duration_seconds integer CHECK (estimated_duration_seconds > 0),
    estimated_distance_metres numeric(12,3) CHECK (estimated_distance_metres > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workouts_week_fk FOREIGN KEY (week_id, plan_id)
        REFERENCES training_weeks(id, plan_id) ON DELETE CASCADE,
    CONSTRAINT workouts_plan_date_position_key UNIQUE (plan_id, scheduled_date, position)
);
CREATE INDEX workouts_plan_date_idx ON workouts(plan_id, scheduled_date);
CREATE INDEX workouts_week_idx ON workouts(week_id, position);

CREATE TABLE workout_tags (
    workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    tag text NOT NULL CHECK (length(trim(tag)) > 0),
    PRIMARY KEY (workout_id, tag)
);
CREATE INDEX workout_tags_tag_idx ON workout_tags(tag);

CREATE TABLE workout_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    parent_step_id uuid,
    position integer NOT NULL CHECK (position > 0),
    kind text NOT NULL CHECK (kind IN ('sequence', 'repeat', 'effort')),
    role text CHECK (role IN ('warmup', 'work', 'recovery', 'cooldown', 'transition', 'main', 'other')),
    discipline text,
    movement_id uuid REFERENCES movements(id),
    repeat_count integer,
    label text,
    instructions text,
    CONSTRAINT workout_steps_id_workout_key UNIQUE (id, workout_id),
    CONSTRAINT workout_steps_parent_fk FOREIGN KEY (parent_step_id, workout_id)
        REFERENCES workout_steps(id, workout_id) ON DELETE CASCADE,
    CONSTRAINT workout_steps_repeat_count CHECK (
        (kind = 'repeat' AND repeat_count IS NOT NULL AND repeat_count > 0)
        OR (kind <> 'repeat' AND repeat_count IS NULL)
    ),
    CONSTRAINT workout_steps_movement_effort CHECK (movement_id IS NULL OR kind = 'effort'),
    CONSTRAINT workout_steps_sibling_position_key UNIQUE NULLS NOT DISTINCT
        (workout_id, parent_step_id, position)
);
CREATE INDEX workout_steps_workout_idx ON workout_steps(workout_id);
CREATE INDEX workout_steps_parent_position_idx ON workout_steps(parent_step_id, position);
CREATE UNIQUE INDEX workout_steps_one_root_idx ON workout_steps(workout_id) WHERE parent_step_id IS NULL;

CREATE TABLE step_completions (
    step_id uuid PRIMARY KEY REFERENCES workout_steps(id) ON DELETE CASCADE,
    completion_type text NOT NULL CHECK (completion_type IN (
        'duration', 'distance', 'repetitions', 'energy', 'until_lap', 'until_condition', 'open'
    )),
    numeric_value numeric(12,3),
    unit text,
    condition_type text,
    condition_value text,
    CONSTRAINT step_completions_value_shape CHECK (
        (completion_type IN ('duration', 'distance', 'repetitions', 'energy')
            AND numeric_value IS NOT NULL AND numeric_value > 0 AND unit IS NOT NULL)
        OR (completion_type IN ('until_lap', 'open')
            AND numeric_value IS NULL AND unit IS NULL)
        OR (completion_type = 'until_condition'
            AND condition_type IS NOT NULL AND numeric_value IS NULL)
    )
);

CREATE TABLE step_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id uuid NOT NULL REFERENCES workout_steps(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    target_type text NOT NULL CHECK (target_type IN (
        'zone', 'pace', 'speed', 'heart_rate', 'power', 'cadence', 'rpe',
        'load', 'percentage_1rm', 'rir', 'tempo', 'instruction'
    )),
    minimum_value numeric(12,3),
    target_value numeric(12,3),
    maximum_value numeric(12,3),
    unit text,
    zone_system text,
    zone_key text,
    text_value text,
    CONSTRAINT step_targets_step_position_key UNIQUE (step_id, position),
    CONSTRAINT step_targets_valid_range CHECK (
        (minimum_value IS NULL OR target_value IS NULL OR minimum_value <= target_value)
        AND (target_value IS NULL OR maximum_value IS NULL OR target_value <= maximum_value)
        AND (minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value)
    ),
    CONSTRAINT step_targets_value_shape CHECK (
        (target_type = 'zone' AND zone_system IS NOT NULL AND zone_key IS NOT NULL)
        OR (target_type IN ('tempo', 'instruction') AND text_value IS NOT NULL)
        OR (target_type NOT IN ('zone', 'tempo', 'instruction')
            AND (minimum_value IS NOT NULL OR target_value IS NOT NULL OR maximum_value IS NOT NULL)
            AND unit IS NOT NULL)
    )
);
CREATE INDEX step_targets_step_idx ON step_targets(step_id, position);
CREATE INDEX step_targets_zone_idx ON step_targets(zone_system, zone_key) WHERE target_type = 'zone';

CREATE TABLE calibration_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    discipline text NOT NULL,
    system text NOT NULL,
    method text NOT NULL,
    fitness_value numeric(12,3),
    source_description text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calibration_profiles_owner_system_idx ON calibration_profiles(owner_id, system, created_at);

CREATE TABLE calibration_zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES calibration_profiles(id) ON DELETE CASCADE,
    zone_key text NOT NULL,
    metric text NOT NULL,
    minimum_value numeric(12,3),
    target_value numeric(12,3),
    maximum_value numeric(12,3),
    unit text NOT NULL,
    CONSTRAINT calibration_zones_has_value CHECK (
        minimum_value IS NOT NULL OR target_value IS NOT NULL OR maximum_value IS NOT NULL
    ),
    CONSTRAINT calibration_zones_valid_range CHECK (
        (minimum_value IS NULL OR target_value IS NULL OR minimum_value <= target_value)
        AND (target_value IS NULL OR maximum_value IS NULL OR target_value <= maximum_value)
        AND (minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value)
    ),
    CONSTRAINT calibration_zones_profile_zone_metric_key UNIQUE (profile_id, zone_key, metric)
);

CREATE TABLE plan_calibration_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES calibration_profiles(id),
    system text NOT NULL,
    effective_from date NOT NULL,
    effective_until date,
    CONSTRAINT plan_calibration_periods_valid_dates CHECK (
        effective_until IS NULL OR effective_until > effective_from
    ),
    CONSTRAINT plan_calibration_periods_no_overlap EXCLUDE USING gist (
        plan_id WITH =,
        system WITH =,
        daterange(effective_from, effective_until, '[)') WITH &&
    )
);
CREATE INDEX plan_calibration_periods_lookup_idx
    ON plan_calibration_periods(plan_id, system, effective_from);

-- Records one-time development seeds. Application data should not depend on this table.
CREATE TABLE seed_runs (
    seed_key text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- Expand repetition counts while preserving each effort's discipline.
CREATE VIEW workout_prescription_totals AS
WITH RECURSIVE expanded_steps AS (
    SELECT
        ws.id,
        ws.workout_id,
        ws.parent_step_id,
        ws.kind,
        ws.discipline,
        ws.repeat_count,
        1::bigint AS occurrence_multiplier
    FROM workout_steps ws
    WHERE ws.parent_step_id IS NULL

    UNION ALL

    SELECT
        child.id,
        child.workout_id,
        child.parent_step_id,
        child.kind,
        child.discipline,
        child.repeat_count,
        parent.occurrence_multiplier
            * CASE WHEN parent.kind = 'repeat' THEN parent.repeat_count ELSE 1 END
    FROM expanded_steps parent
    JOIN workout_steps child ON child.parent_step_id = parent.id
)
SELECT
    es.workout_id,
    es.discipline,
    COALESCE(sum(sc.numeric_value * es.occurrence_multiplier)
        FILTER (WHERE sc.completion_type = 'duration' AND sc.unit = 'seconds'), 0) AS duration_seconds,
    COALESCE(sum(sc.numeric_value * es.occurrence_multiplier)
        FILTER (WHERE sc.completion_type = 'distance' AND sc.unit = 'metres'), 0) AS distance_metres,
    COALESCE(sum(sc.numeric_value * es.occurrence_multiplier)
        FILTER (WHERE sc.completion_type = 'repetitions' AND sc.unit = 'repetitions'), 0) AS repetitions
FROM expanded_steps es
JOIN step_completions sc ON sc.step_id = es.id
WHERE es.kind = 'effort'
GROUP BY es.workout_id, es.discipline;

CREATE VIEW weekly_plan_summary AS
SELECT
    tw.id AS week_id,
    tw.plan_id,
    tw.week_number,
    tw.title,
    tw.start_date,
    tw.end_date,
    count(DISTINCT w.id) AS workout_count,
    COALESCE(sum(w.estimated_duration_seconds), 0) AS estimated_duration_seconds,
    COALESCE(sum(w.estimated_distance_metres)
        FILTER (WHERE w.primary_discipline = 'run'), 0) AS estimated_run_distance_metres,
    COALESCE(sum(w.estimated_distance_metres)
        FILTER (WHERE w.primary_discipline = 'cycle'), 0) AS estimated_cycle_distance_metres,
    COALESCE(sum(w.estimated_distance_metres)
        FILTER (WHERE w.primary_discipline = 'swim'), 0) AS estimated_swim_distance_metres
FROM training_weeks tw
LEFT JOIN workouts w ON w.week_id = tw.id
GROUP BY tw.id, tw.plan_id, tw.week_number, tw.title, tw.start_date, tw.end_date;
