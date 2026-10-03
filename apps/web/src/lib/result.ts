/** Unwraps an openapi-fetch response, surfacing the API's safe error message. */
export function result<T>(response: { data?: T; error?: unknown }): T {
  if (response.data !== undefined) return response.data;
  const error = response.error as { error?: { message?: string } } | undefined;
  throw new Error(
    error?.error?.message ?? 'The request failed. Check your connection and try again.',
  );
}
