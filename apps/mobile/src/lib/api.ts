import { fetch as streamingFetch } from 'expo/fetch';
import createClient from 'openapi-fetch';
import type { paths } from './api-types';
import { apiBaseUrl } from './config';

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

export function configureAuthTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

/**
 * Every request reports the device's timezone. The athlete's "today" (when new pace guides
 * apply, and the coach's sense of dates) follows wherever they are using the app.
 */
function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

async function authHeaders(headers: Headers) {
  const token = await tokenProvider?.();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const timezone = deviceTimezone();
  if (timezone) headers.set('X-Waddle-Timezone', timezone);
}

export const api = createClient<paths>({ baseUrl: apiBaseUrl() });
api.use({
  async onRequest({ request }) {
    await authHeaders(request.headers);
    return request;
  },
});

/** Authenticated fetch whose body can be read as a stream (live updates). */
export async function authenticatedFetch(path: string, options: { signal?: AbortSignal } = {}) {
  const headers = new Headers();
  await authHeaders(headers);
  return streamingFetch(`${apiBaseUrl()}${path}`, {
    headers: Object.fromEntries(headers.entries()),
    signal: options.signal,
  });
}
