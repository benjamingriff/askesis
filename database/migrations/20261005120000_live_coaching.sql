-- Additive delivery state; plan content and immutable history are unchanged.
CREATE TABLE agent_run_outputs (
 run_id uuid NOT NULL REFERENCES agent_runs(id),
 item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
 position integer NOT NULL CHECK (position BETWEEN 0 AND 100),
 content text NOT NULL DEFAULT '' CHECK (length(content) <= 32000),
 revision integer NOT NULL CHECK (revision > 0),
 is_final boolean NOT NULL DEFAULT false,
 truncated boolean NOT NULL DEFAULT false,
 PRIMARY KEY (run_id, item_id), UNIQUE(run_id, position)
);
CREATE TABLE agent_progress_batches (
 run_id uuid NOT NULL REFERENCES agent_runs(id),
 sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 4000),
 input_hash text NOT NULL,
 PRIMARY KEY(run_id, sequence)
);
CREATE TRIGGER immutable_progress_batches BEFORE UPDATE OR DELETE ON agent_progress_batches
 FOR EACH ROW EXECUTE FUNCTION protect_chat_history();
CREATE TABLE agent_run_measurements (
 run_id uuid PRIMARY KEY REFERENCES agent_runs(id),
 timings jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(timings::text) <= 16384)
);
CREATE TABLE agent_tool_changes (
 run_id uuid NOT NULL,
 operation_id text NOT NULL,
 summary jsonb NOT NULL CHECK (octet_length(summary::text) <= 262144),
 PRIMARY KEY(run_id, operation_id),
 FOREIGN KEY(run_id, operation_id) REFERENCES agent_tool_receipts(run_id,operation_id)
);
CREATE TRIGGER immutable_tool_changes BEFORE UPDATE OR DELETE ON agent_tool_changes
 FOR EACH ROW EXECUTE FUNCTION protect_chat_history();
ALTER TABLE agent_run_events DROP CONSTRAINT agent_run_events_type_check;
ALTER TABLE agent_run_events ADD CONSTRAINT agent_run_events_type_check CHECK (
 type IN ('queued','started','cancel_requested','completed','failed','cancelled','tool_completed','plan_bound','tool_started','tool_failed')
);
CREATE TABLE live_event_heads (
 owner_id uuid PRIMARY KEY REFERENCES athletes(id),
 sequence bigint NOT NULL DEFAULT 0
);
CREATE TABLE live_events (
 owner_id uuid NOT NULL REFERENCES athletes(id),
 sequence bigint NOT NULL,
 transaction_id bigint NOT NULL,
 type text NOT NULL,
 resource_id uuid NOT NULL,
 metadata jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,sequence),
 UNIQUE(owner_id,transaction_id,type,resource_id)
);
-- Deferred triggers allocate cursors at commit, after all domain locks. A global
-- sequence allocated during a transaction would skip later-committing events.
CREATE FUNCTION record_live_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER live_plans AFTER INSERT OR UPDATE ON plans DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION record_live_change();
CREATE CONSTRAINT TRIGGER live_versions AFTER INSERT OR UPDATE ON plan_versions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION record_live_change();
CREATE CONSTRAINT TRIGGER live_conversations AFTER INSERT OR UPDATE ON conversations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION record_live_change();
CREATE CONSTRAINT TRIGGER live_messages AFTER INSERT ON conversation_messages DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION record_live_change();
CREATE CONSTRAINT TRIGGER live_runs AFTER INSERT OR UPDATE ON agent_runs DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION record_live_change();
CREATE CONSTRAINT TRIGGER live_activity AFTER INSERT ON agent_run_events DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION record_live_change();
CREATE CONSTRAINT TRIGGER live_outputs AFTER INSERT OR UPDATE ON agent_run_outputs DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION record_live_change();

CREATE TABLE agent_run_finishes (
 run_id uuid PRIMARY KEY REFERENCES agent_runs(id),
 input_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('completed','failed','cancelled'))
);
CREATE TRIGGER immutable_run_finishes BEFORE UPDATE OR DELETE ON agent_run_finishes
 FOR EACH ROW EXECUTE FUNCTION protect_chat_history();
-- Persisted visible text can only grow under a live execution. Terminal snapshots
-- remain available for history, and cannot be rewritten by a late worker.
CREATE FUNCTION protect_live_output() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Visible output cannot be deleted'; END IF;
 SELECT status INTO state FROM agent_runs WHERE id=NEW.run_id FOR UPDATE;
 IF state NOT IN ('running','cancelling') THEN RAISE EXCEPTION 'Execution is terminal'; END IF;
 IF TG_OP = 'UPDATE' AND (NEW.run_id <> OLD.run_id OR NEW.item_id <> OLD.item_id
   OR NEW.position <> OLD.position OR OLD.is_final OR NOT starts_with(NEW.content,OLD.content)
   OR NEW.revision < OLD.revision
   OR (NEW.revision = OLD.revision AND (NEW.content <> OLD.content OR NOT NEW.is_final))) THEN
  RAISE EXCEPTION 'Visible output revision is invalid';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER protect_live_output BEFORE INSERT OR UPDATE OR DELETE ON agent_run_outputs
 FOR EACH ROW EXECUTE FUNCTION protect_live_output();
