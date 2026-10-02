import { Agent, Runner, OpenAIProvider, tool, setTracingDisabled } from '@openai/agents';
import { z } from 'zod';
// Bounded provider check: proves the selected model can call a Responses tool.
// This does not replace the domain integration suite or consume private plan data.
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('Set OPENAI_API_KEY locally before running the live smoke test.');
setTracingDisabled(true);
let calls = 0;
const echo = tool({
  name: 'check_training_context',
  description: 'Read the known test running frequency.',
  parameters: z.object({}),
  execute: () => {
    calls++;
    return { runsPerWeek: 3 };
  },
});
const agent = new Agent({
  name: 'Askesis compatibility check',
  model: process.env.AGENT_MODEL ?? 'gpt-6.1-sol',
  instructions:
    'Call check_training_context once, then reply with the returned weekly run count. Do not answer without calling it.',
  tools: [echo],
  modelSettings: {
    reasoning: { effort: 'low' },
    parallelToolCalls: false,
    maxTokens: 1024,
    store: false,
  },
});
const runner = new Runner({
  modelProvider: new OpenAIProvider({ apiKey: key, useResponses: true }),
  tracingDisabled: true,
  traceIncludeSensitiveData: false,
});
const result = await runner.run(agent, 'How many runs per week are in this test context?', {
  maxTurns: 3,
  signal: AbortSignal.timeout(60000),
});
if (calls !== 1 || typeof result.finalOutput !== 'string' || !result.finalOutput.includes('3'))
  throw new Error('The selected model did not complete the expected tool round trip.');
console.log(
  JSON.stringify({
    passed: true,
    model: agent.model,
    toolCalls: calls,
    inputTokens: result.runContext.usage.inputTokens,
    outputTokens: result.runContext.usage.outputTokens,
  }),
);
