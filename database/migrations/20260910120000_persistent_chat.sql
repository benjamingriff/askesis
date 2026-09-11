ALTER TABLE plans ADD CONSTRAINT plans_id_owner_unique UNIQUE (id, owner_id);

CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES athletes(id),
    plan_id uuid,
    title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    archived_at timestamptz,
    state_version integer NOT NULL DEFAULT 1 CHECK (state_version > 0),
    next_sequence integer NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    activity_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    UNIQUE (id, owner_id, plan_id),
    FOREIGN KEY (plan_id, owner_id) REFERENCES plans(id, owner_id)
);
CREATE INDEX conversations_owner_activity ON conversations(owner_id, activity_at DESC, id DESC);
CREATE INDEX conversations_plan ON conversations(plan_id);

CREATE TABLE conversation_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    sequence integer NOT NULL CHECK (sequence > 0),
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 32000),
    producing_run_id uuid,
    context jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, sequence),
    UNIQUE (id, conversation_id),
    UNIQUE (producing_run_id),
    CHECK ((role = 'assistant') = (producing_run_id IS NOT NULL))
);

CREATE TABLE agent_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    plan_id uuid,
    user_message_id uuid NOT NULL UNIQUE,
    context jsonb,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled')),
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    cancel_requested_at timestamptz,
    finished_at timestamptz,
    deadline_at timestamptz NOT NULL DEFAULT now() + interval '30 seconds',
    provider text,
    model text,
    input_tokens integer CHECK (input_tokens >= 0),
    output_tokens integer CHECK (output_tokens >= 0),
    cost_amount numeric CHECK (cost_amount >= 0),
    cost_currency text,
    UNIQUE (id, conversation_id),
    FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id),
    FOREIGN KEY (conversation_id, owner_id, plan_id) REFERENCES conversations(id, owner_id, plan_id),
    FOREIGN KEY (user_message_id, conversation_id) REFERENCES conversation_messages(id, conversation_id),
    CHECK ((status IN ('completed', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
    CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
    CHECK ((cost_amount IS NULL) = (cost_currency IS NULL))
);
ALTER TABLE conversation_messages ADD FOREIGN KEY (producing_run_id, conversation_id) REFERENCES agent_runs(id, conversation_id);
CREATE UNIQUE INDEX agent_runs_active_conversation ON agent_runs(conversation_id) WHERE status IN ('queued', 'running', 'cancelling');
CREATE UNIQUE INDEX agent_runs_active_plan ON agent_runs(plan_id) WHERE plan_id IS NOT NULL AND status IN ('queued', 'running', 'cancelling');
CREATE INDEX agent_runs_work ON agent_runs(status, created_at);
CREATE INDEX agent_runs_conversation_history ON agent_runs(conversation_id, created_at DESC);

CREATE TABLE agent_run_events (
    run_id uuid NOT NULL REFERENCES agent_runs(id),
    sequence integer NOT NULL CHECK (sequence > 0),
    type text NOT NULL CHECK (type IN ('queued', 'started', 'cancel_requested', 'completed', 'failed', 'cancelled')),
    metadata jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(metadata::text) <= 16384),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, sequence)
);

CREATE FUNCTION protect_chat_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Chat history is append-only';
END;
$$;
CREATE TRIGGER immutable_messages BEFORE UPDATE OR DELETE ON conversation_messages FOR EACH ROW EXECUTE FUNCTION protect_chat_history();
CREATE TRIGGER immutable_run_events BEFORE UPDATE OR DELETE ON agent_run_events FOR EACH ROW EXECUTE FUNCTION protect_chat_history();

CREATE FUNCTION protect_agent_run() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER guard_agent_run BEFORE INSERT OR UPDATE OR DELETE ON agent_runs FOR EACH ROW EXECUTE FUNCTION protect_agent_run();
