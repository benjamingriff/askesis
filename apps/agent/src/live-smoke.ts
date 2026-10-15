import { AgentApi, type Claim, type ExecutionContext } from './api.js';
import { parseAgentConfig } from './config.js';
import { createRuntime } from './runtime/index.js';
// Bounded provider check: proves the configured provider and model complete a streamed tool
// round trip through the production runtime. It uses no API, database or private plan data.
const environment = {
  AGENT_BOOTSTRAP_TOKEN: 'live-smoke-no-api-request-bootstrap-token',
  ...process.env,
  AGENT_MAX_TURNS: '3',
};
const config = parseAgentConfig(environment);
let calls = 0;
let visibleCharacters = 0;
class LocalApi extends AgentApi {
  override async tool(_claim: Claim, command: unknown) {
    calls++;
    if ((command as { name?: unknown }).name !== 'check_training_context')
      throw new Error('Unexpected tool.');
    return { result: { runsPerWeek: 3 }, versionId: null, editNumber: null, planId: null };
  }
  override async progress(_claim: Claim, input: unknown) {
    const items = (input as { items?: { content: string }[] }).items ?? [];
    visibleCharacters = Math.max(
      visibleCharacters,
      items.reduce((total, item) => total + item.content.length, 0),
    );
    return { status: 'running' };
  }
}
const context: ExecutionContext = {
  messages: [
    {
      role: 'user',
      content:
        'This is a compatibility check. Call check_training_context once, then tell me the weekly run count it returns.',
      sequence: 1,
    },
  ],
  historyTruncated: false,
  plan: null,
  brief: null,
  performance: null,
  trainingLog: null,
  versionId: null,
  editNumber: null,
  tools: [
    {
      name: 'check_training_context',
      description: 'Read the known test running frequency.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ],
};
const claim: Claim = {
  runId: '00000000-0000-4000-8000-000000000001',
  token: 'live-smoke',
  generation: 1,
  deadlineAt: new Date(Date.now() + 120000).toISOString(),
  versionId: null,
  editNumber: null,
};
try {
  const signal = AbortSignal.timeout(120000);
  const result = await createRuntime(config).execute(
    context,
    claim,
    new LocalApi('http://127.0.0.1'),
    signal,
    signal,
  );
  if (!visibleCharacters) throw new Error('No streamed visible text.');
  if (calls !== 1 || !result.content.includes('3'))
    throw new Error('The selected model did not complete the expected tool round trip.');
  console.log(
    JSON.stringify({
      passed: true,
      provider: config.AGENT_PROVIDER,
      model: config.AGENT_MODEL,
      toolCalls: calls,
      streamedVisibleCharacters: visibleCharacters,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }),
  );
} catch (error) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  console.error(
    JSON.stringify({
      passed: false,
      code: 'PROVIDER_CHECK_FAILED',
      provider: config.AGENT_PROVIDER,
      ...(typeof status === 'number' ? { status } : {}),
    }),
  );
  process.exitCode = 1;
}
