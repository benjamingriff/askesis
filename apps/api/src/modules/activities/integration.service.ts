import { sql, type Selectable } from 'kysely';
import { getApiConfig } from '../../config.js';
import { getDatabase } from '../../database/client.js';
import type { IntegrationConnections } from '../../database/generated.js';
import { localDate } from '../athletes/timezone.js';
import { addDays } from './activity.dates.js';
import { IntegrationsStateSchema, type IntegrationsState } from './activity.schemas.js';
import { decryptSecret, encryptSecret, signOAuthState, verifyOAuthState } from './secrets.js';
import { StravaClient, StravaError, type StravaToken } from './strava.client.js';
import { toActivityValues, toLapValues, type ActivityValues } from './strava.mapping.js';

/** A rejected integration command with its public code and HTTP status. */
export class IntegrationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 404 | 409 | 422 | 502 | 503 = 409,
  ) {
    super(message);
  }
}

type Connection = Selectable<IntegrationConnections>;

/** Strava's API policy allows a transient cache of at most seven days. */
export const CACHE_DAYS = 7;
/** Laps cost one request each; spend at most this many per sync on the sessions that need them. */
const LAP_BUDGET = 30;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const SYNC_LEASE_SECONDS = 120;
const STATE_LIFETIME_MS = 10 * 60 * 1000;

let fetcher: typeof fetch = (...args) => fetch(...args);
/** Database tests and the local simulator replace Strava's network. */
export function useStravaFetch(next: typeof fetch) {
  fetcher = next;
}

function stravaSettings() {
  const config = getApiConfig();
  if (
    !config.STRAVA_CLIENT_ID ||
    !config.STRAVA_CLIENT_SECRET ||
    !config.INTEGRATION_ENCRYPTION_KEY
  )
    return null;
  return {
    key: config.INTEGRATION_ENCRYPTION_KEY,
    client: new StravaClient(
      {
        clientId: config.STRAVA_CLIENT_ID,
        clientSecret: config.STRAVA_CLIENT_SECRET,
        oauthBaseUrl: config.STRAVA_OAUTH_BASE_URL,
        apiBaseUrl: config.STRAVA_API_BASE_URL,
      },
      fetcher,
    ),
  };
}

function requireStrava() {
  const settings = stravaSettings();
  if (!settings)
    throw new IntegrationError(
      'STRAVA_NOT_CONFIGURED',
      'Strava is not configured on this server.',
      422,
    );
  return settings;
}

/** Strava failures as public errors; response bodies are never forwarded. */
function fromStrava(error: unknown): never {
  if (!(error instanceof StravaError)) throw error;
  if (error.kind === 'unauthorized')
    throw new IntegrationError(
      'STRAVA_REAUTHORIZATION_REQUIRED',
      'Strava no longer accepts this connection. Connect again to continue syncing.',
      409,
    );
  if (error.kind === 'rate_limited')
    throw new IntegrationError(
      'STRAVA_RATE_LIMITED',
      'Strava’s request limit is used up for now. Try again in 15 minutes.',
      503,
    );
  throw new IntegrationError(
    'STRAVA_UNAVAILABLE',
    'Strava didn’t respond as expected. Try again shortly.',
    502,
  );
}

async function connectionFor(athleteId: string): Promise<Connection | undefined> {
  return getDatabase()
    .selectFrom('integration_connections')
    .selectAll()
    .where('athlete_id', '=', athleteId)
    .where('provider', '=', 'strava')
    .executeTakeFirst();
}

export async function readIntegrations(
  athleteId: string,
  now = new Date(),
): Promise<IntegrationsState> {
  const connection = await connectionFor(athleteId);
  const count = connection
    ? await getDatabase()
        .selectFrom('activities')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('connection_id', '=', connection.id)
        .executeTakeFirstOrThrow()
    : null;
  return IntegrationsStateSchema.parse({
    strava: {
      available: stravaSettings() !== null,
      connection: connection
        ? {
            status: connection.status,
            displayName: connection.display_name,
            connectedAt: new Date(connection.connected_at).toISOString(),
            lastSyncedAt: connection.last_synced_at
              ? new Date(connection.last_synced_at).toISOString()
              : null,
            lastSyncError: connection.last_sync_error,
            syncing:
              connection.sync_started_at !== null &&
              now.getTime() - new Date(connection.sync_started_at).getTime() <
                SYNC_LEASE_SECONDS * 1000,
            activityCount: Number(count?.count ?? 0),
          }
        : null,
    },
  });
}

/**
 * Strava redirects back to the web app, which completes the connection with the athlete's
 * session. Only this deployment's own web origins may receive the code.
 */
