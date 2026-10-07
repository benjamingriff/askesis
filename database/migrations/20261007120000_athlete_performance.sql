-- Performance calibration moves from plan versions to the athlete. Pre-alpha plan and
-- coaching data is disposable: version hashes, briefs and per-version pace periods have
-- no meaning under the new contract. Athletes and their identities survive.
TRUNCATE plans, plan_versions, plan_briefs, plan_brief_weekdays, plan_schedule_coverage,
 training_blocks, training_weeks, week_targets, workouts, workout_tags, workout_steps,
 step_completions, step_targets, calibration_profiles, calibration_zones,
 plan_calibration_periods, conversations, conversation_messages, agent_runs, agent_run_events,
 agent_tool_receipts, agent_tool_changes, agent_run_outputs, agent_progress_batches,
 agent_run_measurements, agent_run_finishes, api_idempotency_keys;
DELETE FROM seed_runs WHERE seed_key LIKE 'cardiff-half-example-%';

DROP TABLE plan_calibration_periods;
DROP TABLE calibration_zones;
DROP TABLE calibration_profiles;

-- The athlete's timezone comes from the device they last used; plans no longer carry one.
ALTER TABLE athletes ADD COLUMN timezone text NOT NULL DEFAULT 'UTC'
 CHECK (length(timezone) BETWEEN 1 AND 100);
ALTER TABLE plan_briefs DROP COLUMN timezone;

-- Version 4 content excludes calibration. The basis records which athlete calibration
-- entries were current at lock: provenance, never part of the content hash.
ALTER TABLE plan_versions ALTER COLUMN content_schema_version SET DEFAULT 4,
 ADD COLUMN calibration_basis jsonb
  CHECK (calibration_basis IS NULL OR jsonb_typeof(calibration_basis) = 'array');

-- One append-only timeline per athlete and system. An entry is never edited; a later entry
-- supersedes it from its effective date and a mistaken entry is retracted.
CREATE TABLE athlete_calibrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 athlete_id uuid NOT NULL REFERENCES athletes(id),
 system text NOT NULL CHECK (system IN ('run_pace')),
 method text NOT NULL CHECK (length(method) BETWEEN 1 AND 100),
 input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object' AND octet_length(input::text) <= 4096),
 calculator_version text NOT NULL CHECK (length(calculator_version) BETWEEN 1 AND 100),
 fitness_value numeric(12,3),
 provenance text NOT NULL CHECK (provenance IN ('user_supplied','user_estimate','agent_estimate')),
 estimate_basis text CHECK (estimate_basis IS NULL OR length(estimate_basis) BETWEEN 1 AND 4000),
 observed_on date,
 effective_from date NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by_run_id uuid REFERENCES agent_runs(id),
 retracted_at timestamptz,
 retracted_by_run_id uuid REFERENCES agent_runs(id),
 CHECK (observed_on IS NULL OR observed_on <= effective_from),
 CHECK (retracted_by_run_id IS NULL OR retracted_at IS NOT NULL)
);
CREATE INDEX athlete_calibrations_timeline_idx
 ON athlete_calibrations(athlete_id, system, effective_from, recorded_at);
CREATE TABLE athlete_calibration_zones (
 calibration_id uuid NOT NULL REFERENCES athlete_calibrations(id),
 zone_key text NOT NULL CHECK (length(zone_key) BETWEEN 1 AND 100),
 metric text NOT NULL,
 unit text NOT NULL,
 minimum_value numeric(12,3) NOT NULL,
 target_value numeric(12,3) NOT NULL,
 maximum_value numeric(12,3) NOT NULL,
 PRIMARY KEY (calibration_id, zone_key),
 CHECK (valid_target_unit(metric, unit)),
 CHECK (minimum_value > 0 AND minimum_value <= target_value AND target_value <= maximum_value)
);

CREATE FUNCTION protect_athlete_calibration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'Calibration history is retained' USING ERRCODE = '23514';
 END IF;
 IF OLD.retracted_at IS NOT NULL OR NEW.retracted_at IS NULL
   OR to_jsonb(NEW) - 'retracted_at' - 'retracted_by_run_id'
     IS DISTINCT FROM to_jsonb(OLD) - 'retracted_at' - 'retracted_by_run_id' THEN
  RAISE EXCEPTION 'Calibration entries change only by one retraction' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_athlete_calibration BEFORE UPDATE OR DELETE ON athlete_calibrations
 FOR EACH ROW EXECUTE FUNCTION protect_athlete_calibration();
