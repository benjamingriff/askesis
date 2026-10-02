-- Generation intent belongs to the durable execution, not to immutable plan content.
-- Scalar execution attribution survives draft discard, as do existing tool receipts.
ALTER TABLE agent_runs
 ADD COLUMN generation_start_date date,
 ADD COLUMN generation_end_date date,
 ADD COLUMN generation_prescribed_through date,
 ADD CONSTRAINT agent_generation_range CHECK (
   (generation_start_date IS NULL AND generation_end_date IS NULL AND generation_prescribed_through IS NULL)
   OR (generation_start_date IS NOT NULL AND generation_end_date IS NOT NULL
       AND generation_end_date >= generation_start_date
       AND (generation_prescribed_through IS NULL
            OR generation_prescribed_through BETWEEN generation_start_date AND generation_end_date))
 );
CREATE INDEX agent_runs_generation_version ON agent_runs(execution_version_id, created_at)
 WHERE generation_start_date IS NOT NULL;

CREATE FUNCTION protect_generation_horizon() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.generation_start_date IS NOT NULL
    AND ROW(NEW.generation_start_date, NEW.generation_end_date)
        IS DISTINCT FROM ROW(OLD.generation_start_date, OLD.generation_end_date) THEN
   RAISE EXCEPTION 'The intended generation horizon is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_generation_horizon BEFORE UPDATE ON agent_runs
 FOR EACH ROW EXECUTE FUNCTION protect_generation_horizon();

-- Every writer, including human metadata edits, reconciles coverage when dates change.
CREATE FUNCTION reconcile_plan_schedule_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
   DELETE FROM plan_schedule_coverage WHERE plan_version_id = NEW.id
     AND (NEW.start_date IS NULL OR NEW.end_date IS NULL
          OR end_date < NEW.start_date OR start_date > NEW.end_date);
   UPDATE plan_schedule_coverage
     SET start_date = greatest(start_date, NEW.start_date), end_date = least(end_date, NEW.end_date)
     WHERE plan_version_id = NEW.id
       AND (start_date < NEW.start_date OR end_date > NEW.end_date);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reconcile_schedule_coverage AFTER UPDATE OF start_date, end_date ON plan_versions
 FOR EACH ROW EXECUTE FUNCTION reconcile_plan_schedule_coverage();

CREATE FUNCTION check_plan_schedule_coverage_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_start date; version_end date;
BEGIN
 SELECT start_date, end_date INTO version_start, version_end FROM plan_versions WHERE id = NEW.plan_version_id;
 IF version_start IS NULL OR version_end IS NULL OR NEW.start_date < version_start OR NEW.end_date > version_end THEN
   RAISE EXCEPTION 'Coverage must fit within the plan dates' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_schedule_coverage_dates BEFORE INSERT OR UPDATE ON plan_schedule_coverage
 FOR EACH ROW EXECUTE FUNCTION check_plan_schedule_coverage_dates();
