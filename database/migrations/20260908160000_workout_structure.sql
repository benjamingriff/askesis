-- Deferred checks allow a prescription to be assembled/rearranged transactionally,
-- but never leave an invalid local tree committed (including in a draft).
CREATE FUNCTION assert_workout_structure(workout uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE total integer; reached integer;
BEGIN
    IF workout IS NULL OR NOT EXISTS (SELECT 1 FROM workouts WHERE id = workout) THEN RETURN; END IF;
    SELECT count(*) INTO total FROM workout_steps WHERE workout_id = workout;
    IF (SELECT count(*) FROM workout_steps WHERE workout_id = workout AND parent_step_id IS NULL) <> 1 THEN
        RAISE EXCEPTION 'Workout needs exactly one prescription root' USING ERRCODE = '23514';
    END IF;
    WITH RECURSIVE reachable(id) AS (
        SELECT id FROM workout_steps WHERE workout_id = workout AND parent_step_id IS NULL
        UNION
        SELECT child.id FROM workout_steps child JOIN reachable parent ON child.parent_step_id = parent.id
        WHERE child.workout_id = workout
    ) SELECT count(*) INTO reached FROM reachable;
    IF reached <> total THEN RAISE EXCEPTION 'Workout has disconnected or cyclic steps' USING ERRCODE = '23514'; END IF;
    IF EXISTS (
        SELECT 1 FROM workout_steps s WHERE s.workout_id = workout AND (
            (s.kind = 'effort' AND (
                s.discipline IS NULL OR length(trim(s.discipline)) = 0
                OR NOT EXISTS (SELECT 1 FROM step_completions c WHERE c.step_id = s.id)
                OR EXISTS (SELECT 1 FROM workout_steps child WHERE child.parent_step_id = s.id)
            )) OR (s.kind <> 'effort' AND (
                NOT EXISTS (SELECT 1 FROM workout_steps child WHERE child.parent_step_id = s.id)
                OR EXISTS (SELECT 1 FROM step_completions c WHERE c.step_id = s.id)
                OR EXISTS (SELECT 1 FROM step_targets t WHERE t.step_id = s.id)
            ))
        )
    ) THEN RAISE EXCEPTION 'Invalid effort or container prescription' USING ERRCODE = '23514'; END IF;
END $$;

CREATE FUNCTION guard_workout_structure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_workout uuid; new_workout uuid;
BEGIN
    IF TG_TABLE_NAME = 'workouts' THEN
        IF TG_OP <> 'INSERT' THEN old_workout := OLD.id; END IF;
        IF TG_OP <> 'DELETE' THEN new_workout := NEW.id; END IF;
    ELSIF TG_TABLE_NAME = 'workout_steps' THEN
        IF TG_OP <> 'INSERT' THEN old_workout := OLD.workout_id; END IF;
        IF TG_OP <> 'DELETE' THEN new_workout := NEW.workout_id; END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN SELECT workout_id INTO old_workout FROM workout_steps WHERE id = OLD.step_id; END IF;
        IF TG_OP <> 'DELETE' THEN SELECT workout_id INTO new_workout FROM workout_steps WHERE id = NEW.step_id; END IF;
    END IF;
    PERFORM assert_workout_structure(old_workout);
    IF new_workout IS DISTINCT FROM old_workout THEN PERFORM assert_workout_structure(new_workout); END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER check_workout_structure AFTER INSERT OR UPDATE OR DELETE ON workouts
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workout_structure();
CREATE CONSTRAINT TRIGGER check_step_structure AFTER INSERT OR UPDATE OR DELETE ON workout_steps
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workout_structure();
CREATE CONSTRAINT TRIGGER check_completion_structure AFTER INSERT OR UPDATE OR DELETE ON step_completions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workout_structure();
CREATE CONSTRAINT TRIGGER check_target_structure AFTER INSERT OR UPDATE OR DELETE ON step_targets
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workout_structure();

ALTER TABLE step_completions ADD CONSTRAINT completion_units CHECK (
    (completion_type = 'duration' AND unit IN ('seconds', 'minutes', 'hours'))
    OR (completion_type = 'distance' AND unit IN ('metres', 'kilometres', 'miles'))
    OR (completion_type = 'repetitions' AND unit = 'repetitions')
    OR (completion_type = 'energy' AND unit IN ('kilocalories', 'kilojoules'))
    OR (completion_type IN ('until_lap', 'open') AND unit IS NULL)
    OR (completion_type = 'until_condition' AND unit IS NULL AND length(trim(condition_type)) > 0)
);
ALTER TABLE step_targets ADD CONSTRAINT target_nonnegative CHECK (
    (minimum_value IS NULL OR minimum_value >= 0) AND
    (target_value IS NULL OR target_value >= 0) AND
    (maximum_value IS NULL OR maximum_value >= 0)
);
ALTER TABLE step_targets ADD CONSTRAINT target_labels_not_blank CHECK (
    (unit IS NULL OR length(trim(unit)) > 0) AND
    (zone_system IS NULL OR length(trim(zone_system)) > 0) AND
    (zone_key IS NULL OR length(trim(zone_key)) > 0)
);

-- Reject pre-existing malformed local trees rather than silently publishing them.
ALTER TABLE calibration_profiles ADD CONSTRAINT profile_id_system_key UNIQUE (id, system);
ALTER TABLE plan_calibration_periods ADD CONSTRAINT period_profile_system_fk
    FOREIGN KEY (profile_id, system) REFERENCES calibration_profiles(id, system)
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION valid_target_unit(metric text, unit text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE metric
        WHEN 'pace' THEN unit IN ('seconds_per_kilometre', 'seconds_per_mile')
        WHEN 'speed' THEN unit IN ('metres_per_second', 'kilometres_per_hour', 'miles_per_hour')
        WHEN 'heart_rate' THEN unit = 'beats_per_minute'
        WHEN 'power' THEN unit = 'watts'
        WHEN 'cadence' THEN unit IN ('steps_per_minute', 'revolutions_per_minute')
        WHEN 'rpe' THEN unit = 'rpe'
        WHEN 'load' THEN unit IN ('kilograms', 'pounds')
        WHEN 'percentage_1rm' THEN unit = 'percent'
        WHEN 'rir' THEN unit = 'repetitions'
        ELSE false
    END
$$;
ALTER TABLE step_targets ADD CONSTRAINT numeric_target_units CHECK (
    target_type IN ('zone', 'tempo', 'instruction') OR valid_target_unit(target_type, unit)
);
ALTER TABLE calibration_zones ADD CONSTRAINT calibration_zone_units CHECK (valid_target_unit(metric, unit));

DO $$ DECLARE workout uuid; BEGIN
    FOR workout IN SELECT id FROM workouts LOOP PERFORM assert_workout_structure(workout); END LOOP;
END $$;
