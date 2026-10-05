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
try {
  const result = await runner.run(agent, 'How many runs per week are in this test context?', {
    maxTurns: 3,
    stream: true,
    signal: AbortSignal.timeout(60000),
  });
  let visibleCharacters = 0;
  for await (const event of result)
    if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta')
      visibleCharacters += event.data.delta.length;
  await result.completed;
  if (result.error) throw new Error('Streamed compatibility check failed.');
  if (!visibleCharacters) throw new Error('No streamed visible text.');
  if (calls !== 1 || typeof result.finalOutput !== 'string' || !result.finalOutput.includes('3'))
    throw new Error('The selected model did not complete the expected tool round trip.');
  console.log(
    JSON.stringify({
      passed: true,
      model: agent.model,
      toolCalls: calls,
      streamedVisibleCharacters: visibleCharacters,
      inputTokens: result.runContext.usage.inputTokens,
      outputTokens: result.runContext.usage.outputTokens,
    }),
  );
} catch (error) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  console.error(
    JSON.stringify({
      passed: false,
      code: 'PROVIDER_CHECK_FAILED',
      ...(typeof status === 'number' ? { status } : {}),
    }),
  );
  process.exitCode = 1;
}
