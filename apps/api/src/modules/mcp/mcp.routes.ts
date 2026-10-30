import { createHash, timingSafeEqual } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { ensureAthlete } from '../../auth/athlete-provisioning.js';
import type { AppEnvironment } from '../../auth/types.js';
import { getApiConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { ChatError } from '../chat/chat.core.js';
import { PlanError } from '../plans/plan.service.js';
import { MCP_INSTRUCTIONS } from './mcp.guide.js';
import { callMcpTool } from './mcp.service.js';
import {
  MCP_PLAN_WRITES,
  MCP_TOOL_DESCRIPTIONS,
  McpToolSchemas,
  type McpToolName,
} from './mcp.tools.js';

const digest = (value: string) => createHash('sha256').update(value).digest();
const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true } : {}),
});

/** One server per request, bound to the authenticated athlete; nothing is kept between requests. */
function mcpServer(owner: string) {
  const server = new McpServer(
    { name: 'askesis', title: 'Askesis', version: '0.1.0' },
    { instructions: MCP_INSTRUCTIONS },
  );
  for (const name of Object.keys(McpToolSchemas) as McpToolName[]) {
    const reading = name.startsWith('read_') || name === 'list_plans' || name === 'validate_plan';
    server.registerTool(
      name,
      {
        description: MCP_TOOL_DESCRIPTIONS[name],
        inputSchema: McpToolSchemas[name],
        annotations: {
          readOnlyHint: reading || name === 'preview_performance',
          destructiveHint: MCP_PLAN_WRITES.includes(name),
          idempotentHint: reading,
        },
      },
      async (input: unknown) => {
        try {
          return text(await callMcpTool(owner, name, input));
        } catch (error) {
          // Domain errors are actionable for the agent; anything else stays opaque.
          if (error instanceof PlanError || error instanceof ChatError)
            return text(JSON.stringify({ code: error.code, message: error.message }), true);
          logger.error(
            { error: { name: error instanceof Error ? error.name : 'Error' }, tool: name },
            'MCP tool failed',
          );
          return text(
            JSON.stringify({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }),
            true,
          );
        }
      },
    );
  }
  server.registerPrompt(
    'coach',
    { title: 'Plan with Askesis', description: 'Coach me using my Askesis plans.' },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Coach me using my Askesis training plans. Follow this guidance:\n\n${MCP_INSTRUCTIONS}`,
          },
        },
      ],
    }),
  );
  return server;
}

const handler = createMcpHandler(
  (context) => mcpServer(String(context.authInfo?.extra?.athleteId)),
  { maxRequestBodySize: 1000000 },
);

/**
 * Development-only MCP access for the bring-your-own-agent spike
 * (docs/product/mcp-server-plan.md). A static token from `pnpm dev:mcp` acts as one configured
 * Clerk user; configuration refuses it in production. OAuth replaces this in a later phase.
 */
export function registerMcpRoutes(app: OpenAPIHono<AppEnvironment>) {
  app.all('/mcp', async (c) => {
    const config = getApiConfig();
    if (!config.MCP_DEV_TOKEN || !config.MCP_DEV_CLERK_USER_ID)
      throw new ChatError('NOT_FOUND', 'The requested resource was not found.', 404);
    const header = c.req.header('authorization') ?? '';
    const credential = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!timingSafeEqual(digest(credential), digest(config.MCP_DEV_TOKEN)))
      return c.json(
        {
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication is required.',
            requestId: c.get('requestId'),
          },
        },
        401,
        { 'WWW-Authenticate': 'Bearer' },
      );
    const clerk = createClerkClient({
      secretKey: config.CLERK_SECRET_KEY,
      publishableKey: config.CLERK_PUBLISHABLE_KEY,
    });
    const athlete = await ensureAthlete(clerk, config.MCP_DEV_CLERK_USER_ID);
    return handler.fetch(c.req.raw, {
      authInfo: {
        token: credential,
        clientId: 'askesis-development',
        scopes: [],
        extra: { athleteId: athlete.id },
      },
    });
  });
}
