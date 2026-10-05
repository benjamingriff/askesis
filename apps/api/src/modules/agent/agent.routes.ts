import { saveProgress } from '../live/live.service.js';
import { ProgressSchema } from '../live/live.schemas.js';
import { timingSafeEqual } from 'node:crypto';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppEnvironment } from '../../auth/types.js';
import { getApiConfig } from '../../config.js';
import { Id } from '../plans/plan.common.js';
import { ChatError } from '../chat/chat.core.js';
import { ClaimSchema, RegisterSchema, ToolRequestSchema } from './agent.schemas.js';
import {
  claimRun,
  digest,
  executeTool,
  finishRun,
  heartbeatRun,
  registerWorker,
  runContext,
} from './agent.service.js';

const FinishSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'cancelled']),
    content: z.string().max(32000).optional(),
    finalOutputItemId: z.string().min(1).max(200).optional(),
    failureCode: z
      .enum([
        'PROVIDER_ERROR',
        'TURN_LIMIT',
        'TOOL_LIMIT',
        'OUTPUT_LIMIT',
        'EXECUTION_TIMEOUT',
        'WORKER_SHUTDOWN',
        'STALE_CONTEXT',
        'EXECUTION_ERROR',
      ])
      .optional(),
    inputTokens: z.number().int().nonnegative().max(100000000).optional(),
    outputTokens: z.number().int().nonnegative().max(100000000).optional(),
  })
  .strict();
const runId = (value: string) => {
  if (!Id.safeParse(value).success)
    throw new ChatError('INVALID_RUN', 'Invalid run identity.', 400);
  return value;
};
const token = (value: string | undefined) => {
  if (!value?.startsWith('Bearer ') || value.length > 512)
    throw new ChatError('MACHINE_AUTH_REQUIRED', 'A machine credential is required.', 401);
  return value.slice(7);
};
async function parse<T>(schema: z.ZodType<T>, json: Promise<unknown>) {
  let value: unknown;
  try {
    value = await json;
  } catch {
    throw new ChatError('INVALID_BODY', 'Send a valid JSON body.', 400);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ChatError('VALIDATION_ERROR', 'The request is invalid.', 400);
  return parsed.data;
}
export function registerAgentRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.use('/internal/agent/*', async (c, next) => {
    if (getApiConfig().CHAT_EXECUTION_MODE !== 'agent')
      throw new ChatError('AGENT_UNAVAILABLE', 'Agent execution is disabled.', 503);
    const credential = token(c.req.header('authorization'));
    if (!c.req.path.startsWith('/internal/agent/runs/')) {
      const expected = getApiConfig().AGENT_BOOTSTRAP_TOKEN;
      if (
        !expected ||
        !timingSafeEqual(Buffer.from(digest(credential)), Buffer.from(digest(expected)))
      )
        throw new ChatError('MACHINE_AUTH_REQUIRED', 'Invalid machine credential.', 401);
    }
    await next();
  });
  app.use(
    '/internal/agent/*',
    bodyLimit({
      maxSize: 1000000,
      onError: () => {
        throw new ChatError('BODY_TOO_LARGE', 'The request body is too large.', 400);
      },
    }),
  );
  app.post('/internal/agent/register', async (c) =>
    c.json(await registerWorker(await parse(RegisterSchema, c.req.json()))),
  );
  app.post('/internal/agent/claim', async (c) =>
    c.json(await claimRun((await parse(ClaimSchema, c.req.json())).workerId)),
  );
  app.get('/internal/agent/runs/:runId/context', async (c) =>
    c.json(
      (await runContext(
        runId(c.req.param('runId')),
        token(c.req.header('authorization')),
      )) as Record<string, unknown>,
    ),
  );
  app.post('/internal/agent/runs/:runId/heartbeat', async (c) =>
    c.json(await heartbeatRun(runId(c.req.param('runId')), token(c.req.header('authorization')))),
  );
  app.post('/internal/agent/runs/:runId/tools', async (c) =>
    c.json(
      (await executeTool(
        runId(c.req.param('runId')),
        token(c.req.header('authorization')),
        await parse(ToolRequestSchema, c.req.json()),
      )) as unknown,
    ),
  );
  app.post('/internal/agent/runs/:runId/progress', async (c) =>
    c.json(
      await saveProgress(
        runId(c.req.param('runId')),
        token(c.req.header('authorization')),
        await parse(ProgressSchema, c.req.json()),
      ),
    ),
  );
  app.post('/internal/agent/runs/:runId/finish', async (c) =>
    c.json(
      await finishRun(
        runId(c.req.param('runId')),
        token(c.req.header('authorization')),
        await parse(FinishSchema, c.req.json()),
      ),
    ),
  );
}
