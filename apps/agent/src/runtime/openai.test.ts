import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentApi, type ExecutionContext } from '../api.js';
import { parseAgentConfig } from '../config.js';
import { scriptedOpenAI } from '../testing.js';
import { createRuntime } from './index.js';

beforeEach(() => {
  vi.spyOn(AgentApi.prototype, 'progress').mockResolvedValue({ status: 'running' });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Network is forbidden in deterministic runtime tests.'))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const claim = {
  runId: '00000000-0000-4000-8000-000000000010',
  token: 'run-token',
  generation: 1,
  deadlineAt: new Date(Date.now() + 60000).toISOString(),
  versionId: null,
  editNumber: null,
};
const context: ExecutionContext = {
  messages: [{ role: 'user', content: 'Help me start running', sequence: 1 }],
  historyTruncated: false,
  plan: null,
  brief: null,
  performance: null,
  versionId: null,
  editNumber: null,
  tools: [
    {
      name: 'read_plan_context',
      description: 'Read scoped plan context',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ],
};

it('streams through the SDK with serial tools, configured reasoning and explicit privacy settings', async () => {
  const model = scriptedOpenAI([
    { type: 'tools', calls: [{ name: 'read_plan_context', input: {} }] },
    { type: 'reply', text: 'What would you like to achieve?' },
  ]);
  const config = parseAgentConfig({
    OPENAI_API_KEY: 'test-key',
    AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
    AGENT_REASONING: 'high',
  });
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'tool').mockResolvedValue({
    result: {},
    versionId: null,
    editNumber: null,
    planId: null,
  });
  await createRuntime(config, { openai: model }).execute(
    context,
    claim,
    api,
    new AbortController().signal,
    new AbortController().signal,
  );
  expect(model.calls.every((call) => call.streamed)).toBe(true);
  expect(model.calls[0]!.request.modelSettings).toMatchObject({
    reasoning: { effort: 'high' },
    parallelToolCalls: false,
    store: false,
    maxTokens: 12000,
  });
  expect(model.calls[0]!.request.tracing).toBe(false);
  expect(model.calls[0]!.request.systemInstructions).toContain(
    'Do not instantly generate a schedule',
  );
});