function checkRedirect(redirectUri: string) {
  const url = new URL(redirectUri);
  const parties = getApiConfig().clerkAuthorizedParties;
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  const allowed = parties ? parties.includes(url.origin) : local;
  if (!allowed || url.pathname !== '/connections/strava/callback' || url.search || url.hash)
    throw new IntegrationError('REDIRECT_NOT_ALLOWED', 'This return address is not allowed.', 422);
}

export function startStravaConnection(athleteId: string, redirectUri: string, now = Date.now()) {
  const { client, key } = requireStrava();
  checkRedirect(redirectUri);
  const state = signOAuthState(
    { athleteId, provider: 'strava', expiresAt: now + STATE_LIFETIME_MS },
    key,
  );
  return { url: client.authorizeUrl(redirectUri, state) };
}

const tokenColumns = (token: StravaToken, key: string) => ({
  access_token_ciphertext: encryptSecret(token.access_token, key),
  refresh_token_ciphertext: encryptSecret(token.refresh_token, key),
  access_token_expires_at: new Date(token.expires_at * 1000),
});

export async function completeStravaConnection(
  athleteId: string,
  input: { code: string; state: string; scope: string },
  now = new Date(),
): Promise<IntegrationsState> {
  const { client, key } = requireStrava();
  if (!verifyOAuthState(input.state, key, { athleteId, provider: 'strava' }, now.getTime()))
    throw new IntegrationError(
      'CONNECTION_EXPIRED',
      'This connection attempt expired or belongs to another session. Start again.',
      422,
    );
  const token = await client.exchangeCode(input.code).catch(fromStrava);
  const scopes = (token.scope ?? input.scope).split(/[ ,]+/).filter(Boolean);
  if (!scopes.some((scope) => scope === 'activity:read' || scope === 'activity:read_all')) {
    await client.revoke(token.refresh_token).catch(() => undefined);
    throw new IntegrationError(
      'ACTIVITY_SCOPE_REQUIRED',
      'Askesis needs permission to view your activities. Connect again and keep that box ticked.',
      422,
    );
  }
  if (!token.athlete)
    throw new IntegrationError('STRAVA_UNAVAILABLE', 'Strava didn’t identify the account.', 502);
  const providerAthleteId = token.athlete.id;
  const name = [token.athlete.firstname, token.athlete.lastname].filter(Boolean).join(' ');
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      const owner = await db
        .selectFrom('integration_connections')
        .select('athlete_id')
        .where('provider', '=', 'strava')
        .where('provider_athlete_id', '=', providerAthleteId)
        .executeTakeFirst();
      // Strava grants one authorization per account, so revoking here would also cut off the
      // other Askesis account. Refuse instead.
      if (owner && owner.athlete_id !== athleteId)
        throw new IntegrationError(
          'STRAVA_ACCOUNT_IN_USE',
          'This Strava account is already connected to another Askesis account.',
          409,
        );
      // Connecting a different Strava account replaces the old one and everything from it.
      await db
        .deleteFrom('integration_connections')
        .where('athlete_id', '=', athleteId)
        .where('provider', '=', 'strava')
        .where('provider_athlete_id', '<>', providerAthleteId)
        .execute();
      const values = {
        ...tokenColumns(token, key),
        display_name: name ? name.slice(0, 200) : null,
        scopes,
        status: 'active',
        last_sync_error: null,
      };
      await db
        .insertInto('integration_connections')
        .values({
          ...values,
          athlete_id: athleteId,
          provider: 'strava',
          provider_athlete_id: providerAthleteId,
          connected_at: now,
        })
        .onConflict((conflict) => conflict.columns(['athlete_id', 'provider']).doUpdateSet(values))
        .execute();
    });
  return readIntegrations(athleteId, now);
}

/** A usable access token, refreshing (and storing the rotated refresh token) when close to expiry. */
async function accessToken(connection: Connection, client: StravaClient, key: string, now: Date) {
  if (new Date(connection.access_token_expires_at).getTime() - now.getTime() > 5 * 60 * 1000)
    return decryptSecret(connection.access_token_ciphertext, key);
  const token = await client.refresh(decryptSecret(connection.refresh_token_ciphertext, key));
  await getDatabase()
    .updateTable('integration_connections')
    .set(tokenColumns(token, key))
    .where('id', '=', connection.id)
    .execute();
  return token.access_token;
}

/**
 * The sync window: from a week before the earliest active plan starts (capped at six months),
 * or the last four weeks when no plan is active, through tomorrow.
 */
