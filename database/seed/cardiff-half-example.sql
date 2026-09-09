BEGIN;

INSERT INTO athletes (id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Ben') ON CONFLICT (id) DO NOTHING;

INSERT INTO plans (id, owner_id, display_name, current_draft_version_id)
VALUES ('00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001', 'Cardiff Half Marathon 2026',
    '00000000-0000-0000-0000-000000000050');
INSERT INTO plan_versions (id, plan_id, description, start_date, end_date)
VALUES ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000010',
    'A shortened relational example based on the original 21-week half-marathon programme.',
    '2026-05-11', '2026-10-04');

INSERT INTO plan_goals (
    id, plan_version_id, goal_type, priority, discipline, event_name, event_date,
    distance_value, distance_unit, target_duration_seconds, description
) VALUES
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000050',
     'race', 'primary', 'run', 'Cardiff Half Marathon', '2026-10-04',
     21.0975, 'kilometres', 4650, 'Run under 1:17:30.'),
    ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000050',
     'performance', 'stretch', 'run', 'Cardiff Half Marathon', '2026-10-04',
     21.0975, 'kilometres', 4500, 'Stretch target of 1:15:00.');

INSERT INTO plan_constraints (
    id, plan_version_id, constraint_type, severity, discipline, numeric_value, unit, day_of_week, description
) VALUES
    ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000050',
     'required_rest_day', 'hard', NULL, NULL, NULL, 7, 'Sunday is a compulsory rest day.'),
    ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000050',
     'hard_sessions_max', 'hard', 'run', 2, 'sessions', NULL, 'No more than two hard running sessions per week.'),
    ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000050',
     'weekly_distance_max', 'soft', 'run', 65, 'kilometres', NULL, 'Keep peak volume around 60–65 km.');

INSERT INTO training_blocks (
    id, plan_version_id, position, title, description, start_date, end_date
) VALUES (
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000050',
    1, 'Foundation',
    'Establish the weekly routine, build the aerobic base, and introduce hills.',
    '2026-05-11', '2026-06-07'
);

INSERT INTO training_weeks (
    id, plan_version_id, block_id, week_number, position, title, description, start_date, end_date
) VALUES
    ('00000000-0000-0000-0000-000000000021',
     '00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000020',
     1, 1, 'Settling in', 'Establish the routine while keeping the legs light.', '2026-05-11', '2026-05-17'),
    ('00000000-0000-0000-0000-000000000022',
     '00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000020',
     2, 2, '10k fitness test', 'Preserve the legs before Wednesday’s test.', '2026-05-18', '2026-05-24');

INSERT INTO week_targets (plan_version_id,
    id, week_id, metric, discipline, minimum_value, target_value, maximum_value, unit
)
VALUES
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000021',
     'distance', 'run', 37, 39, 42, 'kilometres'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000021',
     'hard_session_count', 'run', NULL, 1, 1, 'sessions'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000022',
     'distance', 'run', 39, 41.5, 44, 'kilometres'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000022',
     'hard_session_count', 'run', NULL, 1, 1, 'sessions');

-- Two immutable VDOT-based profiles demonstrate effective-dated calibration.
INSERT INTO calibration_profiles (
    id, plan_version_id, discipline, system, method, fitness_value, source_description, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000050',
     'run', 'run_pace', 'vdot', 58, 'Baseline from a 17:50 5k', '2026-05-01 09:00:00+00'),
    ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000050',
     'run', 'run_pace', 'vdot', 60, 'Example recalibration after the Week 2 10k test', '2026-05-20 20:00:00+00');

-- Pace values use seconds per kilometre. Lower values are faster, so the
-- numeric minimum/maximum represent values rather than intensity ordering.
INSERT INTO calibration_zones (plan_version_id, profile_id, zone_key, metric, minimum_value, maximum_value, unit)
VALUES
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000030', 'easy',       'pace', 305, 335, 'seconds_per_kilometre'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000030', 'marathon',   'pace', 252, 260, 'seconds_per_kilometre'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000030', 'threshold',  'pace', 231, 235, 'seconds_per_kilometre'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000030', 'interval',   'pace', 213, 217, 'seconds_per_kilometre'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000031', 'easy',       'pace', 298, 328, 'seconds_per_kilometre'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000031', 'marathon',   'pace', 247, 255, 'seconds_per_kilometre'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000031', 'threshold',  'pace', 223, 228, 'seconds_per_kilometre'),
    ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000031', 'interval',   'pace', 206, 210, 'seconds_per_kilometre');

