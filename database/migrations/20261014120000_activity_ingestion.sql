-- Recorded activities from connected providers, kept apart from immutable prescriptions.
-- Strava is the first provider. Its API policy allows a transient cache of at most seven
-- days, so activity rows are refreshed by every sync and purged once stale; only the
-- athlete's own link/reject decisions outlive the cache. Disconnecting deletes everything
-- derived from the connection through the cascades below.

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
 last_synced_at timestamptz,
 last_sync_error text CHECK (last_sync_error IS NULL OR length(last_sync_error) BETWEEN 1 AND 200),
 -- A sync lease: one sync per connection at a time, reclaimable if a process dies mid-sync.
 sync_started_at timestamptz,
 UNIQUE (athlete_id, provider),
 UNIQUE (provider, provider_athlete_id)
);

-- Normalized activity summaries. Only fields that planned-versus-actual comparisons use are
-- kept: no routes, heart rate streams or raw provider payloads.
CREATE TABLE activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 athlete_id uuid NOT NULL REFERENCES athletes(id),
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 source_activity_id text NOT NULL CHECK (length(source_activity_id) BETWEEN 1 AND 100),
 sport text NOT NULL CHECK (sport IN ('run', 'cycle', 'swim', 'strength', 'row', 'other')),
 source_sport_type text NOT NULL CHECK (length(source_sport_type) BETWEEN 1 AND 100),
 name text NOT NULL CHECK (length(name) <= 500),
 started_at timestamptz NOT NULL,
 -- The calendar day where the activity happened, which is what plans schedule against.
 local_date date NOT NULL,
 elapsed_seconds integer NOT NULL CHECK (elapsed_seconds >= 0),
 moving_seconds integer CHECK (moving_seconds >= 0),
 distance_metres numeric(12,3) CHECK (distance_metres >= 0),
 elevation_gain_metres numeric(10,2),
 average_speed_mps numeric(8,3) CHECK (average_speed_mps >= 0),
 average_watts numeric(8,2) CHECK (average_watts >= 0),
 trainer boolean NOT NULL DEFAULT false,
 manual boolean NOT NULL DEFAULT false,
 race boolean NOT NULL DEFAULT false,
 fetched_at timestamptz NOT NULL,
 laps_fetched_at timestamptz,
 UNIQUE (connection_id, source_activity_id),
 UNIQUE (id, athlete_id)
);
CREATE INDEX activities_athlete_date_idx ON activities(athlete_id, local_date);
CREATE INDEX activities_fetched_idx ON activities(connection_id, fetched_at);

CREATE TABLE activity_laps (
 activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
 lap_index integer NOT NULL CHECK (lap_index >= 1),
 elapsed_seconds integer NOT NULL CHECK (elapsed_seconds >= 0),
 moving_seconds integer CHECK (moving_seconds >= 0),
 distance_metres numeric(12,3) CHECK (distance_metres >= 0),
 average_speed_mps numeric(8,3) CHECK (average_speed_mps >= 0),
 average_watts numeric(8,2) CHECK (average_watts >= 0),
 PRIMARY KEY (activity_id, lap_index)
);

-- The athlete's decisions about automatic matching: pin an activity to a workout, or reject a
-- suggested pairing. Workouts are addressed by plan and lineage so decisions survive unlock,
-- edits and relocking; activities by provider id so decisions survive cache purges.
CREATE TABLE activity_match_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 athlete_id uuid NOT NULL REFERENCES athletes(id),
 plan_id uuid NOT NULL REFERENCES plans(id),
 workout_lineage_id uuid NOT NULL,
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 source_activity_id text NOT NULL CHECK (length(source_activity_id) BETWEEN 1 AND 100),
 decision text NOT NULL CHECK (decision IN ('link', 'reject')),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (plan_id, workout_lineage_id, connection_id, source_activity_id)
);
CREATE INDEX activity_match_overrides_plan_idx ON activity_match_overrides(plan_id);
