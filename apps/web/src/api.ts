import { createAskesisClient } from '@askesis/api-client';

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

/**
 * Every request reports the device's timezone. The athlete's "today" (when new pace guides
 * apply, and the coach's sense of dates) follows wherever they are using the app.
 */
function setDeviceTimezone(headers: Headers) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timezone) headers.set('X-Askesis-Timezone', timezone);
}

export function configureAuthTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

export function createAuthenticatedApiClient(baseUrl: string) {
  const client = createAskesisClient(baseUrl);
  client.use({
    async onRequest({ request }) {
      const token = await tokenProvider?.();
      if (token !== null && token !== undefined) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      setDeviceTimezone(request.headers);
      return request;
    },
  });
  return client;
}

export const api = createAuthenticatedApiClient(import.meta.env.VITE_API_BASE_URL ?? '');

export async function authenticatedFetch(path: string, options: RequestInit = {}) {
  const token = await tokenProvider?.();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  setDeviceTimezone(headers);
  return fetch(`${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}${path}`, {
    ...options,
    headers,
  });
}
