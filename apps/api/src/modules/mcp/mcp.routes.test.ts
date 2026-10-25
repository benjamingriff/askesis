import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetApiConfigForTests } from '../../config.js';
import type * as Service from './mcp.service.js';

const owner = '00000000-0000-4000-8000-000000000001';
const token = 't'.repeat(43);
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), call: vi.fn() }));
vi.mock('../../auth/athlete-provisioning.js', () => ({ ensureAthlete: mocks.ensure }));
vi.mock('./mcp.service.js', async (original) => ({
  ...(await original<typeof Service>()),
  callMcpTool: mocks.call,
}));
const { app } = await import('../../app.js');
const { PlanError } = await import('../plans/plan.service.js');

const rpc = (body: unknown, credential = token) =>
  app.request('/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...(body as object) }),
  });
/** Answers arrive as JSON or as one SSE message event. */
const result = async (response: Response) => {
  const body = await response.text();
  const data = body.startsWith('{') ? body : body.match(/^data: (.*)$/m)![1]!;
  return (JSON.parse(data) as { result: Record<string, unknown> }).result;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MCP_DEV_TOKEN', token);
  vi.stubEnv('MCP_DEV_CLERK_USER_ID', 'user_mcpTest');
  resetApiConfigForTests();
  mocks.ensure.mockResolvedValue({ id: owner, displayName: 'Test', timezone: 'UTC' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetApiConfigForTests();
});

it('is absent unless development access is configured', async () => {
  vi.stubEnv('MCP_DEV_TOKEN', '');
  vi.stubEnv('MCP_DEV_CLERK_USER_ID', '');
  resetApiConfigForTests();
  expect((await rpc({ method: 'tools/list' })).status).toBe(404);
});
it('rejects a wrong token before resolving the athlete', async () => {
  const response = await rpc({ method: 'tools/list' }, 'x'.repeat(43));
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toBe('Bearer');
  expect(mocks.ensure).not.toHaveBeenCalled();
});
it('lists plan tools that name their plan and draft edit', async () => {
  const response = await rpc({ method: 'tools/list' });
  expect(response.status).toBe(200);
  const tools = (await result(response)).tools as {
    name: string;
    description: string;
    inputSchema: { required?: string[]; properties: Record<string, unknown> };
  }[];
  expect(tools.map((tool) => tool.name)).toContain('list_plans');
  const apply = tools.find((tool) => tool.name === 'apply_schedule_changes')!;
  expect(apply.inputSchema.required).toEqual(
    expect.arrayContaining(['planId', 'expectedEditNumber']),
  );
  expect(apply.inputSchema.properties).not.toHaveProperty('generation');
  expect(apply.description).not.toMatch(/generation/i);
  expect(mocks.ensure).toHaveBeenCalledWith(expect.anything(), 'user_mcpTest');
});
it('runs tools as the configured athlete and returns domain errors to the agent', async () => {
  mocks.call.mockResolvedValueOnce('{"plans":[]}');
  const listed = await result(
    await rpc({ method: 'tools/call', params: { name: 'list_plans', arguments: {} } }),
  );
  expect(listed).toMatchObject({ content: [{ type: 'text', text: '{"plans":[]}' }] });
  expect(mocks.call).toHaveBeenCalledWith(owner, 'list_plans', {});
  mocks.call.mockRejectedValueOnce(new PlanError('DRAFT_REQUIRED', 'Unlock first.'));
  const failed = await result(
    await rpc({
      method: 'tools/call',
      params: { name: 'validate_plan', arguments: { planId: owner } },
    }),
  );
  expect(failed).toMatchObject({ isError: true });
  expect(JSON.parse((failed.content as { text: string }[])[0]!.text)).toEqual({
    code: 'DRAFT_REQUIRED',
    message: 'Unlock first.',
  });
});
