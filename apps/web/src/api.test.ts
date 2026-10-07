import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticatedFetch,
  configureAuthTokenProvider,
  createAuthenticatedApiClient,
} from './api';

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

    const result = await client.GET('/api/v1/workouts', {
      params: { query: { planVersionId: '00000000-0000-0000-0000-000000000050' } },
    });

    expect(result.data).toEqual({ workouts: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports the device timezone on typed and raw requests', async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string, init?: RequestInit) => {
        seen.push(
          input instanceof Request
            ? input.headers.get('x-askesis-timezone')
            : new Headers(init?.headers).get('x-askesis-timezone'),
        );
        return new Response('{"workouts":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    configureAuthTokenProvider(async () => 'session-token');
    await createAuthenticatedApiClient('http://askesis.test').GET('/api/v1/workouts', {
      params: { query: { planVersionId: '00000000-0000-0000-0000-000000000050' } },
    });
    await authenticatedFetch('/api/v1/live/bootstrap');
    expect(seen).toEqual([timezone, timezone]);
  });
});
