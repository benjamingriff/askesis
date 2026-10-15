-- A prompt version name is paired with the SHA-256 of its exact text. Workers report both; runs
-- keep the hash of the worker that claimed them. Earlier rows have no recorded hash.
ALTER TABLE agent_workers ADD COLUMN prompt_hash text CHECK (prompt_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE agent_runs ADD COLUMN prompt_hash text CHECK (prompt_hash ~ '^[a-f0-9]{64}$');
-- When a visible output segment was first saved, so its order relative to tool calls is known.
-- Existing segments stay null rather than receiving the migration time.
ALTER TABLE agent_run_outputs ADD COLUMN started_at timestamptz;
ALTER TABLE agent_run_outputs ALTER COLUMN started_at SET DEFAULT now();
