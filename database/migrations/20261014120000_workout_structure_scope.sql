-- Bound each deferred check to one workout. Scalar index probes avoid hashed
-- existence subplans that repeatedly scan all prescriptions as examples grow.
CREATE OR REPLACE FUNCTION assert_workout_structure(workout uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE total integer; reached integer;
BEGIN
    IF workout IS NULL OR NOT EXISTS (SELECT 1 FROM workouts WHERE id = workout) THEN RETURN; END IF;
    SELECT count(*) INTO total FROM workout_steps WHERE workout_id = workout;
    IF (SELECT count(*) FROM workout_steps WHERE workout_id = workout AND parent_step_id IS NULL) <> 1 THEN
        RAISE EXCEPTION 'Workout needs exactly one prescription root' USING ERRCODE = '23514';
    END IF;
    WITH RECURSIVE local_steps AS MATERIALIZED (
        SELECT id, parent_step_id FROM workout_steps WHERE workout_id = workout
    ), reachable(id) AS (
        SELECT id FROM local_steps WHERE parent_step_id IS NULL
        UNION
        SELECT child.id FROM local_steps child JOIN reachable parent ON child.parent_step_id = parent.id
    ) SELECT count(*) INTO reached FROM reachable;
    IF reached <> total THEN RAISE EXCEPTION 'Workout has disconnected or cyclic steps' USING ERRCODE = '23514'; END IF;
    IF EXISTS (
        SELECT 1 FROM workout_steps s WHERE s.workout_id = workout AND (
            (s.kind = 'effort' AND (
                s.discipline IS NULL OR length(trim(s.discipline)) = 0
                OR (SELECT true FROM step_completions c WHERE c.step_id = s.id LIMIT 1) IS NOT TRUE
                OR (SELECT true FROM workout_steps child WHERE child.parent_step_id = s.id LIMIT 1) IS TRUE
            )) OR (s.kind <> 'effort' AND (
                (SELECT true FROM workout_steps child WHERE child.parent_step_id = s.id LIMIT 1) IS NOT TRUE
                OR (SELECT true FROM step_completions c WHERE c.step_id = s.id LIMIT 1) IS TRUE
                OR (SELECT true FROM step_targets t WHERE t.step_id = s.id LIMIT 1) IS TRUE
            ))
        )
    ) THEN RAISE EXCEPTION 'Invalid effort or container prescription' USING ERRCODE = '23514'; END IF;
END $$;
