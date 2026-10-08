-- Operator provenance, separate from immutable plan content. A failed publication
-- rolls back both the plan and this marker in the same transaction.
CREATE TABLE example_plan_editions (
    owner_id uuid NOT NULL REFERENCES athletes(id),
    blueprint_revision text NOT NULL CHECK (length(blueprint_revision) BETWEEN 1 AND 100),
    anchor_date date NOT NULL,
    plan_id uuid NOT NULL UNIQUE REFERENCES plans(id),
    published_state_version integer NOT NULL CHECK (published_state_version > 0),
    published_content_hash text NOT NULL CHECK (published_content_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, blueprint_revision, anchor_date)
);
