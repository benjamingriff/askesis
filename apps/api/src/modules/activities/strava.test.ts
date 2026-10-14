import { describe, expect, it, vi } from 'vitest';
import { readRateUsage, StravaClient, StravaError } from './strava.client.js';
import { sportFor, toActivityValues } from './strava.mapping.js';

const endpoints = {
  clientId: '12345',
  clientSecret: 'client-secret-value',
  oauthBaseUrl: 'https://www.strava.com',
  apiBaseUrl: 'https://www.strava.com/api/v3',
};

describe('Strava mapping', () => {
  it('groups sport types by the sport a plan prescribes', () => {
    expect(sportFor('TrailRun')).toBe('run');
    expect(sportFor('VirtualRide')).toBe('cycle');
    expect(sportFor('WeightTraining')).toBe('strength');
    expect(sportFor('EBikeRide')).toBe('other');
    expect(sportFor('Walk')).toBe('other');
  });

  it('keeps the local training day and drops invalid numbers', () => {
    const values = toActivityValues({
      id: '987',
      name: 'Evening run',
      sport_type: 'Run',
      workout_type: 1,
      // 23:30 in Sydney is still the 12th there, though the UTC start is the 12th 12:30.
      start_date: '2026-10-12T12:30:00Z',
      start_date_local: '2026-10-12T23:30:00Z',
      elapsed_time: 1800.4,
      moving_time: 1750,
      distance: 5012.3,
      average_speed: -1,
      average_watts: null,
    });
    expect(values).toMatchObject({
      local_date: '2026-10-12',
      started_at: '2026-10-12T12:30:00.000Z',
      elapsed_seconds: 1800,
      distance_metres: 5012.3,
      average_speed_mps: null,
      race: true,
      sport: 'run',
    });
  });
});

describe('Strava client', () => {
  it('requests read-only activity access with the signed state', () => {
    const url = new URL(
      new StravaClient(endpoints).authorizeUrl('http://localhost:5173/cb', 'signed'),
    );
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: '12345',
      response_type: 'code',
      scope: 'read,activity:read_all',
      state: 'signed',
    });
  });

  it('records rate usage and classifies failures without exposing bodies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"message":"Authorization Error","token":"leak"}', {
        status: 401,
        headers: { 'X-ReadRateLimit-Usage': '12,340', 'X-ReadRateLimit-Limit': '100,1000' },
      }),
    );
    const client = new StravaClient(endpoints, fetcher);
    const failure = await client.listLaps('token', '1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StravaError);
    expect((failure as StravaError).kind).toBe('unauthorized');
    expect((failure as Error).message).not.toContain('leak');
    expect(client.usage).toEqual({
      shortUsage: 12,
      dailyUsage: 340,
      shortLimit: 100,
      dailyLimit: 1000,
    });
    expect(readRateUsage(new Headers())).toBeNull();
  });

  it('sends client credentials only in the token request body and revocation header', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: 'a', refresh_token: 'r', expires_at: 1 }),
    );
    const client = new StravaClient(endpoints, fetcher);
    await client.refresh('old-refresh');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://www.strava.com/api/v3/oauth/token');
    expect(String(init?.body)).toContain('grant_type=refresh_token');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await client.revoke('r');
    const [revokeUrl, revokeInit] = fetcher.mock.calls[1]!;
    expect(String(revokeUrl)).toBe('https://www.strava.com/oauth/revoke');
    expect(new Headers(revokeInit?.headers).get('Authorization')).toBe(
      `Basic ${Buffer.from('12345:client-secret-value').toString('base64')}`,
    );
  });
});
