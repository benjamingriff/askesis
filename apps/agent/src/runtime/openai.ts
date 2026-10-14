import {
  Agent,
  Runner,
  OpenAIProvider,
  tool,
  MaxTurnsExceededError,
  ToolCallError,
  setTracingDisabled,
  user,
  assistant,
  type Model,
  type ToolInputParameters,
} from '@openai/agents';
import type { ModelProfile } from '../config.js';
import { COACHING_PROMPT } from '../prompt.js';
import {
  ModelRuntime,
  TurnLimitError,
  type ModelOutput,
  type ModelRun,
  type RuntimeLimits,
} from './core.js';

// Explicit policy before constructing a provider or making any model request.
setTracingDisabled(true);

export class OpenAIRuntime extends ModelRuntime {
  private runner: Runner;
  private provider: OpenAIProvider;
  constructor(
    profile: ModelProfile,
    limits: RuntimeLimits,
    apiKey: string,
    private modelOverride?: Model,
  ) {
    super(profile, limits);
    this.provider = new OpenAIProvider({ apiKey, useResponses: true });
    this.runner = new Runner({
      modelProvider: this.provider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
  }
  protected async converse({ context, input, progress, tools, signal }: ModelRun) {
    const delegate = this.modelOverride ?? (await this.provider.getModel(this.profile.model));
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
          progress.recordModel(performance.now() - start);
        }
      },
      getStreamedResponse: async function* (request) {
        const start = performance.now();
        try {
          yield* delegate.getStreamedResponse(request);
        } finally {
          progress.recordModel(performance.now() - start);
        }
      },
    };
    const agent = new Agent({
      name: 'Askesis coach',
      instructions: COACHING_PROMPT,
      model: measuredModel,
      tools: context.tools.map((definition) =>
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
          execute: (toolInput: unknown) => tools.call(definition.name, toolInput),
        }),
      ),
      modelSettings: {
        reasoning: { effort: this.profile.reasoning },
        parallelToolCalls: false,
        store: false,
        maxTokens: this.profile.maxOutputTokens,
      },
    });
    try {
      const result = await this.runner.run(
        agent,
        input.map((turn) => (turn.role === 'user' ? user(turn.content) : assistant(turn.content))),
        { signal, maxTurns: this.limits.maxTurns, stream: true },
      );
      let response = 0;
      for await (const event of result) {
        if (event.type !== 'raw_model_stream_event') continue;
        if (event.data.type === 'response_started') response++;
        if (event.data.type === 'output_text_delta')
          await progress.delta(event.data.itemId ?? `response-${response}`, event.data.delta);
      }
      await result.completed;
      if (result.error) throw result.error;
      return {
        content: typeof result.finalOutput === 'string' ? result.finalOutput : '',
        inputTokens: result.runContext.usage.inputTokens,
        outputTokens: result.runContext.usage.outputTokens,
      } satisfies ModelOutput;
    } catch (error) {
      if (error instanceof MaxTurnsExceededError) throw new TurnLimitError();
      // Report the API's own rejection (for example a draft conflict), not the SDK wrapper.
      if (error instanceof ToolCallError) throw error.error;
      throw error;
    }
  }
}
