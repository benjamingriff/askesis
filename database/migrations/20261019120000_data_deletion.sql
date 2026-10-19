-- Plan and account deletion (docs/product/data-deletion-and-retention.md).
-- Deleting is a soft state with a restore window; a later purge removes the rows.
-- Purges run in a transaction that sets askesis.purge, the only way past the history guards.
CREATE FUNCTION askesis_purging() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(current_setting('askesis.purge', true), '') = 'on'
$$;

-- A deleted plan is an archived plan awaiting purge, so every archived-plan rule still applies.
ALTER TABLE plans ADD COLUMN deleted_at timestamptz;
ALTER TABLE plans ADD CONSTRAINT plans_deleted_archived_check
 CHECK (deleted_at IS NULL OR archived_at IS NOT NULL);
CREATE INDEX plans_deleted_at_idx ON plans (deleted_at) WHERE deleted_at IS NOT NULL;

-- Account deletion waits out a grace period; purge_started_at closes cancellation.
ALTER TABLE athletes ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE athletes ADD COLUMN purge_after timestamptz;
ALTER TABLE athletes ADD COLUMN purge_started_at timestamptz;
ALTER TABLE athletes ADD CONSTRAINT athletes_deletion_check CHECK (
 (deletion_requested_at IS NULL) = (purge_after IS NULL)
 AND (purge_started_at IS NULL OR purge_after IS NOT NULL)
);
CREATE INDEX athletes_purge_after_idx ON athletes (purge_after) WHERE purge_after IS NOT NULL;

-- Cached command responses name their plan, so a replay cannot reveal a deleted plan and the
-- purge removes them with it.
ALTER TABLE api_idempotency_keys ADD COLUMN plan_id uuid REFERENCES plans(id);
CREATE INDEX api_idempotency_keys_plan_idx ON api_idempotency_keys (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX api_idempotency_keys_created_idx ON api_idempotency_keys (created_at);

-- Usage of purged coaching runs, without identifiers or text. Kept indefinitely.
CREATE TABLE agent_usage_rollups (
 day date NOT NULL,
 provider text NOT NULL,
 model text NOT NULL,
 prompt_version text NOT NULL,
 status text NOT NULL,
 runs integer NOT NULL CHECK (runs > 0),
 input_tokens bigint NOT NULL DEFAULT 0,
 output_tokens bigint NOT NULL DEFAULT 0,
 tool_calls bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (day, provider, model, prompt_version, status)
);

-- Every deletion transition, written in its own transaction and shipped to the logs, so a
-- database restored from an older backup can have later deletions replayed. Sequences come from
-- a single head row, so they are gapless and follow commit order; a replay can tell when events
-- are missing. Ids and times only: nothing left to join to once the subject is purged.
CREATE TABLE deletion_journal (
 sequence bigint PRIMARY KEY CHECK (sequence > 0),
 event text NOT NULL CHECK (event IN ('plan.deleted', 'plan.restored', 'plan.purged',
   'account.deletion_requested', 'account.purge_due', 'account.deletion_cancelled',
   'account.purged')),
 subject_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL,
 shipped_at timestamptz
);
CREATE INDEX deletion_journal_unshipped_idx ON deletion_journal (sequence) WHERE shipped_at IS NULL;
CREATE TABLE deletion_journal_head (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 sequence bigint NOT NULL CHECK (sequence >= 0)
);
INSERT INTO deletion_journal_head (sequence) VALUES (0);

-- Archived plans stay read-only; only moving in and out of deletion is allowed while archived.
CREATE OR REPLACE FUNCTION guard_archived_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id THEN
        RAISE EXCEPTION 'Plan identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.archived_at IS NOT NULL AND (
        NEW.display_name <> OLD.display_name
        OR NEW.current_locked_version_id IS DISTINCT FROM OLD.current_locked_version_id
        OR NEW.current_draft_version_id IS DISTINCT FROM OLD.current_draft_version_id
        OR NEW.activated_at IS NOT NULL
        OR (NEW.archived_at IS NOT NULL AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at
            OR NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at))
    ) THEN RAISE EXCEPTION 'Archived plan is read-only' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_plan_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id uuid; target_plan uuid; version_state text; archived timestamptz;
BEGIN
    IF TG_OP = 'DELETE' AND askesis_purging() THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' AND NEW.plan_version_id <> OLD.plan_version_id THEN
        RAISE EXCEPTION 'Content cannot change version ownership' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN version_id := OLD.plan_version_id;
    ELSE version_id := NEW.plan_version_id; END IF;
    SELECT plan_id INTO target_plan FROM plan_versions WHERE id = version_id;
    SELECT archived_at INTO archived FROM plans WHERE id = target_plan FOR UPDATE;
    SELECT state INTO version_state FROM plan_versions WHERE id = version_id FOR UPDATE;
    IF version_state IS DISTINCT FROM 'draft' OR archived IS NOT NULL THEN
        RAISE EXCEPTION 'Plan content is read-only' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_plan_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_plan uuid; archived timestamptz;
