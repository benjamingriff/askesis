-- Workers may run the coaching runtime on Claude as well as OpenAI. Runs already record the
-- claiming worker's provider as free text, so only worker registration is constrained.
ALTER TABLE agent_workers DROP CONSTRAINT agent_workers_provider_check,
 ADD CONSTRAINT agent_workers_provider_check CHECK (provider IN ('openai','anthropic'));
