/** Benchmark worker process. Configuration arrives over IPC; no database or Clerk environment is inherited. */
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AgentApi, type Claim } from '@askesis/agent/api';
import { parseAgentConfig } from '@askesis/agent/config';
import { SdkRuntime } from '@askesis/agent/runtime';
import { Worker } from '@askesis/agent/worker';
import { Artifacts, redact } from './artifacts.js';
import { scriptedCoach } from './scripted.js';
import { providerFailure } from './models.js';
import { installInterruptHandlers } from './local.js';
import type { Scenario } from './scenario.js';

class RecordingApi extends AgentApi {
  constructor(
    url: string,
    private artifacts: Artifacts,
  ) {
    super(url);
  }
  override async tool(claim: Claim, command: unknown, signal: AbortSignal) {
    const request = z
      .object({ name: z.string(), operationId: z.string(), input: z.unknown() })
      .parse(command);
    console.log(`Tool: ${request.name} — started`);
    const started = Date.now();
    const trace = async (value: unknown) =>
      appendFile(
        resolve(this.artifacts.directory, 'tool-trace.jsonl'),
        JSON.stringify(redact(value)) + '\n',
        { mode: 0o600 },
      );
    await trace({
      at: new Date().toISOString(),
      runId: claim.runId,
      ...request,
      status: 'started',
    });
    try {
      const result = await super.tool(claim, command, signal);
      await trace({
        at: new Date().toISOString(),
        runId: claim.runId,
        operationId: request.operationId,
        name: request.name,
        status: 'completed',
        elapsedMs: Date.now() - started,
        result,
      });
      await this.artifacts.event({
        stage: 'tool_completed',
        runId: claim.runId,
        name: request.name,
      });
      console.log(`Tool: ${request.name} — completed`);
      return result;
    } catch (error) {
      await trace({
        at: new Date().toISOString(),
        runId: claim.runId,
        operationId: request.operationId,
        name: request.name,
        status: 'failed',
      });
      console.log(`Tool: ${request.name} — failed`);
      throw error;
    }
  }
}

let worker: Worker | undefined;
let started = false;
let stopping = false;
const stop = () => {
  stopping = true;
  worker?.stop();
};
const removeInterruptHandlers = installInterruptHandlers(stop);
process.on('disconnect', stop);
process.on('message', (message: unknown) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'stop') {
    stop();
    return;
  }
  if (started) return;
  started = true;
  void execute(message)
    .catch(() => {
      console.error('Benchmark worker could not start or complete.');
      process.exitCode = 1;
    })
    .finally(() => {
      removeInterruptHandlers();
      if (process.connected) process.disconnect();
    });
});

async function execute(message: unknown) {
  const input = z
    .object({
      type: z.literal('start'),
      config: z.record(z.string(), z.union([z.string(), z.number()])),
      directory: z.string(),
      scriptedScenario: z.unknown().nullable(),
    })
    .strict()
    .parse(message);
  if (process.env.DATABASE_URL || process.env.CLERK_SECRET_KEY)
    throw new Error('Worker environment must not contain database or Clerk credentials.');
  const config = parseAgentConfig(
    Object.fromEntries(Object.entries(input.config).map(([key, value]) => [key, String(value)])),
  );
  const artifacts = new Artifacts(input.directory);
  const runtime = new SdkRuntime(
    config,
    input.scriptedScenario ? scriptedCoach(input.scriptedScenario as Scenario) : undefined,
  );
  worker = new Worker(config, new RecordingApi(config.AGENT_API_URL, artifacts), {
    async execute(...args) {
      try {
        return await runtime.execute(...args);
      } catch (error) {
        const diagnostic = providerFailure(error);
        await artifacts.event({ stage: 'coach_failed', ...diagnostic });
        console.error(
          `Coach request failed: ${diagnostic.category}${diagnostic.httpStatus ? ` (HTTP ${diagnostic.httpStatus})` : ''}.`,
        );
        throw error;
      }
    },
  });
  if (stopping) worker.stop();
  await worker.run();
}
