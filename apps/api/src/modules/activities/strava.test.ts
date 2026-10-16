import { describe, expect, it, vi } from 'vitest';
import { readRateUsage, StravaClient, StravaError } from './strava.client.js';
import { sportFor, toActivityDetail, toActivitySummary } from './strava.mapping.js';

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

  it('keeps the local day and time and drops invalid numbers', () => {
    const summary = toActivitySummary({
      id: '987',
      name: 'Evening run',
      sport_type: 'Run',
      // 23:30 in Sydney is still the 12th there, though the UTC start is the 12th 12:30.
      start_date: '2026-10-12T12:30:00Z',
      start_date_local: '2026-10-12T23:30:00Z',
      elapsed_time: 1800.4,
      moving_time: 1750,
      distance: 5012.3,
      total_elevation_gain: -1,
    });
    expect(summary).toEqual({
      provider: 'strava',
      id: '987',
      url: 'https://www.strava.com/activities/987',
      name: 'Evening run',
      sport: 'run',
      sportType: 'Run',
      date: '2026-10-12',
      startTime: '23:30',
      elapsedSeconds: 1800,
      movingSeconds: 1750,
      distanceMetres: 5012.3,
      elevationGainMetres: null,
    });
  });

  it('maps detail fields and numbers laps in order', () => {
    const detail = toActivityDetail({
      id: '5',
      sport_type: 'Ride',
      start_date: '2026-10-12T06:00:00Z',
      start_date_local: '2026-10-12T07:00:00Z',
      elapsed_time: 3600,
      average_heartrate: 141.6,
      device_name: 'Garmin Edge',
      laps: [
        { elapsed_time: 600, distance: 5000, average_speed: 8.3, average_watts: 201.4 },
        { lap_index: 9, elapsed_time: 620, distance: 5000, average_speed: 8.1 },
      ],
    });
    expect(detail).toMatchObject({
      sport: 'cycle',
      name: '',
      averageHeartrate: 142,
      deviceName: 'Garmin Edge',
      description: null,
      trainer: false,
      laps: [
        { index: 1, elapsedSeconds: 600, averageWatts: 201 },
        { index: 2, elapsedSeconds: 620, averageWatts: null },
      ],
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
    const failure = await client.getActivity('token', '1').catch((error: unknown) => error);
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
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(client.getActivity('token', '2')).rejects.toMatchObject({ kind: 'not_found' });
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
