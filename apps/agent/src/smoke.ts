import { AgentApi } from './api.js';
import { parseAgentConfig } from './config.js';
import { createRuntime } from './runtime/index.js';
import { scriptedOverrides } from './testing.js';
import { Worker } from './worker.js';
if (process.env.NODE_ENV !== 'test')
  throw new Error('The scripted smoke worker is forbidden outside test mode.');
const config = parseAgentConfig(process.env);
// The same script runs through whichever provider runtime AGENT_PROVIDER selects.
const overrides = scriptedOverrides(config.AGENT_PROVIDER, [
  { type: 'tools', calls: [{ name: 'read_performance', input: {}, id: 'smoke-performance' }] },
  { type: 'reply', text: 'Smoke worker completed the scoped tool round trip.' },
  { type: 'interrupted', text: 'Visible text before a simulated provider failure.', delayMs: 100 },
]);
const worker = new Worker(
  config,
  new AgentApi(config.AGENT_API_URL),
  createRuntime(config, overrides),
  (code) => console.log(JSON.stringify({ service: 'askesis-agent-smoke', code })),
);
process.once('SIGTERM', () => worker.stop());
process.once('SIGINT', () => worker.stop());
await worker.run();
