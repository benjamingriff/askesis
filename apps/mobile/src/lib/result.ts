/** Unwraps an openapi-fetch response, surfacing the API's safe error message. */
export function result<T>(response: { data?: T; error?: unknown; response?: Response }): T {
  if (response.data !== undefined) return response.data;
  const error = response.error as { error?: { message?: string } } | undefined;
  throw new RequestError(
    error?.error?.message ?? 'The request failed. Check your connection and try again.',
    response.response?.status ?? 0,
  );
}

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
