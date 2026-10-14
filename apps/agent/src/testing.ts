/**
 * Deterministic provider doubles for tests, the scripted smoke worker and scripted benchmarks.
 * A neutral script describes what the model does; each provider receives it in its own wire
 * format, so the same scenario exercises every runtime. Nothing here makes a network request.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessageStreamParams,
  BetaStopReason,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { Usage } from '@openai/agents';
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
  modelError,
  modelResponse,
  modelStreamResponder,
} from '@openai/agents/testing';
import type { Provider } from './config.js';
import type { RuntimeOverrides } from './runtime/index.js';

export type ScriptedCall = { name: string; input: Record<string, unknown>; id?: string };
export type ScriptedTurn =
  /** A final reply. */
  | { type: 'reply'; text: string; id?: string }
  /** Optional visible text, then tool calls the runtime must execute in order. */
  | { type: 'tools'; calls: ScriptedCall[]; text?: string; id?: string }
  /** Streams visible text, runs `before`, then the provider connection fails. */
  | { type: 'interrupted'; text: string; before?: () => void; delayMs?: number }
  /** The provider rejects the request before producing output. */
  | { type: 'error' };

const PROVIDER_FAILURE = 'Scripted provider failure';
const callId = (call: ScriptedCall, turn: number, index: number) =>
  call.id ?? `scripted-${turn}-${index}-${call.name}`;

export function scriptedOpenAI(turns: ScriptedTurn[]) {
  return new ScriptedModel(
    turns.map((turn, number) => {
      switch (turn.type) {
        case 'reply':
          return modelResponse({
            usage: new Usage(),
            output: [assistantMessage(turn.text, turn.id ? { id: turn.id } : undefined)],
          });
        case 'tools':
          return modelResponse({
            usage: new Usage(),
            output: [
              ...(turn.text
                ? [assistantMessage(turn.text, turn.id ? { id: turn.id } : undefined)]
                : []),
              ...turn.calls.map((call, index) =>
                functionCall(call.name, call.input, { callId: callId(call, number, index) }),
              ),
            ],
          });
        case 'interrupted':
          return modelStreamResponder(() =>
            (async function* () {
              yield { type: 'response_started' as const };
              yield {
                type: 'output_text_delta' as const,
                itemId: `interrupted-${number}`,
                delta: turn.text,
              };
              // Let the runner deliver the text before the provider fails.
              await new Promise((resolve) => setTimeout(resolve, turn.delayMs ?? 10));
              turn.before?.();
              throw new Error(PROVIDER_FAILURE);
            })(),
          );
        case 'error':
          return modelError(new Error(PROVIDER_FAILURE));
      }
    }),
  );
}

export type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type AnthropicResponse =
  | {
      type: 'message';
      id?: string;
      content: AnthropicBlock[];
      stopReason: BetaStopReason;
      usage?: { input: number; output: number; cacheWrite?: number; cacheRead?: number };
    }
  | { type: 'interrupted'; text: string; before?: () => void; delayMs?: number }
  | { type: 'status'; status: number };

/** Server-sent events exactly as the Messages API streams one complete response. */
export function anthropicEvents(
  response: Extract<AnthropicResponse, { type: 'message' }>,
  model: string,
  fallbackId: string,
) {
  const usage = response.usage ?? { input: 0, output: 0 };
  const events: { type: string; [key: string]: unknown }[] = [
    {
      type: 'message_start',
      message: {
        id: response.id ?? fallbackId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: usage.input,
          output_tokens: 0,
          cache_creation_input_tokens: usage.cacheWrite ?? 0,
          cache_read_input_tokens: usage.cacheRead ?? 0,
        },
      },
    },
  ];
  response.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      });
    } else if (block.type === 'thinking') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      });
      if (block.thinking)
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'thinking_delta', thinking: block.thinking },
        });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: `signature-${index}` },
      });
    } else {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: response.stopReason, stop_sequence: null },
    usage: { output_tokens: usage.output },
  });
  events.push({ type: 'message_stop' });
  return events;
}
export const serverSentEvents = (events: { type: string }[]) =>
  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

/**
 * A real Anthropic client whose transport replays scripted responses, so the SDK's own stream
 * parsing and accumulation run in tests. `requests` records each Messages API request body.
 */
export function scriptedAnthropicClient(responses: AnthropicResponse[]) {
  const requests: BetaMessageStreamParams[] = [];
  const headers: Headers[] = [];
  let next = 0;
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    requests.push(JSON.parse(String(init?.body)) as BetaMessageStreamParams);
    headers.push(new Headers(init?.headers));
    const response = responses[next++];
    if (!response) throw new Error('Scripted Anthropic responses are exhausted.');
    if (response.type === 'status')
      return new Response(
        JSON.stringify({ type: 'error', error: { type: 'api_error', message: PROVIDER_FAILURE } }),
        { status: response.status, headers: { 'content-type': 'application/json' } },
      );
    const encoder = new TextEncoder();
    const model = requests.at(-1)!.model;
    const body =
      response.type === 'message'
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  serverSentEvents(anthropicEvents(response, model, `msg_scripted_${next}`)),
                ),
              );
              controller.close();
            },
          })
        : new ReadableStream<Uint8Array>({
            async start(controller) {
              const events = anthropicEvents(
                {
                  type: 'message',
                  content: [{ type: 'text', text: response.text }],
                  stopReason: 'end_turn',
                },
                model,
                `msg_scripted_${next}`,
              ).slice(0, 3);
              controller.enqueue(encoder.encode(serverSentEvents(events)));
              await new Promise((resolve) => setTimeout(resolve, response.delayMs ?? 10));
              response.before?.();
              controller.error(new Error(PROVIDER_FAILURE));
            },
          });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const client = new Anthropic({
    apiKey: 'scripted-no-provider-request',
    fetch: fetcher,
    maxRetries: 0,
  });
  return { client, requests, headers };
}

/** Translates a neutral script into Messages API responses. */
export function anthropicScript(turns: ScriptedTurn[]): AnthropicResponse[] {
  return turns.map((turn, number) => {
    switch (turn.type) {
      case 'reply':
        return {
          type: 'message',
          ...(turn.id ? { id: turn.id } : {}),
          content: [{ type: 'text', text: turn.text }],
          stopReason: 'end_turn',
        };
      case 'tools':
        return {
          type: 'message',
          ...(turn.id ? { id: turn.id } : {}),
          content: [
            ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
            ...turn.calls.map((call, index) => ({
              type: 'tool_use' as const,
              id: callId(call, number, index),
              name: call.name,
              input: call.input,
            })),
          ],
          stopReason: 'tool_use',
        };
      case 'interrupted':
        return turn;
      case 'error':
        return { type: 'status', status: 500 };
    }
  });
}

/** Runtime overrides that replay the same script for whichever provider is configured. */
export function scriptedOverrides(provider: Provider, turns: ScriptedTurn[]): RuntimeOverrides {
  return provider === 'openai'
    ? { openai: scriptedOpenAI(turns) }
    : { anthropic: scriptedAnthropicClient(anthropicScript(turns)).client };
}
