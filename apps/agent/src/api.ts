import { z } from 'zod';
export const ClaimSchema = z.object({
  runId: z.string().uuid(),
  token: z.string(),
  generation: z.number(),
  deadlineAt: z.string(),
  versionId: z.string().nullable(),
  editNumber: z.number().nullable(),
});
export type Claim = z.infer<typeof ClaimSchema>;
export const ContextSchema = z.object({
  messages: z.array(
    z.object({ role: z.enum(['user', 'assistant']), content: z.string(), sequence: z.number() }),
  ),
  historyTruncated: z.boolean(),
  plan: z.unknown(),
  brief: z.unknown(),
  /** The athlete's calibration timeline, today and timezone; present with or without a plan. */
  performance: z.unknown(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.string(), z.unknown()),
    }),
  ),
  versionId: z.string().nullable(),
  editNumber: z.number().nullable(),
});
export type ExecutionContext = z.infer<typeof ContextSchema>;
export const ToolResultSchema = z.object({
  result: z.unknown(),
  versionId: z.string().nullable(),
  editNumber: z.number().nullable(),
  planId: z.string().nullable(),
});
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(`Agent API rejected request: ${code}`);
  }
}
export class AgentApi {
  constructor(
    private baseUrl: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async request<T>(
    path: string,
    token: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
    retry = false,
  ): Promise<T> {
    // A tool retry reuses the exact operation ID, input and expected edit number.
    // Never retry a model run or generate a fresh mutation key after uncertain delivery.
    const attempts = retry ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetcher(
          `${this.baseUrl.replace(/\/$/, '')}/internal/agent${path}`,
          {
            method: body === undefined ? 'GET' : 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
              : AbortSignal.timeout(20000),
            redirect: 'error',
          },
        );
        if (!response.ok) {
          if (response.status >= 500 && attempt + 1 < attempts) continue;
          let code = 'API_ERROR';
          try {
            const data = z
              .object({ error: z.object({ code: z.string() }) })
              .parse(await response.json());
            code = data.error.code;
          } catch {
            /* Keep server payloads out of exceptions. */
          }
          throw new ApiError(code, response.status);
        }
        return schema.parse(await response.json());
      } catch (error) {
        if (error instanceof ApiError || signal?.aborted || attempt + 1 === attempts) throw error;
      }
    }
    throw new ApiError('API_UNREACHABLE', 503);
  }
  register(token: string, input: unknown) {
    return this.request('/register', token, z.object({ registered: z.boolean() }), input);
  }
  claim(token: string, workerId: string) {
    return this.request('/claim', token, z.object({ claim: ClaimSchema.nullable() }), { workerId });
  }
  context(claim: Claim, signal: AbortSignal) {
    return this.request(
      `/runs/${claim.runId}/context`,
      claim.token,
      ContextSchema,
      undefined,
      signal,
    );
  }
  heartbeat(claim: Claim) {
    return this.request(
      `/runs/${claim.runId}/heartbeat`,
      claim.token,
      z.object({ status: z.string(), deadlineAt: z.string() }),
      {},
    );
  }
  tool(claim: Claim, command: unknown, signal: AbortSignal) {
    return this.request(
      `/runs/${claim.runId}/tools`,
      claim.token,
      ToolResultSchema,
      command,
      signal,
      true,
    );
  }
  progress(claim: Claim, input: unknown, signal: AbortSignal) {
    return this.request(
      `/runs/${claim.runId}/progress`,
      claim.token,
      z.object({ status: z.string() }),
      input,
      signal,
    );
  }
  finish(claim: Claim, input: unknown) {
    return this.request(
      `/runs/${claim.runId}/finish`,
      claim.token,
      z.object({ status: z.string() }),
      input,
      undefined,
      true,
    );
  }
}
