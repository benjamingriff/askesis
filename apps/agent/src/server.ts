import { AgentApi } from './api.js';
import { parseAgentConfig } from './config.js';
import { createWorkerReporter, failureDetails } from './logger.js';
import { PROMPT_VERSION } from './prompt.js';
import { createRuntime } from './runtime/index.js';
import { Worker } from './worker.js';
let report = createWorkerReporter({});
try {
  const config = parseAgentConfig(process.env);
  const worker = new Worker(
    config,
    new AgentApi(config.AGENT_API_URL),
    createRuntime(config),
    (code, runId, details) => report(code, runId, details),
  );
  report = createWorkerReporter({
    workerId: worker.id,
    provider: config.AGENT_PROVIDER,
    model: config.AGENT_MODEL,
    promptVersion: PROMPT_VERSION,
    apiHost: new URL(config.AGENT_API_URL).host,
  });
  report('WORKER_STARTING');
  const stop = () => worker.stop();
  // The SDK checks for other signal listeners after its asynchronous cleanup. A once
  // listener disappears too early, allowing the SDK to exit before worker cleanup finishes.
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    await worker.run();
    report('WORKER_STOPPED');
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
} catch (error) {
  report('WORKER_START_FAILED', undefined, { phase: 'startup', ...failureDetails(error) });
  process.exitCode = 1;
}
