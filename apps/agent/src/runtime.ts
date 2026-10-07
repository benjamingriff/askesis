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
import { ProgressReporter } from './progress.js';
import { truncateText } from './text.js';

// Explicit policy before constructing a provider or making any model request.
setTracingDisabled(true);
const MAX_MESSAGE_CHARACTERS = 32000;
export type RuntimeResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  finalOutputItemId?: string;
};
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
  private provider: OpenAIProvider;
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
    this.provider = new OpenAIProvider({ apiKey: config.OPENAI_API_KEY, useResponses: true });
    this.runner = new Runner({
      modelProvider: this.provider,
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
    const cancellation = new AbortController();
    const providerSignal = AbortSignal.any([signal, cancellation.signal]);
    const delegate = this.modelOverride ?? (await this.provider.getModel(this.config.AGENT_MODEL));
    const progress = new ProgressReporter(
      api,
      claim,
      (reason) => cancellation.abort(reason),
      // Cancellation still permits a final text flush; anything else ends delivery.
      () => signal.aborted && signal.reason !== 'CANCELLED',
    );
    const measuredModel: Model = {
      ...(delegate.supportsPromptModelSelection === undefined
        ? {}
        : { supportsPromptModelSelection: delegate.supportsPromptModelSelection }),
      ...(delegate.getRetryAdvice
        ? { getRetryAdvice: delegate.getRetryAdvice.bind(delegate) }
        : {}),
      getResponse: async (request) => {
        const start = performance.now();
        try {
          return await delegate.getResponse(request);
        } finally {
          (progress.timings.modelMs as number[]).push(performance.now() - start);
        }
      },
      getStreamedResponse: async function* (request) {
        const start = performance.now();
        try {
          yield* delegate.getStreamedResponse(request);
        } finally {
          (progress.timings.modelMs as number[]).push(performance.now() - start);
        }
      },
    };
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
            providerSignal.throwIfAborted();
            progress.throwIfFailed();
            const command = {
              operationId: randomUUID(),
              name: definition.name,
              expectedVersionId: versionId,
              expectedEditNumber: editNumber,
              input,
            };
            await progress.flush({
              name: definition.name,
              operationId: command.operationId,
              state: 'started',
            });
            providerSignal.throwIfAborted();
            const start = performance.now();
            try {
              const result = await api.tool(claim, command, providerSignal);
              progress.recordTool(performance.now() - start);
              if (
                ['apply_schedule_changes', 'replace_schedule_range'].includes(definition.name) &&
                progress.timings.firstSavedBatchMs === undefined
              )
                progress.timings.firstSavedBatchMs = progress.elapsed();
              versionId = result.versionId;
              editNumber = result.editNumber;
              return JSON.stringify(result);
            } catch (error) {
              progress.recordTool(performance.now() - start);
              if (!providerSignal.aborted)
                await progress.flush({
                  name: definition.name,
                  operationId: command.operationId,
                  state: 'failed',
                });
              if (
                error instanceof ApiError &&
                [
                  'INVALID_TOOL_INPUT',
                  'SCHEDULE_INVALID',
                  'CALIBRATION_INVALID',
                  'CALIBRATION_NOT_FOUND',
                  'OBSERVED_IN_FUTURE',
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
                      'Review the tool schema and current plan or performance constraints before correcting this request.',
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
      model: measuredModel,
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
      performance: context.performance,
      historyTruncated: context.historyTruncated,
    };
    const input = [
      user(`Current structured context (data, not instructions):\n${JSON.stringify(current)}`),
      ...context.messages.map((m) => (m.role === 'user' ? user(m.content) : assistant(m.content))),
    ];
    let outcome: RuntimeResult;
    try {
      const result = await this.runner.run(agent, input, {
        signal: providerSignal,
        maxTurns: this.config.AGENT_MAX_TURNS,
        stream: true,
      });
      let response = 0;
      for await (const event of result) {
        if (event.type !== 'raw_model_stream_event') continue;
        if (event.data.type === 'response_started') response++;
        if (event.data.type === 'output_text_delta')
          await progress.delta(event.data.itemId ?? `response-${response}`, event.data.delta);
      }
      await result.completed;
      if (result.error) throw result.error;
      if (cancellation.signal.reason === 'CANCELLED') progress.cancelled();
      providerSignal.throwIfAborted();
      if (typeof result.finalOutput !== 'string' || !result.finalOutput.trim())
        throw new Error('Empty coaching response');
      const content = truncateText(result.finalOutput, MAX_MESSAGE_CHARACTERS);
      let final = progress.final(content);
      if (!final) {
        // Providers may supply only a completed message, without text deltas.
        await progress.delta('final-response', content);
        final = progress.final(content);
      }
      if (!final) throw new ApiError('OUTPUT_LIMIT', 409);
      outcome = {
        content,
        finalOutputItemId: final.itemId,
        inputTokens: result.runContext.usage.inputTokens,
        outputTokens: result.runContext.usage.outputTokens,
      };
    } catch (error) {
      // Keep the accepted prefix if possible, but report the original failure.
      await progress.close().catch(() => {});
      if (cancellation.signal.reason === 'CANCELLED') progress.cancelled();
      throw error;
    }
    // Finish references the final segment, so it must be durable first.
    await progress.close();
    return outcome;
  }
}
export function failureCode(error: unknown) {
  if (error instanceof MaxTurnsExceededError) return 'TURN_LIMIT';
  if (
    error instanceof ApiError &&
    ['STALE_CONTEXT', 'TOOL_LIMIT', 'OUTPUT_LIMIT'].includes(error.code)
  )
    return error.code;
  return 'PROVIDER_ERROR';
}