async function syncWindow(athleteId: string, today: string) {
  const { rows } = await sql<{ start: string | null }>`
    SELECT min(v.start_date)::text AS start FROM plans p
    JOIN plan_versions v ON v.id = p.current_locked_version_id
    WHERE p.owner_id = ${athleteId} AND p.activated_at IS NOT NULL AND p.archived_at IS NULL`.execute(
    getDatabase(),
  );
  const earliest = rows[0]?.start ? addDays(rows[0].start, -7) : addDays(today, -28);
  const start = [earliest, addDays(today, -180)].sort().at(-1)!;
  return { startDate: start, after: new Date(`${addDays(start, -1)}T00:00:00Z`) };
}

/** Delete activities and laps older than the cache allows. Returns the activities removed. */
export async function purgeExpiredActivities(now = new Date(), connectionId?: string) {
  const cutoff = new Date(now.getTime() - CACHE_DAYS * 86_400_000);
  return getDatabase()
    .transaction()
    .execute(async (tx) => {
      const stale = tx
        .selectFrom('activities')
        .select('id')
        .where('laps_fetched_at', '<', cutoff)
        .$if(!!connectionId, (query) => query.where('connection_id', '=', connectionId!));
      await tx.deleteFrom('activity_laps').where('activity_id', 'in', stale).execute();
      await tx
        .updateTable('activities')
        .set({ laps_fetched_at: null })
        .where('laps_fetched_at', '<', cutoff)
        .$if(!!connectionId, (query) => query.where('connection_id', '=', connectionId!))
        .execute();
      const expired = await tx
        .deleteFrom('activities')
        .where('fetched_at', '<', cutoff)
        .$if(!!connectionId, (query) => query.where('connection_id', '=', connectionId!))
        .executeTakeFirst();
      return Number(expired.numDeletedRows);
    });
}

export async function syncStrava(athleteId: string, now = new Date()) {
  const { client, key } = requireStrava();
  const db = getDatabase();
  const claimed = await db
    .updateTable('integration_connections')
    .set({ sync_started_at: now })
    .where('athlete_id', '=', athleteId)
    .where('provider', '=', 'strava')
    .where((eb) =>
      eb.or([
        eb('sync_started_at', 'is', null),
        eb('sync_started_at', '<', new Date(now.getTime() - SYNC_LEASE_SECONDS * 1000)),
      ]),
    )
    .returningAll()
    .executeTakeFirst();
  if (!claimed) {
    if (!(await connectionFor(athleteId)))
      throw new IntegrationError('STRAVA_NOT_CONNECTED', 'Connect Strava first.', 404);
    throw new IntegrationError('SYNC_IN_PROGRESS', 'A sync is already running.', 409);
  }
  const release = (values: {
    last_synced_at?: Date;
    last_sync_error: string | null;
    status?: string;
  }) =>
    db
      .updateTable('integration_connections')
      .set({ ...values, sync_started_at: null })
      .where('id', '=', claimed.id)
      .execute();
  try {
    const token = await accessToken(claimed, client, key, now);
    const athlete = await db
      .selectFrom('athletes')
      .select('timezone')
      .where('id', '=', athleteId)
      .executeTakeFirstOrThrow();
    const window = await syncWindow(athleteId, localDate(athlete.timezone, now));
    const listed: ActivityValues[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const activities = await client.listActivities(
        token,
        { after: window.after, before: new Date(now.getTime() + 86_400_000) },
        page,
        PAGE_SIZE,
      );
      listed.push(...activities.map(toActivityValues));
      if (activities.length < PAGE_SIZE) break;
    }
    const existing = new Set(
      (
        await db
          .selectFrom('activities')
          .select('source_activity_id')
          .where('connection_id', '=', claimed.id)
          .execute()
      ).map((row) => row.source_activity_id),
    );
    const seen = new Set(listed.map((activity) => activity.source_activity_id));
    let removed = 0;
    await db.transaction().execute(async (tx) => {
      for (const activity of listed) {
        const values = { ...activity, fetched_at: now };
        await tx
          .insertInto('activities')
          .values({ ...values, athlete_id: athleteId, connection_id: claimed.id })
          .onConflict((conflict) =>
            conflict.columns(['connection_id', 'source_activity_id']).doUpdateSet(values),
          )
          .execute();
      }
      // Deleted or now-private-to-others activities disappear here too (policy: reflect deletions).
      const gone = await tx
        .deleteFrom('activities')
        .where('connection_id', '=', claimed.id)
        .where('started_at', '>=', window.after)
        .$if(seen.size > 0, (query) => query.where('source_activity_id', 'not in', [...seen]))
        .executeTakeFirst();
      removed = Number(gone.numDeletedRows);
    });
    removed += await purgeExpiredActivities(now, claimed.id);
    const lapsFetched = await fetchLaps(athleteId, claimed.id, client, token, now);
    await release({ last_synced_at: now, last_sync_error: null, status: 'active' });
    return {
      imported: [...seen].filter((id) => !existing.has(id)).length,
      updated: [...seen].filter((id) => existing.has(id)).length,
      removed,
      lapsFetched,
      integrations: await readIntegrations(athleteId, now),
    };
  } catch (error) {
    const code =
      error instanceof StravaError
        ? error.kind === 'unauthorized'
          ? 'STRAVA_REAUTHORIZATION_REQUIRED'
          : error.kind === 'rate_limited'
            ? 'STRAVA_RATE_LIMITED'
            : 'STRAVA_UNAVAILABLE'
        : 'SYNC_FAILED';
    await release({
      last_sync_error: code,
      ...(code === 'STRAVA_REAUTHORIZATION_REQUIRED' ? { status: 'reauthorization_required' } : {}),
    });
    return fromStrava(error);
  }
}

