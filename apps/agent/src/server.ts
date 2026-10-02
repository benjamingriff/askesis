import { AgentApi } from './api.js';
import { parseAgentConfig } from './config.js';
import { SdkRuntime } from './runtime.js';
import { Worker } from './worker.js';
const config = parseAgentConfig(process.env);
const worker = new Worker(
  config,
  new AgentApi(config.AGENT_API_URL),
  new SdkRuntime(config),
  (code, runId) => {
    // Never log provider errors, prompts, tool payloads or credentials.
    console.log(JSON.stringify({ service: 'askesis-agent', code, ...(runId ? { runId } : {}) }));
  },
);
const stop = () => worker.stop();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
await worker.run().catch(() => {
  console.error('Agent worker failed to start.');
  process.exitCode = 1;
});
