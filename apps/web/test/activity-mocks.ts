/** No activity source connected: the default for screens whose tests aren't about activities. */
export const NO_INTEGRATIONS = { strava: { available: false, connection: null } };

/** Answer the integrations read before delegating every other request to a test's own mock. */
export function withoutIntegrations<T extends (path: string, ...args: never[]) => unknown>(
  get: T,
): T {
  return ((path: string, ...args: never[]) =>
    path === '/api/v1/integrations'
      ? Promise.resolve({ data: NO_INTEGRATIONS })
      : get(path, ...args)) as T;
}