BEGIN
    IF TG_OP = 'DELETE' AND askesis_purging() THEN RETURN OLD; END IF;
    IF TG_OP = 'DELETE' THEN target_plan := OLD.plan_id; ELSE target_plan := NEW.plan_id; END IF;
    SELECT archived_at INTO archived FROM plans WHERE id = target_plan FOR UPDATE;
    IF archived IS NOT NULL THEN
        RAISE EXCEPTION 'Archived plan is read-only' USING ERRCODE = '23514';
    END IF;
    IF TG_OP <> 'INSERT' THEN
        IF OLD.state = 'locked' THEN
            RAISE EXCEPTION 'Locked version is immutable' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.plan_id <> OLD.plan_id) THEN
            RAISE EXCEPTION 'Version identity is immutable' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.state <> 'draft' THEN
        RAISE EXCEPTION 'Versions must start as drafts' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

-- Messages, events, receipts, finishes, progress batches and tool changes. A purged plan's
-- training log can also appear in tool results of other conversations; those results are
-- redacted rather than kept.
CREATE OR REPLACE FUNCTION protect_chat_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF askesis_purging() THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        IF TG_TABLE_NAME = 'agent_tool_receipts'
           AND to_jsonb(NEW) - 'response' = to_jsonb(OLD) - 'response' THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Chat history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION protect_agent_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c conversations; m conversation_messages;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF askesis_purging() THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Run history is retained';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO c FROM conversations WHERE id = NEW.conversation_id;
        SELECT * INTO m FROM conversation_messages WHERE id = NEW.user_message_id;
        IF NEW.plan_id IS DISTINCT FROM c.plan_id OR m.role <> 'user' THEN
            RAISE EXCEPTION 'Invalid run context';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status IN ('completed', 'failed', 'cancelled') THEN RAISE EXCEPTION 'Terminal run is immutable'; END IF;
    IF ROW(NEW.id, NEW.owner_id, NEW.conversation_id, NEW.plan_id, NEW.user_message_id, NEW.context, NEW.created_at, NEW.deadline_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.owner_id, OLD.conversation_id, OLD.plan_id, OLD.user_message_id, OLD.context, OLD.created_at, OLD.deadline_at) THEN
        RAISE EXCEPTION 'Run attribution is immutable';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
        (OLD.status = 'queued' AND NEW.status IN ('running', 'cancelled', 'failed')) OR
        (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelling')) OR
        (OLD.status = 'cancelling' AND NEW.status IN ('cancelled', 'failed'))
    ) THEN RAISE EXCEPTION 'Invalid run transition'; END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_live_output() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF askesis_purging() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Visible output cannot be deleted';
 END IF;
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

-- A purged plan's runs may have recorded athlete-owned calibrations, which outlive the plan
-- and only lose the reference to the run.
CREATE OR REPLACE FUNCTION protect_athlete_calibration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF askesis_purging() THEN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF to_jsonb(NEW) - 'recorded_by_run_id' - 'retracted_by_run_id'
       IS NOT DISTINCT FROM to_jsonb(OLD) - 'recorded_by_run_id' - 'retracted_by_run_id'
     AND (NEW.recorded_by_run_id IS NULL OR NEW.recorded_by_run_id = OLD.recorded_by_run_id)
     AND (NEW.retracted_by_run_id IS NULL OR NEW.retracted_by_run_id = OLD.retracted_by_run_id) THEN
   RETURN NEW;
  END IF;
 END IF;
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

CREATE OR REPLACE FUNCTION protect_calibration_zone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND askesis_purging() THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Calibration zones are immutable' USING ERRCODE = '23514';
END $$;

-- Purges notify nobody: the plan was already hidden, and a purged account has no journal.
DROP TRIGGER live_performance ON athlete_calibrations;
CREATE CONSTRAINT TRIGGER live_performance AFTER INSERT OR UPDATE ON athlete_calibrations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT askesis_purging())
 EXECUTE FUNCTION record_live_change();
DROP TRIGGER live_workout_logs ON workout_logs;
CREATE CONSTRAINT TRIGGER live_workout_logs AFTER INSERT OR UPDATE OR DELETE ON workout_logs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT askesis_purging())
 EXECUTE FUNCTION record_training_log_change();
