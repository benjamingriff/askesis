-- NULL means no usage report was received. Historical rows are not backfilled.
ALTER TABLE agent_runs ADD COLUMN usage jsonb
    CHECK (usage IS NULL OR jsonb_typeof(usage) = 'object');

CREATE OR REPLACE FUNCTION protect_agent_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c conversations; m conversation_messages;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Run history is retained'; END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO c FROM conversations WHERE id = NEW.conversation_id;
        SELECT * INTO m FROM conversation_messages WHERE id = NEW.user_message_id;
        IF NEW.plan_id IS DISTINCT FROM c.plan_id OR m.role <> 'user' THEN
            RAISE EXCEPTION 'Invalid run context';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
        -- A fenced worker may attach its first usage report after the sweeper wins.
        -- Compare every other column, including future columns, to keep history immutable.
        IF OLD.usage IS NULL AND NEW.usage IS NOT NULL
           AND jsonb_typeof(NEW.usage) = 'object'
           AND (to_jsonb(NEW) - ARRAY['usage', 'input_tokens', 'output_tokens'])
               IS NOT DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['usage', 'input_tokens', 'output_tokens'])
           AND (OLD.input_tokens IS NULL OR NEW.input_tokens IS NOT DISTINCT FROM OLD.input_tokens)
           AND (OLD.output_tokens IS NULL OR NEW.output_tokens IS NOT DISTINCT FROM OLD.output_tokens) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Terminal run is immutable';
    END IF;
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
