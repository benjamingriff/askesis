import { Usage } from '@openai/agents';
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
  modelResponse,
  modelStreamResponder,
} from '@openai/agents/testing';
import { AgentApi } from './api.js';
import { parseAgentConfig } from './config.js';
import { SdkRuntime } from './runtime.js';
import { Worker } from './worker.js';
if (process.env.NODE_ENV !== 'test')
  throw new Error('The scripted smoke worker is forbidden outside test mode.');
const config = parseAgentConfig(process.env);
const model = new ScriptedModel([
  modelResponse({
    usage: new Usage(),
    output: [functionCall('read_performance', {}, { callId: 'smoke-performance' })],
  }),
  modelResponse({
    usage: new Usage(),
    output: [assistantMessage('Smoke worker completed the scoped tool round trip.')],
  }),
  modelStreamResponder(() =>
    (async function* () {
      yield { type: 'response_started' as const };
      yield {
        type: 'output_text_delta' as const,
        itemId: 'partial-smoke',
        delta: 'Visible text before a simulated provider failure.',
      };
      await new Promise((resolve) => setTimeout(resolve, 100));
      throw new Error('Scripted failure after visible text');
    })(),
  ),
]);
const worker = new Worker(
  config,
  new AgentApi(config.AGENT_API_URL),
  new SdkRuntime(config, model),
  (code) => console.log(JSON.stringify({ service: 'askesis-agent-smoke', code })),
);
process.once('SIGTERM', () => worker.stop());
process.once('SIGINT', () => worker.stop());
await worker.run();
