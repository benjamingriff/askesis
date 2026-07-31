import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAuthTokenProvider, createAuthenticatedApiClient } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Askesis API client authentication', () => {
  it('attaches the current Clerk session token', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer session-token');
      return new Response(JSON.stringify({ workouts: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    configureAuthTokenProvider(async () => 'session-token');
    const client = createAuthenticatedApiClient('http://askesis.test');

    const result = await client.GET('/api/v1/workouts');

    expect(result.data).toEqual({ workouts: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
