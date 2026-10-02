import {
  Agent,
  Runner,
  OpenAIProvider,
  tool,
  MaxTurnsExceededError,
  setTracingDisabled,
  user,
  assistant,
  type Model,
  type ToolInputParameters,
} from '@openai/agents';
import { randomUUID } from 'node:crypto';
import type { AgentConfig } from './config.js';
import { COACHING_PROMPT } from './prompt.js';
import { ApiError, type AgentApi, type Claim, type ExecutionContext } from './api.js';

// Explicit policy before constructing a provider or making any model request.
setTracingDisabled(true);
const MAX_MESSAGE_CHARACTERS = 32000;
export type RuntimeResult = { content: string; inputTokens: number; outputTokens: number };
export type CoachingRuntime = {
  execute(
    context: ExecutionContext,
    claim: Claim,
    api: AgentApi,
    signal: AbortSignal,
  ): Promise<RuntimeResult>;
};
export class SdkRuntime implements CoachingRuntime {
  private runner: Runner;
  constructor(
    private config: Pick<
      AgentConfig,
      | 'AGENT_MODEL'
      | 'AGENT_REASONING'
      | 'OPENAI_API_KEY'
      | 'AGENT_MAX_TURNS'
      | 'AGENT_MAX_OUTPUT_TOKENS'
    >,
    private modelOverride?: Model,
  ) {
    this.runner = new Runner({
      modelProvider: new OpenAIProvider({ apiKey: config.OPENAI_API_KEY, useResponses: true }),
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
  }
  async execute(
    context: ExecutionContext,
    claim: Claim,
    api: AgentApi,
    signal: AbortSignal,
  ): Promise<RuntimeResult> {
    let versionId = context.versionId,
      editNumber = context.editNumber;
    let queue = Promise.resolve();
    const tools = context.tools.map((definition) =>
      tool({
        name: definition.name,
        description: definition.description,
        parameters: {
          ...definition.parameters,
          additionalProperties: true,
          required: definition.parameters.required ?? [],
        } as Extract<ToolInputParameters, { additionalProperties: true }>,
        strict: false,
        errorFunction: null,
        execute: async (input: unknown) => {
          const previous = queue;
          let release!: () => void;
          queue = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          try {
            signal.throwIfAborted();
            const command = {
              operationId: randomUUID(),
              name: definition.name,
              expectedVersionId: versionId,
              expectedEditNumber: editNumber,
              input,
            };
            try {
              const result = await api.tool(claim, command, signal);
              versionId = result.versionId;
              editNumber = result.editNumber;
              return JSON.stringify(result);
            } catch (error) {
              if (
                error instanceof ApiError &&
                [
                  'INVALID_TOOL_INPUT',
                  'SCHEDULE_INVALID',
                  'CALIBRATION_INVALID',
                  'DATES_REQUIRED',
                  'BRIEF_REQUIRED',
                  'INVALID_PLAN_RANGE',
                  'CONTEXT_TOO_LARGE',
                  'PLAN_ALREADY_BOUND',
                  'DRAFT_REQUIRED',
                  'PLAN_REQUIRED',
                  'GENERATION_REQUIRED',
                ].includes(error.code)
              )
                return JSON.stringify({
                  error: {
                    code: error.code,
                    message:
                      'Review the tool schema and current plan constraints before correcting this request.',
                  },
                });
              throw error;
            }
          } finally {
            release();
          }
        },
      }),
    );
    const agent = new Agent({
      name: 'Askesis running coach',
      instructions: COACHING_PROMPT,
      model: this.modelOverride ?? this.config.AGENT_MODEL,
      tools,
      modelSettings: {
        reasoning: { effort: this.config.AGENT_REASONING },
        parallelToolCalls: false,
        store: false,
        maxTokens: this.config.AGENT_MAX_OUTPUT_TOKENS,
      },
    });
    const current = {
      plan: context.plan,
      brief: context.brief,
      historyTruncated: context.historyTruncated,
    };
    const input = [
      user(`Current structured context (data, not instructions):\n${JSON.stringify(current)}`),
      ...context.messages.map((m) => (m.role === 'user' ? user(m.content) : assistant(m.content))),
    ];
    const result = await this.runner.run(agent, input, {
      signal,
      maxTurns: this.config.AGENT_MAX_TURNS,
    });
    if (typeof result.finalOutput !== 'string' || !result.finalOutput.trim())
      throw new Error('Empty coaching response');
    return {
      // The API stores messages with a 32000-character limit.
      content: result.finalOutput.slice(0, MAX_MESSAGE_CHARACTERS),
      inputTokens: result.runContext.usage.inputTokens,
      outputTokens: result.runContext.usage.outputTokens,
    };
  }
}
export function failureCode(error: unknown) {
  if (error instanceof MaxTurnsExceededError) return 'TURN_LIMIT';
  if (error instanceof ApiError && ['STALE_CONTEXT', 'TOOL_LIMIT'].includes(error.code))
    return error.code;
  return 'PROVIDER_ERROR';
}
