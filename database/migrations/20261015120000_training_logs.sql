-- Logs record the athlete's account separately from immutable prescriptions.
ALTER TABLE workouts ADD COLUMN session_type text
 CHECK (session_type IN ('recovery','easy','long','steady','tempo','intervals','speed','strength','mobility','brick','race','test','rest'));
CREATE TABLE workout_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 athlete_id uuid NOT NULL REFERENCES athletes(id),
 plan_id uuid NOT NULL REFERENCES plans(id),
 workout_lineage_id uuid NOT NULL,
 logged_version_id uuid NOT NULL REFERENCES plan_versions(id),
 scheduled_on date NOT NULL,
 title text NOT NULL,
 discipline text NOT NULL,
 session_type text,
 key_session boolean NOT NULL,
 planned_duration_seconds integer,
 planned_distance_metres numeric(12,3),
 planned_rpe numeric(3,1),
 status text NOT NULL CHECK (status IN ('done','changed','skipped')),
 performed_on date NOT NULL,
 actual_duration_seconds integer CHECK (actual_duration_seconds BETWEEN 1 AND 604800),
 actual_distance_metres numeric(12,3) CHECK (actual_distance_metres > 0 AND actual_distance_metres <= 1000000),
 rpe smallint CHECK (rpe BETWEEN 1 AND 10),
 feel smallint CHECK (feel BETWEEN 1 AND 5),
 reasons text[] NOT NULL DEFAULT '{}',
 answers jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 16384),
 answers_schema_version integer NOT NULL DEFAULT 1,
 note text CHECK (length(note) <= 2000),
 source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','coach')),
 recorded_by_run_id uuid REFERENCES agent_runs(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (plan_id, workout_lineage_id),
 CHECK (status <> 'skipped' OR (actual_duration_seconds IS NULL AND actual_distance_metres IS NULL AND rpe IS NULL))
);
CREATE INDEX workout_logs_athlete_date_idx ON workout_logs (athlete_id, performed_on);
CREATE TABLE athlete_check_ins (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 athlete_id uuid NOT NULL REFERENCES athletes(id),
 plan_id uuid NOT NULL REFERENCES plans(id),
 kind text NOT NULL CHECK (kind IN ('ill','pain','run_down','busy')),
 details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 16384),
 starts_on date NOT NULL,
 ends_on date CHECK (ends_on >= starts_on),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX athlete_check_ins_athlete_date_idx ON athlete_check_ins (athlete_id, starts_on);
ALTER TABLE conversation_messages ADD COLUMN "references" jsonb
 CHECK ("references" IS NULL OR (jsonb_typeof("references") = 'array' AND octet_length("references"::text) <= 65536));
-- Use the same commit-ordered journal as plan and performance changes; no health text in events.
CREATE FUNCTION record_training_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; resource uuid; meta jsonb; cursor bigint;
BEGIN
 IF TG_OP = 'DELETE' THEN owner := OLD.athlete_id; resource := OLD.plan_id;
 ELSE owner := NEW.athlete_id; resource := NEW.plan_id; END IF;
 meta := jsonb_build_object('planId', resource);
 IF EXISTS (SELECT 1 FROM live_events WHERE owner_id=owner AND transaction_id=txid_current()
   AND type='training_log.changed' AND resource_id=resource) THEN RETURN NULL; END IF;
 INSERT INTO live_event_heads(owner_id,sequence) VALUES(owner,1)
  ON CONFLICT(owner_id) DO UPDATE SET sequence=live_event_heads.sequence+1 RETURNING sequence INTO cursor;
 INSERT INTO live_events(owner_id,sequence,transaction_id,type,resource_id,metadata)
  VALUES(owner,cursor,txid_current(),'training_log.changed',resource,meta);
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER live_workout_logs AFTER INSERT OR UPDATE OR DELETE ON workout_logs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_training_log_change();
CREATE CONSTRAINT TRIGGER live_check_ins AFTER INSERT ON athlete_check_ins
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_training_log_change();
