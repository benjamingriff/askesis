-- Multi-sport plans: cycling power and swim pace calibration, a controlled sport vocabulary
-- for workouts and their steps, and per-sport brief baselines replacing the running-only
-- columns. Existing briefs keep their running answers as a run baseline.

-- Athlete calibration systems. Each system has a deterministic calculator in the API registry.
ALTER TABLE athlete_calibrations DROP CONSTRAINT athlete_calibrations_system_check;
ALTER TABLE athlete_calibrations ADD CONSTRAINT athlete_calibrations_system_check
 CHECK (system IN ('run_pace','cycle_power','swim_pace'));

-- Swim pace is expressed per 100 metres, the unit swimmers train by.
CREATE OR REPLACE FUNCTION valid_target_unit(metric text, unit text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE metric
        WHEN 'pace' THEN unit IN ('seconds_per_kilometre', 'seconds_per_mile', 'seconds_per_100_metres')
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

-- A workout names its sport; a mixed workout (a brick or a Hyrox simulation) names each
-- effort's sport on its steps. Strength stations, ergs and transitions are step sports.
ALTER TABLE workouts ADD CONSTRAINT workouts_primary_discipline_check
 CHECK (primary_discipline IN ('run','cycle','swim','strength','mixed'));
ALTER TABLE workout_steps ADD CONSTRAINT workout_steps_discipline_check
 CHECK (discipline IS NULL OR discipline IN ('run','cycle','swim','strength','row','ski_erg','other'));

-- One baseline per sport in the plan. Volume is metres for run and swim, seconds for cycle;
-- strength records sessions only.
CREATE TABLE plan_brief_sports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lineage_id uuid NOT NULL DEFAULT gen_random_uuid(),
 plan_version_id uuid NOT NULL REFERENCES plan_versions(id),
 sport text NOT NULL CHECK (sport IN ('run','cycle','swim','strength')),
 current_sessions_status text NOT NULL DEFAULT 'unanswered'
  CHECK (current_sessions_status IN ('unanswered','unknown','known')),
 current_sessions_per_week integer,
 desired_sessions_per_week integer CHECK (desired_sessions_per_week BETWEEN 1 AND 14),
 weekly_volume_status text CHECK (weekly_volume_status IN ('unanswered','unknown','known')),
 weekly_volume numeric(14,3),
 longest_session_status text CHECK (longest_session_status IN ('unanswered','unknown','known')),
 longest_session numeric(14,3),
 CHECK ((current_sessions_status = 'known' AND current_sessions_per_week IS NOT NULL AND current_sessions_per_week >= 0)
  OR (current_sessions_status <> 'known' AND current_sessions_per_week IS NULL)),
 CHECK ((sport = 'strength') = (weekly_volume_status IS NULL AND longest_session_status IS NULL)),
 CHECK ((weekly_volume_status = 'known' AND weekly_volume IS NOT NULL AND weekly_volume >= 0)
  OR (weekly_volume_status IS DISTINCT FROM 'known' AND weekly_volume IS NULL)),
 CHECK ((longest_session_status = 'known' AND longest_session IS NOT NULL AND longest_session >= 0)
  OR (longest_session_status IS DISTINCT FROM 'known' AND longest_session IS NULL)),
 UNIQUE (plan_version_id, sport),
 UNIQUE (plan_version_id, lineage_id)
);

-- Every existing brief describes a running plan. Reusing the brief's lineage keeps the run
-- baseline's identity stable across a plan's versions, so change summaries stay accurate.
-- Locked versions are backfilled before the content guard exists on this table.
INSERT INTO plan_brief_sports (lineage_id, plan_version_id, sport, current_sessions_status,
 current_sessions_per_week, desired_sessions_per_week, weekly_volume_status, weekly_volume,
 longest_session_status, longest_session)
SELECT lineage_id, plan_version_id, 'run', current_runs_status, current_runs_per_week,
 desired_runs_per_week, weekly_distance_status, weekly_distance_metres, longest_run_status,
 longest_run_metres
FROM plan_briefs;

CREATE TRIGGER protect_content BEFORE INSERT OR UPDATE OR DELETE ON plan_brief_sports
 FOR EACH ROW EXECUTE FUNCTION guard_plan_content();

ALTER TABLE plan_briefs
 DROP COLUMN weekly_distance_status,
 DROP COLUMN weekly_distance_metres,
 DROP COLUMN current_runs_status,
 DROP COLUMN current_runs_per_week,
 DROP COLUMN longest_run_status,
 DROP COLUMN longest_run_metres,
 DROP COLUMN desired_runs_per_week;
