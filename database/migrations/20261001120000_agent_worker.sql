-- Phase 5 is additive: existing plans and immutable chat provenance are retained.
CREATE TABLE agent_workers (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK (provider = 'openai'),
 model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
 reasoning text NOT NULL CHECK (reasoning IN ('low','medium','high','xhigh','max')),
 prompt_version text NOT NULL,
 ready boolean NOT NULL DEFAULT false,
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_runs
 ADD COLUMN worker_id uuid REFERENCES agent_workers(id),
 ADD COLUMN lease_generation integer NOT NULL DEFAULT 0,
 ADD COLUMN lease_expires_at timestamptz,
 ADD COLUMN credential_digest text,
 ADD COLUMN execution_plan_id uuid,
 ADD COLUMN execution_version_id uuid,
 ADD COLUMN execution_edit_number integer,
 ADD COLUMN reasoning text,
 ADD COLUMN prompt_version text,
 ADD COLUMN tool_count integer NOT NULL DEFAULT 0 CHECK (tool_count BETWEEN 0 AND 200);
-- Execution target is separate from the immutable initial attribution, so a standalone
-- conversation can create a plan without rewriting previous messages or run context.
CREATE TABLE agent_tool_receipts (
 run_id uuid NOT NULL REFERENCES agent_runs(id),
 operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 200),
 tool_name text NOT NULL,
 input_hash text NOT NULL,
 response jsonb NOT NULL,
 target_version_id uuid,
 edit_number integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (run_id, operation_id)
);
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE ON agent_tool_receipts
 FOR EACH ROW EXECUTE FUNCTION protect_chat_history();
ALTER TABLE agent_run_events DROP CONSTRAINT agent_run_events_type_check;
ALTER TABLE agent_run_events ADD CONSTRAINT agent_run_events_type_check CHECK (
 type IN ('queued','started','cancel_requested','completed','failed','cancelled','tool_completed','plan_bound')
);
CREATE TABLE plan_schedule_coverage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lineage_id uuid NOT NULL DEFAULT gen_random_uuid(),
 plan_version_id uuid NOT NULL REFERENCES plan_versions(id),
 start_date date NOT NULL,
 end_date date NOT NULL CHECK (end_date >= start_date),
 brief_hash text NOT NULL,
 UNIQUE(plan_version_id, lineage_id),
 EXCLUDE USING gist (plan_version_id WITH =, daterange(start_date,end_date,'[]') WITH &&)
);
CREATE TRIGGER protect_content BEFORE INSERT OR UPDATE OR DELETE ON plan_schedule_coverage
 FOR EACH ROW EXECUTE FUNCTION guard_plan_content();
ALTER TABLE calibration_profiles
 ADD COLUMN provenance text NOT NULL DEFAULT 'user_supplied' CHECK (provenance IN ('user_supplied','user_estimate','agent_estimate')),
 ADD COLUMN estimate_basis text;
ALTER TABLE plan_versions ALTER COLUMN content_schema_version SET DEFAULT 3;

CREATE UNIQUE INDEX agent_runs_active_execution_plan ON agent_runs(COALESCE(execution_plan_id, plan_id))
 WHERE COALESCE(execution_plan_id,plan_id) IS NOT NULL AND status IN ('queued','running','cancelling');

-- Coherent batches may swap dates/positions without committing temporary collisions.
ALTER TABLE training_blocks DROP CONSTRAINT training_blocks_plan_position_key,
 ADD CONSTRAINT training_blocks_plan_position_key UNIQUE(plan_version_id,position) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE training_weeks DROP CONSTRAINT training_weeks_plan_number_key,
 ADD CONSTRAINT training_weeks_plan_number_key UNIQUE(plan_version_id,week_number) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE training_weeks DROP CONSTRAINT training_weeks_block_position_key,
 ADD CONSTRAINT training_weeks_block_position_key UNIQUE(block_id,position) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE workouts DROP CONSTRAINT workouts_plan_date_position_key,
 ADD CONSTRAINT workouts_plan_date_position_key UNIQUE(plan_version_id,scheduled_date,position) DEFERRABLE INITIALLY DEFERRED;