INSERT INTO plan_calibration_periods (
    id, plan_version_id, profile_id, system, effective_from, effective_until
) VALUES
    ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000030', 'run_pace', '2026-05-11', '2026-05-21'),
    ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000031', 'run_pace', '2026-05-21', NULL);

INSERT INTO workouts (
    id, plan_version_id, week_id, scheduled_date, position, title, description, purpose,
    primary_discipline, priority, estimated_duration_seconds, estimated_distance_metres
) VALUES
    ('10000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000021', '2026-05-11', 1, 'Easy run and strides',
     'Thirty-five minutes easy followed by four relaxed strides.', 'Aerobic consistency and running economy.',
     'run', 'medium', 2400, 6500),
    ('10000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000021', '2026-05-12', 1, 'Easy run',
     'Thirty minutes at an easy effort.', 'Aerobic consistency.', 'run', 'low', 1800, 5500),
    ('10000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000021', '2026-05-13', 1, 'Uphill repetitions',
     'Six controlled 75-second uphill repetitions with walk/jog-back recovery.', 'Introduce running strength.',
     'run', 'high', 3300, 9500),
    ('10000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000021', '2026-05-15', 1, 'Easy run',
     'Thirty minutes at an easy effort.', 'Low-cost aerobic volume.', 'run', 'low', 1800, 5500),
    ('10000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000021', '2026-05-16', 1, 'Long easy run',
     'Sixty-five minutes entirely easy.', 'Aerobic durability.', 'run', 'high', 3900, 12000),
    ('10000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000022', '2026-05-18', 1, 'Easy run and strides',
     'Thirty-five minutes easy with four light strides.', 'Maintain rhythm before the test.',
     'run', 'medium', 2400, 6500),
    ('10000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000022', '2026-05-19', 1, 'Pre-test easy run',
     'Twenty-five minutes very easy.', 'Keep the legs moving without fatigue.', 'run', 'low', 1500, 4500),
    ('10000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000022', '2026-05-20', 1, '10k time trial',
     'Warm up, run a controlled 10k time trial, and cool down.', 'Measure fitness and recalibrate pace zones.',
     'run', 'high', 4800, 13000),
    ('10000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000022', '2026-05-22', 1, 'Recovery run',
     'Thirty minutes very easy.', 'Recover from the time trial.', 'run', 'low', 1800, 5500),
    ('10000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000050',
     '00000000-0000-0000-0000-000000000022', '2026-05-23', 1, 'Long easy run',
     'Sixty-five minutes entirely easy.', 'Aerobic durability.', 'run', 'high', 3900, 12000);

INSERT INTO workout_tags (plan_version_id, workout_id, tag)
VALUES
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000101', 'easy'),
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000101', 'strides'),
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000103', 'hills'),
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000103', 'quality'),
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000105', 'long-run'),
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000203', 'test'),
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000203', 'quality'),
    ('00000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000205', 'long-run');

-- Simple duration-based sessions: root sequence plus one effort.
INSERT INTO workout_steps (plan_version_id, id, workout_id, parent_step_id, position, kind, role, discipline, label)
VALUES
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000102', NULL, 1, 'sequence', 'main', NULL, 'Easy run'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000202', '10000000-0000-0000-0000-000000000102', '20000000-0000-0000-0000-000000000201', 1, 'effort', 'work', 'run', 'Easy running'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000203', '10000000-0000-0000-0000-000000000104', NULL, 1, 'sequence', 'main', NULL, 'Easy run'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000204', '10000000-0000-0000-0000-000000000104', '20000000-0000-0000-0000-000000000203', 1, 'effort', 'work', 'run', 'Easy running'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000205', '10000000-0000-0000-0000-000000000105', NULL, 1, 'sequence', 'main', NULL, 'Long run'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000206', '10000000-0000-0000-0000-000000000105', '20000000-0000-0000-0000-000000000205', 1, 'effort', 'work', 'run', 'Long easy running'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000207', '10000000-0000-0000-0000-000000000202', NULL, 1, 'sequence', 'main', NULL, 'Pre-test easy run'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000208', '10000000-0000-0000-0000-000000000202', '20000000-0000-0000-0000-000000000207', 1, 'effort', 'work', 'run', 'Easy running'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000209', '10000000-0000-0000-0000-000000000204', NULL, 1, 'sequence', 'main', NULL, 'Recovery run'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000210', '10000000-0000-0000-0000-000000000204', '20000000-0000-0000-0000-000000000209', 1, 'effort', 'recovery', 'run', 'Recovery running'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000211', '10000000-0000-0000-0000-000000000205', NULL, 1, 'sequence', 'main', NULL, 'Long run'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000212', '10000000-0000-0000-0000-000000000205', '20000000-0000-0000-0000-000000000211', 1, 'effort', 'work', 'run', 'Long easy running');

