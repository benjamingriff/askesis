-- Races carry a priority (A goal race, B tune-up, C raced as training) so clients and the coach
-- treat them as races rather than guessing from titles. A cutback week is deliberately lighter
-- inside its block. Existing workouts are not races and existing weeks are not cutbacks; adding
-- columns writes no rows, so locked content is untouched.
ALTER TABLE workouts ADD COLUMN race_priority text
 CONSTRAINT workouts_race_priority_check CHECK (race_priority IN ('A','B','C'));
ALTER TABLE training_weeks ADD COLUMN cutback boolean NOT NULL DEFAULT false;