CREATE FUNCTION protect_calibration_zone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Calibration zones are immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER protect_calibration_zone BEFORE UPDATE OR DELETE ON athlete_calibration_zones
 FOR EACH ROW EXECUTE FUNCTION protect_calibration_zone();

-- Performance changes notify the athlete; every plan's resolved paces follow them.
CREATE OR REPLACE FUNCTION record_live_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; owner uuid; resource uuid; event_type text; event_meta jsonb; cursor bigint;
BEGIN
 row_data := to_jsonb(NEW);
 IF TG_TABLE_NAME = 'plans' THEN
  owner := NEW.owner_id; resource := NEW.id; event_type := 'plan.changed';
  event_meta := jsonb_build_object('planId',NEW.id);
 ELSIF TG_TABLE_NAME = 'plan_versions' THEN
  SELECT owner_id INTO owner FROM plans WHERE id=NEW.plan_id;
  resource := NEW.plan_id; event_type := 'plan.changed';
  event_meta := jsonb_build_object('planId',NEW.plan_id,'versionId',NEW.id);
 ELSIF TG_TABLE_NAME = 'conversations' THEN
  owner := NEW.owner_id; resource := NEW.id; event_type := 'conversation.changed';
  event_meta := jsonb_build_object('conversationId',NEW.id,'planId',NEW.plan_id);
 ELSIF TG_TABLE_NAME = 'conversation_messages' THEN
  SELECT owner_id INTO owner FROM conversations WHERE id=NEW.conversation_id;
  resource := NEW.conversation_id; event_type := 'message.changed';
  event_meta := jsonb_build_object('conversationId',NEW.conversation_id);
 ELSIF TG_TABLE_NAME = 'athlete_calibrations' THEN
  owner := NEW.athlete_id; resource := NEW.athlete_id; event_type := 'performance.changed';
  event_meta := jsonb_build_object('system',NEW.system);
 ELSE
  IF TG_TABLE_NAME = 'agent_runs' THEN
   IF TG_OP = 'UPDATE' AND ROW(NEW.status,NEW.execution_plan_id,NEW.execution_edit_number,
     NEW.generation_prescribed_through,NEW.generation_start_date,NEW.generation_end_date)
     IS NOT DISTINCT FROM ROW(OLD.status,OLD.execution_plan_id,OLD.execution_edit_number,
     OLD.generation_prescribed_through,OLD.generation_start_date,OLD.generation_end_date) THEN RETURN NULL; END IF;
   resource := NEW.id;
  ELSE resource := NEW.run_id; END IF;
  SELECT owner_id,jsonb_build_object('runId',id,'conversationId',conversation_id,'planId',COALESCE(execution_plan_id,plan_id))
   INTO owner,event_meta FROM agent_runs WHERE id=resource;
  -- Tool activity and visible text never change plan content; plan writes notify separately.
  event_type := CASE TG_TABLE_NAME WHEN 'agent_run_outputs' THEN 'output.changed'
   WHEN 'agent_run_events' THEN 'activity.changed' ELSE 'run.changed' END;
 END IF;
 IF owner IS NULL THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM live_events WHERE owner_id=owner AND transaction_id=txid_current() AND type=event_type AND resource_id=resource) THEN
  UPDATE live_events SET metadata=live_events.metadata || event_meta
   WHERE owner_id=owner AND transaction_id=txid_current() AND type=event_type AND resource_id=resource;
  RETURN NULL;
 END IF;
 INSERT INTO live_event_heads(owner_id,sequence) VALUES(owner,1)
  ON CONFLICT(owner_id) DO UPDATE SET sequence=live_event_heads.sequence+1 RETURNING sequence INTO cursor;
 INSERT INTO live_events(owner_id,sequence,transaction_id,type,resource_id,metadata)
  VALUES(owner,cursor,txid_current(),event_type,resource,event_meta);
 IF cursor % 100 = 0 THEN
  DELETE FROM live_events WHERE owner_id=owner AND (sequence <= cursor-10000 OR created_at < now()-interval '7 days');
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER live_performance AFTER INSERT OR UPDATE ON athlete_calibrations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_live_change();
