import { afterEach, expect, it, vi } from 'vitest';
import { AgentApi, type ExecutionContext } from './api.js';
import { parseAgentConfig } from './config.js';
import { Worker } from './worker.js';
const config = parseAgentConfig({
  OPENAI_API_KEY: 'test',
  AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
});
const claim = {
  runId: '00000000-0000-4000-8000-000000000010',
  token: 'token',
  generation: 1,
  deadlineAt: new Date(Date.now() + 600000).toISOString(),
  versionId: null,
  editNumber: null,
};
const context: ExecutionContext = {
  messages: [],
  historyTruncated: false,
  plan: null,
  brief: null,
  tools: [],
  versionId: null,
  editNumber: null,
};
afterEach(() => vi.useRealTimers());
it('maps completed output and usage into one final API command', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'completed' });
  const runtime = {
    execute: vi
      .fn()
      .mockResolvedValue({ content: 'What is your goal?', inputTokens: 12, outputTokens: 5 }),
  };
  await new Worker(config, api, runtime).execute(claim);
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, {
    status: 'completed',
    content: 'What is your goal?',
    inputTokens: 12,
    outputTokens: 5,
  });
});
it('aborts the runtime on cancellation and acknowledges it without a final assistant reply', async () => {
  vi.useFakeTimers();
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  vi.spyOn(api, 'heartbeat').mockResolvedValue({
    status: 'cancelling',
    deadlineAt: claim.deadlineAt,
  });
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'cancelled' });
  const runtime = {
    execute: vi.fn(
      async (_context, _claim, _api, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }),
        ),
    ),
  };
  const execution = new Worker(config, api, runtime).execute(claim);
  await vi.advanceTimersByTimeAsync(15000);
  await execution;
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, { status: 'cancelled' });
});
it('reports provider failure while leaving already committed tool receipts to the API', async () => {
  const api = new AgentApi('http://localhost');
  vi.spyOn(api, 'context').mockResolvedValue(context);
  const finish = vi.spyOn(api, 'finish').mockResolvedValue({ status: 'failed' });
  const runtime = { execute: vi.fn().mockRejectedValue(new Error('Provider unavailable')) };
  await new Worker(config, api, runtime).execute(claim);
  expect(finish).toHaveBeenCalledExactlyOnceWith(claim, {
    status: 'failed',
    failureCode: 'PROVIDER_ERROR',
  });
});
