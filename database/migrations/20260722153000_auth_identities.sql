-- Link external authentication identities to Askesis athletes and grant plan access.

CREATE TABLE athlete_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (length(trim(provider)) > 0),
    provider_subject text NOT NULL CHECK (length(trim(provider_subject)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT athlete_identities_provider_subject_key UNIQUE (provider, provider_subject),
    CONSTRAINT athlete_identities_athlete_provider_key UNIQUE (athlete_id, provider)
);

CREATE INDEX athlete_identities_athlete_id_idx
    ON athlete_identities(athlete_id);

CREATE TABLE plan_memberships (
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, athlete_id)
);

CREATE INDEX plan_memberships_athlete_plan_idx
    ON plan_memberships(athlete_id, plan_id);

COMMENT ON TABLE athlete_identities IS
    'Maps an external authentication subject, such as a Clerk user ID, to an Askesis athlete.';

COMMENT ON TABLE plan_memberships IS
    'Grants an athlete access to a plan owned by another athlete. Plan ownership remains authoritative in plans.owner_id.';
