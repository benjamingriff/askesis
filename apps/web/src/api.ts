import { createAskesisClient } from '@askesis/api-client';

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

export function configureAuthTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

export const api = createAskesisClient(import.meta.env.VITE_API_BASE_URL ?? '');

api.use({
  async onRequest({ request }) {
    const token = await tokenProvider?.();
    if (token !== null && token !== undefined) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
});
