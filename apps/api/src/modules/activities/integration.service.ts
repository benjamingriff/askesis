import type { Selectable } from 'kysely';
import { getApiConfig } from '../../config.js';
import { getDatabase } from '../../database/client.js';
import type { IntegrationConnections } from '../../database/generated.js';
import {
  ActivityDetailSchema,
  ActivityListSchema,
  IntegrationsStateSchema,
  type IntegrationsState,
} from './activity.schemas.js';
import { decryptSecret, encryptSecret, signOAuthState, verifyOAuthState } from './secrets.js';
import { StravaClient, StravaError, type StravaToken } from './strava.client.js';
import { toActivityDetail, toActivitySummary } from './strava.mapping.js';

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

const STATE_LIFETIME_MS = 10 * 60 * 1000;
/** The picker searches this many days either side of the workout's date. */
export const SEARCH_DAYS = 7;

let fetcher: typeof fetch = (...args) => fetch(...args);
/** Database tests replace Strava's network. */
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
      'Strava no longer accepts this connection. Reconnect it in Settings.',
      409,
    );
  if (error.kind === 'rate_limited')
    throw new IntegrationError(
      'STRAVA_RATE_LIMITED',
      'Strava’s request limit is used up for now. Try again in 15 minutes.',
      503,
    );
  if (error.kind === 'not_found')
    throw new IntegrationError(
      'ACTIVITY_NOT_FOUND',
      'Strava couldn’t find that activity on your account. It may have been deleted.',
      404,
    );
  throw new IntegrationError(
    'STRAVA_UNAVAILABLE',
    'Strava didn’t respond as expected. Try again shortly.',
    502,
  );
}

export async function connectionFor(athleteId: string): Promise<Connection | undefined> {
  return getDatabase()
    .selectFrom('integration_connections')
    .selectAll()
    .where('athlete_id', '=', athleteId)
    .where('provider', '=', 'strava')
    .executeTakeFirst();
}

export async function readIntegrations(athleteId: string): Promise<IntegrationsState> {
  const connection = await connectionFor(athleteId);
  return IntegrationsStateSchema.parse({
    strava: {
      available: stravaSettings() !== null,
      connection: connection
        ? {
            status: connection.status,
            displayName: connection.display_name,
            connectedAt: new Date(connection.connected_at).toISOString(),
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
      // Connecting a different Strava account replaces the old one and its links.
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
  return readIntegrations(athleteId);
}

/**
 * A usable access token. Refreshing rotates the refresh token, so it happens under a row lock:
 * concurrent requests wait for the first refresh and reuse its result.
 */
async function accessToken(athleteId: string, now: Date) {
  const { client, key } = requireStrava();
  const fresh = (connection: Connection) =>
    new Date(connection.access_token_expires_at).getTime() - now.getTime() > 5 * 60 * 1000;
  const connection = await connectionFor(athleteId);
  if (!connection)
    throw new IntegrationError('STRAVA_NOT_CONNECTED', 'Connect Strava in Settings first.', 404);
  if (connection.status === 'reauthorization_required')
    fromStrava(new StravaError('unauthorized', 401));
  if (fresh(connection))
    return { client, connection, token: decryptSecret(connection.access_token_ciphertext, key) };
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      const locked = await db
        .selectFrom('integration_connections')
        .selectAll()
        .where('id', '=', connection.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (fresh(locked))
        return {
          client,
          connection: locked,
          token: decryptSecret(locked.access_token_ciphertext, key),
        };
      const token = await client
        .refresh(decryptSecret(locked.refresh_token_ciphertext, key))
        .catch(fromStrava);
      await db
        .updateTable('integration_connections')
        .set(tokenColumns(token, key))
        .where('id', '=', locked.id)
        .execute();
      return { client, connection: locked, token: token.access_token };
    });
}

/** Run a Strava read with the athlete's token, marking the connection when Strava rejects it. */
async function withStrava<T>(
  athleteId: string,
  now: Date,
  read: (client: StravaClient, token: string, connection: Connection) => Promise<T>,
): Promise<T> {
  try {
    const { client, token, connection } = await accessToken(athleteId, now);
    return await read(client, token, connection);
  } catch (error) {
    const unauthorized =
      (error instanceof StravaError && error.kind === 'unauthorized') ||
      (error instanceof IntegrationError && error.code === 'STRAVA_REAUTHORIZATION_REQUIRED');
    if (unauthorized)
      await getDatabase()
        .updateTable('integration_connections')
        .set({ status: 'reauthorization_required' })
        .where('athlete_id', '=', athleteId)
        .where('provider', '=', 'strava')
        .execute();
    return fromStrava(error);
  }
}

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The athlete's Strava activities in the week either side of a day, newest first, read live.
 * The window is widened by a day at each end because Strava filters by UTC start, then
 * trimmed by each activity's local date.
 */
export async function listStravaActivities(athleteId: string, around: string, now = new Date()) {
  const from = shift(around, -SEARCH_DAYS),
    to = shift(around, SEARCH_DAYS);
  return withStrava(athleteId, now, async (client, token) => {
    const listed = await client.listActivities(
      token,
      {
        after: new Date(`${shift(from, -1)}T00:00:00Z`),
        before: new Date(`${shift(to, 2)}T00:00:00Z`),
      },
      1,
      100,
    );
    const activities = listed
      .map(toActivitySummary)
      .filter((activity) => activity.date >= from && activity.date <= to)
      .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
    return ActivityListSchema.parse({ from, to, activities });
  });
}

export async function readStravaActivity(athleteId: string, activityId: string, now = new Date()) {
  return withStrava(athleteId, now, async (client, token) =>
    ActivityDetailSchema.parse(toActivityDetail(await client.getActivity(token, activityId))),
  );
}

/** Confirms the activity is on the athlete's connected account before linking it. */
export async function verifyStravaActivity(
  athleteId: string,
  activityId: string,
  now = new Date(),
) {
  return withStrava(athleteId, now, async (client, token, connection) => {
    await client.getActivity(token, activityId);
    return connection;
  });
}

/** Revoke Askesis at Strava and delete the connection and every link made with it. */
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