INSERT INTO step_completions (plan_version_id, step_id, completion_type, numeric_value, unit)
VALUES
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000202', 'duration', 1800, 'seconds'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000204', 'duration', 1800, 'seconds'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000206', 'duration', 3900, 'seconds'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000208', 'duration', 1500, 'seconds'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000210', 'duration', 1800, 'seconds'),
    ('00000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000212', 'duration', 3900, 'seconds');

INSERT INTO step_targets (plan_version_id, step_id, position, target_type, zone_system, zone_key)
SELECT '00000000-0000-0000-0000-000000000050', id, 1, 'zone', 'run_pace', 'easy'
FROM workout_steps
WHERE id IN (
    '20000000-0000-0000-0000-000000000202', '20000000-0000-0000-0000-000000000204',
    '20000000-0000-0000-0000-000000000206', '20000000-0000-0000-0000-000000000208',
    '20000000-0000-0000-0000-000000000210', '20000000-0000-0000-0000-000000000212'
);

-- Week 1 Monday and Week 2 Monday share the easy + strides structure.
INSERT INTO workout_steps (plan_version_id, id, workout_id, parent_step_id, position, kind, role, discipline, repeat_count, label, instructions)
VALUES
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000101', NULL, 1, 'sequence', 'main', NULL, NULL, 'Easy run and strides', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000101', '21000000-0000-0000-0000-000000000101', 1, 'effort', 'warmup', 'run', NULL, 'Easy running', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000101', '21000000-0000-0000-0000-000000000101', 2, 'repeat', 'main', NULL, 4, 'Strides', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000101', '21000000-0000-0000-0000-000000000103', 1, 'effort', 'work', 'run', NULL, 'Relaxed stride', 'Fast and relaxed, not an all-out sprint.'),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000101', '21000000-0000-0000-0000-000000000103', 2, 'effort', 'recovery', 'run', NULL, 'Walk recovery', 'Take a full walk recovery.'),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000201', NULL, 1, 'sequence', 'main', NULL, NULL, 'Easy run and strides', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000202', '10000000-0000-0000-0000-000000000201', '21000000-0000-0000-0000-000000000201', 1, 'effort', 'warmup', 'run', NULL, 'Easy running', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000203', '10000000-0000-0000-0000-000000000201', '21000000-0000-0000-0000-000000000201', 2, 'repeat', 'main', NULL, 4, 'Light strides', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000204', '10000000-0000-0000-0000-000000000201', '21000000-0000-0000-0000-000000000203', 1, 'effort', 'work', 'run', NULL, 'Relaxed stride', 'Keep these light before the test.'),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000205', '10000000-0000-0000-0000-000000000201', '21000000-0000-0000-0000-000000000203', 2, 'effort', 'recovery', 'run', NULL, 'Walk recovery', 'Take a full walk recovery.');

INSERT INTO step_completions (plan_version_id, step_id, completion_type, numeric_value, unit, condition_type)
VALUES
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000102', 'duration', 2100, 'seconds', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000104', 'distance', 80, 'metres', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000105', 'until_condition', NULL, NULL, 'fully_recovered'),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000202', 'duration', 2100, 'seconds', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000204', 'distance', 80, 'metres', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000205', 'until_condition', NULL, NULL, 'fully_recovered');

INSERT INTO step_targets (plan_version_id, step_id, position, target_type, minimum_value, maximum_value, unit, zone_system, zone_key, text_value)
VALUES
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000102', 1, 'zone', NULL, NULL, NULL, 'run_pace', 'easy', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000104', 1, 'rpe', 8, 9, 'rpe', NULL, NULL, NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000105', 1, 'instruction', NULL, NULL, NULL, NULL, NULL, 'Walk until fully recovered.'),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000202', 1, 'zone', NULL, NULL, NULL, 'run_pace', 'easy', NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000204', 1, 'rpe', 7, 8, 'rpe', NULL, NULL, NULL),
    ('00000000-0000-0000-0000-000000000050', '21000000-0000-0000-0000-000000000205', 1, 'instruction', NULL, NULL, NULL, NULL, NULL, 'Walk until fully recovered.');

