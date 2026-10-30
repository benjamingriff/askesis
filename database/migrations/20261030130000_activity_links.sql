-- Manual links between planned workouts and activities recorded elsewhere, starting with Strava.
-- Askesis stores no activity data: details are fetched from the provider whenever the athlete
-- views them. Only the connection's credentials and the athlete's chosen activity identifiers
-- are kept, and disconnecting deletes both through the cascade below.

-- One connection per athlete and provider, and one Askesis athlete per provider account.
-- Tokens are encrypted by the API before storage; the database never holds a usable credential.
CREATE TABLE integration_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 athlete_id uuid NOT NULL REFERENCES athletes(id),
 provider text NOT NULL CHECK (provider IN ('strava')),
 provider_athlete_id text NOT NULL CHECK (length(provider_athlete_id) BETWEEN 1 AND 100),
 display_name text CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200),
 scopes text[] NOT NULL,
 access_token_ciphertext text NOT NULL CHECK (length(access_token_ciphertext) <= 2000),
 refresh_token_ciphertext text NOT NULL CHECK (length(refresh_token_ciphertext) <= 2000),
 access_token_expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reauthorization_required')),
 connected_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (athlete_id, provider),
 UNIQUE (provider, provider_athlete_id)
);

-- The athlete's choice of which activity was this workout. Workouts are addressed by plan and
-- lineage, like workout logs, so a link survives unlock, edits and relocking. An activity
-- belongs to at most one workout per plan.
CREATE TABLE workout_activity_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 athlete_id uuid NOT NULL REFERENCES athletes(id),
 plan_id uuid NOT NULL REFERENCES plans(id),
 workout_lineage_id uuid NOT NULL,
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 provider_activity_id text NOT NULL CHECK (provider_activity_id ~ '^[0-9]{1,20}$'),
 linked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (plan_id, workout_lineage_id),
 UNIQUE (plan_id, connection_id, provider_activity_id)
);
CREATE INDEX workout_activity_links_connection_idx ON workout_activity_links (connection_id);
