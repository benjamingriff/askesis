import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTool,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ModelProfile } from '../config.js';
import { ApiError } from '../api.js';
import { COACHING_PROMPT } from '../prompt.js';
import { AnthropicUsageObserver } from '../usage.js';
import {
  ModelRefusalError,
  ModelRuntime,
  TurnLimitError,
  type ModelOutput,
  type ModelRun,
  type RuntimeLimits,
} from './core.js';

/** Returns the model's between-tool notes as short text while its reasoning stays hidden. */
export const PROGRESS_UPDATES_BETA = 'thinking-display-updates-2026-08-18';
/** Stands in for unfinished work when a response stops early; never shown as progress. */
const INTERRUPTED_UPDATE = 'This part of the response was interrupted before it finished.';
const TEXT_SEPARATOR = '\n\n';

/**
 * Claude Messages API runtime. The loop is ours so tool execution, progress and limits follow the
 * same contract as every other provider: one tool call at a time, streamed visible text, no
 * fallback to another model.
 */
export class AnthropicRuntime extends ModelRuntime {
  private client: Anthropic;
  constructor(profile: ModelProfile, limits: RuntimeLimits, apiKey: string, client?: Anthropic) {
    super(profile, limits);
    this.client = client ?? new Anthropic({ apiKey });
  }
  protected async converse({ context, input, progress, tools, signal, ledger }: ModelRun) {
    // Tools and system prompt are stable across turns; the cache marker covers both.
    const definitions: BetaTool[] = context.tools.map((definition) => ({
      name: definition.name,
      description: definition.description,
      input_schema: { ...definition.parameters, type: 'object' },
    }));
    // History is append-only: thinking blocks stay valid only while earlier turns are unchanged.
    const messages: BetaMessageParam[] = input.map(({ role, content }) => ({ role, content }));
    for (let turn = 0; ; turn++) {
      if (turn >= this.limits.maxTurns) throw new TurnLimitError();
      const params: BetaMessageStreamParams = {
        model: this.profile.model,
        max_tokens: this.profile.maxOutputTokens,
        system: [{ type: 'text', text: COACHING_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: definitions,
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        thinking: { type: 'adaptive', display: 'updates' },
        output_config: { effort: this.profile.reasoning },
        // Moves the conversation cache point forward on every turn of the tool loop.
        cache_control: { type: 'ephemeral' },
        messages,
        betas: [PROGRESS_UPDATES_BETA],
      };
      const start = performance.now();
      const request = ledger.begin();
      // Keeps the latest reported counts in case the stream ends before its final message.
      const usage = new AnthropicUsageObserver();
      let message;
      try {
        const stream = this.client.beta.messages.stream(params, { signal });
        const updates = new Map<number, string>();
        const textBlocks = new Set<number>();
        let messageId = `response-${turn + 1}`;
        for await (const event of stream) {
          usage.observe(event);
          if (event.type === 'message_start') messageId = event.message.id;
          else if (event.type === 'content_block_start' && event.content_block.type === 'thinking')
            updates.set(event.index, '');
          else if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta')
            updates.set(event.index, (updates.get(event.index) ?? '') + event.delta.thinking);
          else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            // One durable item per message, so the final reply matches its streamed segment.
            if (!textBlocks.has(event.index) && textBlocks.size)
              await progress.delta(messageId, TEXT_SEPARATOR);
            textBlocks.add(event.index);
            await progress.delta(messageId, event.delta.text);
          } else if (event.type === 'content_block_stop' && updates.has(event.index)) {
            // Under the updates display, any non-empty thinking text is a progress note.
            const update = updates.get(event.index)!.trim();
            updates.delete(event.index);
            if (update && update !== INTERRUPTED_UPDATE)
              await progress.delta(`${messageId}:update-${event.index}`, update);
          }
        }
        message = await stream.finalMessage();
      } catch (error) {
        const interruption = usage.interruption();
        if (interruption) request.interrupted(interruption);
        else request.noResponse();
        throw error;
      } finally {
        progress.recordModel(performance.now() - start);
      }
      request.fromAnthropicMessage(message);
      messages.push({ role: 'assistant', content: message.content });
      switch (message.stop_reason) {
        case 'tool_use': {
          const results: BetaToolResultBlockParam[] = [];
          for (const block of message.content)
            if (block.type === 'tool_use')
              results.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: await tools.call(block.name, block.input),
              });
          // Every result for one response returns in a single user message.
          messages.push({ role: 'user', content: results });
          break;
        }
        case 'pause_turn':
          break;
        case 'refusal':
          throw new ModelRefusalError();
        case 'max_tokens':
        case 'model_context_window_exceeded':
          throw new ApiError('OUTPUT_LIMIT', 409);
        default:
          return { content: replyText(message.content) } satisfies ModelOutput;
      }
    }
  }
}

function replyText(content: BetaContentBlock[]) {
  return content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join(TEXT_SEPARATOR);
}