-- Week 1 hill workout.
INSERT INTO workout_steps (plan_version_id, id, workout_id, parent_step_id, position, kind, role, discipline, repeat_count, label, instructions)
VALUES
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000103', NULL, 1, 'sequence', 'main', NULL, NULL, 'Hill session', NULL),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000103', '22000000-0000-0000-0000-000000000101', 1, 'effort', 'warmup', 'run', NULL, 'Warm-up', NULL),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000103', '22000000-0000-0000-0000-000000000101', 2, 'repeat', 'main', NULL, 6, 'Uphill repetitions', NULL),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000103', '22000000-0000-0000-0000-000000000103', 1, 'effort', 'work', 'run', NULL, 'Run uphill', 'Use a strong hill with consistent grade.'),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000103', '22000000-0000-0000-0000-000000000103', 2, 'effort', 'recovery', 'run', NULL, 'Walk or jog back', 'Return to the start easily.'),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000106', '10000000-0000-0000-0000-000000000103', '22000000-0000-0000-0000-000000000101', 3, 'effort', 'cooldown', 'run', NULL, 'Cool-down', NULL);

INSERT INTO step_completions (plan_version_id, step_id, completion_type, numeric_value, unit, condition_type, condition_value)
VALUES
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000102', 'duration', 720, 'seconds', NULL, NULL),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000104', 'duration', 75, 'seconds', NULL, NULL),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000105', 'until_condition', NULL, NULL, 'return_to_start', 'Walk or jog downhill'),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000106', 'duration', 600, 'seconds', NULL, NULL);

INSERT INTO step_targets (plan_version_id, step_id, position, target_type, minimum_value, maximum_value, unit, zone_system, zone_key)
VALUES
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000102', 1, 'zone', NULL, NULL, NULL, 'run_pace', 'easy'),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000104', 1, 'rpe', 8, 8, 'rpe', NULL, NULL),
    ('00000000-0000-0000-0000-000000000050', '22000000-0000-0000-0000-000000000106', 1, 'zone', NULL, NULL, NULL, 'run_pace', 'easy');

-- Week 2 10k time trial.
INSERT INTO workout_steps (plan_version_id, id, workout_id, parent_step_id, position, kind, role, discipline, repeat_count, label, instructions)
VALUES
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000203', NULL, 1, 'sequence', 'main', NULL, NULL, '10k time trial', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000203', '23000000-0000-0000-0000-000000000101', 1, 'effort', 'warmup', 'run', NULL, 'Warm-up', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000203', '23000000-0000-0000-0000-000000000101', 2, 'repeat', 'main', NULL, 4, 'Pre-test strides', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000203', '23000000-0000-0000-0000-000000000103', 1, 'effort', 'work', 'run', NULL, 'Stride', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000203', '23000000-0000-0000-0000-000000000103', 2, 'effort', 'recovery', 'run', NULL, 'Walk recovery', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000106', '10000000-0000-0000-0000-000000000203', '23000000-0000-0000-0000-000000000101', 3, 'effort', 'work', 'run', NULL, '10k time trial', 'Start conservatively, settle through 8 km, then finish hard.'),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000107', '10000000-0000-0000-0000-000000000203', '23000000-0000-0000-0000-000000000101', 4, 'effort', 'cooldown', 'run', NULL, 'Cool-down', NULL);

INSERT INTO step_completions (plan_version_id, step_id, completion_type, numeric_value, unit, condition_type)
VALUES
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000102', 'duration', 900, 'seconds', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000104', 'distance', 80, 'metres', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000105', 'until_condition', NULL, NULL, 'fully_recovered'),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000106', 'distance', 10000, 'metres', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000107', 'duration', 600, 'seconds', NULL);

INSERT INTO step_targets (plan_version_id, step_id, position, target_type, minimum_value, maximum_value, unit, zone_system, zone_key, text_value)
VALUES
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000102', 1, 'zone', NULL, NULL, NULL, 'run_pace', 'easy', NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000104', 1, 'rpe', 8, 9, 'rpe', NULL, NULL, NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000105', 1, 'instruction', NULL, NULL, NULL, NULL, NULL, 'Take a full walk recovery.'),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000106', 1, 'rpe', 9, 10, 'rpe', NULL, NULL, NULL),
    ('00000000-0000-0000-0000-000000000050', '23000000-0000-0000-0000-000000000107', 1, 'zone', NULL, NULL, NULL, 'run_pace', 'easy', NULL);

INSERT INTO seed_runs (seed_key) VALUES ('cardiff-half-example-v2');

COMMIT;