/**
 * Laps for endurance activities near a structured workout in an active plan, or linked to one by
 * the athlete (up to a week away): those are the sessions whose reps can be checked. Missing laps come first, then the stalest. Stops early
 * when the app's shared read quota runs low, leaving the rest for the next sync.
 */
async function fetchLaps(
  athleteId: string,
  connectionId: string,
  client: StravaClient,
  token: string,
  now: Date,
) {
  const { rows } = await sql<{ id: string; source_activity_id: string }>`
    SELECT a.id, a.source_activity_id FROM activities a
    WHERE a.connection_id = ${connectionId} AND a.sport IN ('run', 'cycle', 'swim')
      AND (a.laps_fetched_at IS NULL OR a.laps_fetched_at < ${new Date(now.getTime() - 86_400_000 * (CACHE_DAYS - 1))})
      AND EXISTS (
        SELECT 1 FROM workouts w
        JOIN plans p ON p.current_locked_version_id = w.plan_version_id
        WHERE p.owner_id = ${athleteId} AND p.activated_at IS NOT NULL AND p.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM workout_steps s WHERE s.workout_id = w.id AND s.kind = 'repeat')
          AND (w.scheduled_date BETWEEN a.local_date - 3 AND a.local_date + 3
            OR EXISTS (SELECT 1 FROM activity_match_overrides o
              WHERE o.plan_id = p.id AND o.workout_lineage_id = w.lineage_id AND o.decision = 'link'
                AND o.connection_id = a.connection_id
                AND o.source_activity_id = a.source_activity_id)))
    ORDER BY a.laps_fetched_at NULLS FIRST, a.local_date DESC
    LIMIT ${LAP_BUDGET}`.execute(getDatabase());
  let fetched = 0;
  for (const row of rows) {
    const usage = client.usage;
    if (
      usage &&
      (usage.shortUsage >= usage.shortLimit * 0.8 || usage.dailyUsage >= usage.dailyLimit * 0.9)
    )
      break;
    let laps;
    try {
      laps = await client.listLaps(token, row.source_activity_id);
    } catch (error) {
      if (error instanceof StravaError && error.kind === 'rate_limited') break;
      throw error;
    }
    await getDatabase()
      .transaction()
      .execute(async (tx) => {
        await tx.deleteFrom('activity_laps').where('activity_id', '=', row.id).execute();
        const values = toLapValues(laps).map((lap) => ({ ...lap, activity_id: row.id }));
        if (values.length) await tx.insertInto('activity_laps').values(values).execute();
        await tx
          .updateTable('activities')
          .set({ laps_fetched_at: now })
          .where('id', '=', row.id)
          .execute();
      });
    fetched += 1;
  }
  return fetched;
}

/** Revoke Askesis at Strava and delete everything that came from the connection. */
export async function disconnectStrava(athleteId: string) {
  const connection = await connectionFor(athleteId);
  if (!connection) return readIntegrations(athleteId);
  const settings = stravaSettings();
  if (settings) {
    // Local data goes regardless, even when the token can no longer be decrypted after a key
    // change: the athlete asked for it to.
    try {
      await settings.client.revoke(
        decryptSecret(connection.refresh_token_ciphertext, settings.key),
      );
    } catch {
      // Best effort: the grant can also be revoked from Strava's settings.
    }
  }
  await getDatabase()
    .deleteFrom('integration_connections')
    .where('id', '=', connection.id)
    .execute();
  return readIntegrations(athleteId);
}

export function startActivityCacheSweeper() {
  let pending: Promise<unknown> | undefined;
  const tick = () => {
    pending ??= purgeExpiredActivities()
      .catch(() => undefined)
      .finally(() => {
        pending = undefined;
      });
  };
  tick();
  const interval = setInterval(tick, 60 * 60 * 1000);
  interval.unref();
  return async () => {
    clearInterval(interval);
    await pending;
  };
}
