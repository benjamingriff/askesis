import { z } from 'zod';

/**
 * A minimal Strava API client: OAuth token exchange, refresh and revocation, the athlete's
 * activity list and per-activity laps. Responses are parsed to the fields Askesis keeps.
 * https://developers.strava.com/docs/reference/
 */
export type StravaEndpoints = {
  clientId: string;
  clientSecret: string;
  oauthBaseUrl: string;
  apiBaseUrl: string;
};

export type StravaErrorKind = 'unauthorized' | 'rate_limited' | 'unavailable' | 'rejected';

export class StravaError extends Error {
  constructor(
    public kind: StravaErrorKind,
    public status: number | null,
  ) {
    super(`Strava request failed (${kind}${status === null ? '' : `, HTTP ${status}`}).`);
  }
}

export const StravaTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int(),
  scope: z.string().optional(),
  athlete: z
    .object({
      id: z.union([z.number(), z.string()]).transform(String),
      firstname: z.string().nullish(),
      lastname: z.string().nullish(),
    })
    .optional(),
});
export type StravaToken = z.infer<typeof StravaTokenSchema>;

const number = z.number().nullish();
export const StravaActivitySchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  name: z.string().nullish(),
  sport_type: z.string().nullish(),
  type: z.string().nullish(),
  workout_type: number,
  start_date: z.string(),
  start_date_local: z.string(),
  elapsed_time: z.number(),
  moving_time: number,
  distance: number,
  total_elevation_gain: number,
  average_speed: number,
  average_watts: number,
  trainer: z.boolean().nullish(),
  manual: z.boolean().nullish(),
});
export type StravaActivity = z.infer<typeof StravaActivitySchema>;

export const StravaLapSchema = z.object({
  lap_index: z.number().int().nullish(),
  elapsed_time: z.number(),
  moving_time: number,
  distance: number,
  average_speed: number,
  average_watts: number,
});
export type StravaLap = z.infer<typeof StravaLapSchema>;

export type RateUsage = {
  shortUsage: number;
  shortLimit: number;
  dailyUsage: number;
  dailyLimit: number;
};

/** Read-limit usage from response headers ("15-minute,daily"), falling back to overall limits. */
export function readRateUsage(headers: Headers): RateUsage | null {
  const pair = (name: string) => headers.get(name)?.split(',').map(Number);
  const usage = pair('x-readratelimit-usage') ?? pair('x-ratelimit-usage');
  const limit = pair('x-readratelimit-limit') ?? pair('x-ratelimit-limit');
  if (!usage || !limit || [...usage, ...limit].some((value) => !Number.isFinite(value)))
    return null;
  return {
    shortUsage: usage[0]!,
    dailyUsage: usage[1]!,
    shortLimit: limit[0]!,
    dailyLimit: limit[1]!,
  };
}

export class StravaClient {
  /** Latest read-limit usage seen, so callers can stop before exhausting the app's quota. */
  usage: RateUsage | null = null;

  constructor(
    private endpoints: StravaEndpoints,
    private fetcher: typeof fetch = fetch,
  ) {}

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL('/oauth/authorize', this.endpoints.oauthBaseUrl);
    url.search = new URLSearchParams({
      client_id: this.endpoints.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      approval_prompt: 'auto',
      // Private ("Only you") activities are training too; nothing is written back.
      scope: 'read,activity:read_all',
      state,
    }).toString();
    return url.toString();
  }

  exchangeCode(code: string): Promise<StravaToken> {
    return this.token({ grant_type: 'authorization_code', code });
  }

  refresh(refreshToken: string): Promise<StravaToken> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Revoke the app's access. Strava answers 200 whether or not the token still existed. */
  async revoke(token: string): Promise<void> {
    const basic = Buffer.from(`${this.endpoints.clientId}:${this.endpoints.clientSecret}`).toString(
      'base64',
    );
    await this.request(new URL('/oauth/revoke', this.endpoints.oauthBaseUrl), {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ token, token_type_hint: 'refresh_token' }),
    });
  }

  /** One page of the athlete's activities that started in (after, before), newest last. */
  async listActivities(
    accessToken: string,
    window: { after: Date; before: Date },
    page: number,
    perPage: number,
  ): Promise<StravaActivity[]> {
    const url = this.api('/athlete/activities');
    url.search = new URLSearchParams({
      after: String(Math.floor(window.after.getTime() / 1000)),
      before: String(Math.floor(window.before.getTime() / 1000)),
      page: String(page),
      per_page: String(perPage),
    }).toString();
    const response = await this.request(url, { headers: bearer(accessToken) });
    return z.array(StravaActivitySchema).parse(await response.json());
  }

  async listLaps(accessToken: string, activityId: string): Promise<StravaLap[]> {
    const url = this.api(`/activities/${encodeURIComponent(activityId)}/laps`);
    const response = await this.request(url, { headers: bearer(accessToken) });
    return z.array(StravaLapSchema).parse(await response.json());
  }

  private api(path: string) {
    return new URL(`${this.endpoints.apiBaseUrl.replace(/\/$/, '')}${path}`);
  }

  private async token(grant: Record<string, string>): Promise<StravaToken> {
    const response = await this.request(this.api('/oauth/token'), {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.endpoints.clientId,
        client_secret: this.endpoints.clientSecret,
        ...grant,
      }),
    });
    return StravaTokenSchema.parse(await response.json());
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new StravaError('unavailable', null);
    }
    this.usage = readRateUsage(response.headers) ?? this.usage;
    if (response.ok) return response;
    // Error bodies can echo request details; never surface them.
    await response.body?.cancel();
    const kind: StravaErrorKind =
      response.status === 401
        ? 'unauthorized'
        : response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'unavailable'
            : 'rejected';
    throw new StravaError(kind, response.status);
  }
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
