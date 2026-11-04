-- Placeholder sessions: the coach books training whose content is decided elsewhere (a club
-- run, a group ride, a class or another sport). The workout keeps a single open effort with its
-- expected duration and effort range so planning and load treat it like any other session.
ALTER TABLE workouts ADD COLUMN placeholder boolean NOT NULL DEFAULT false;
ALTER TABLE workouts ADD CONSTRAINT workouts_placeholder_duration_check
 CHECK (NOT placeholder OR estimated_duration_seconds IS NOT NULL);

-- Sports the plan does not train (football, climbing) are "other"; the title says what it is.
ALTER TABLE workouts DROP CONSTRAINT workouts_primary_discipline_check;
ALTER TABLE workouts ADD CONSTRAINT workouts_primary_discipline_check
 CHECK (primary_discipline IN ('run','cycle','swim','strength','mixed','other'));

-- Logs snapshot whether the workout was a placeholder and record what the session turned out to be.
ALTER TABLE workout_logs ADD COLUMN placeholder boolean NOT NULL DEFAULT false;
ALTER TABLE workout_logs ADD COLUMN actual_session_type text
 CHECK (actual_session_type IN ('recovery','easy','long','steady','tempo','intervals','speed','strength','mobility','brick','race','test'));
ALTER TABLE workout_logs ADD CONSTRAINT workout_logs_actual_session_type_placeholder_check
 CHECK (actual_session_type IS NULL OR (placeholder AND status <> 'skipped'));
