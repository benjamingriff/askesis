import { createAskesisClient } from '@askesis/api-client';

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

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
      return request;
    },
  });
  return client;
}

export const api = createAuthenticatedApiClient(import.meta.env.VITE_API_BASE_URL ?? '');
