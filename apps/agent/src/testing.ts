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
      usage?: {
        input: number;
        output: number;
        cacheWrite?: number | null;
        cacheRead?: number | null;
        cacheCreation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number };
        reasoning?: number;
        serviceTier?: string;
      };
    }
  | { type: 'interrupted'; text: string; before?: () => void; delayMs?: number }
  | { type: 'status'; status: number }
  /**
   * Raw stream events, then the connection fails (`error`) or stays open until the request is
   * aborted (`hang`). `before` runs once the events have been sent.
   */
  | { type: 'events'; events: object[]; then: 'error' | 'hang'; before?: () => void };

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
          cache_creation_input_tokens: usage.cacheWrite === undefined ? 0 : usage.cacheWrite,
          cache_read_input_tokens: usage.cacheRead === undefined ? 0 : usage.cacheRead,
          ...(usage.cacheCreation ? { cache_creation: usage.cacheCreation } : {}),
          ...(usage.serviceTier ? { service_tier: usage.serviceTier } : {}),
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
    usage: {
      output_tokens: usage.output,
      ...(usage.reasoning === undefined
        ? {}
        : { output_tokens_details: { thinking_tokens: usage.reasoning } }),
    },
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
    const signal = init?.signal;
    if (response.type === 'events')
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode(serverSentEvents(response.events as { type: string }[])),
            );
            await new Promise((resolve) => setTimeout(resolve, 10));
            response.before?.();
            if (response.then === 'error') controller.error(new Error(PROVIDER_FAILURE));
            else if (signal?.aborted) controller.error(signal.reason);
            else
              signal?.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              });
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
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

/** What a scripted Responses API call returns. */
export type ScriptedResponsesCall =
  /** A complete raw Responses object; streamed requests receive `response.created` and its terminal. */
  | { type: 'response'; response: Record<string, unknown> }
  /** Raw stream events, then optionally a connection failure. */
  | { type: 'events'; events: Record<string, unknown>[]; error?: Error }
  /** `responses.create` rejects before any response. */
  | { type: 'reject'; error: Error };

/** A raw Responses API object with the given usage; omit `usage` to model a provider that sent none. */
export function rawResponse(
  options: {
    id?: string;
    model?: string;
    status?: 'completed' | 'incomplete' | 'failed';
    serviceTier?: string;
    text?: string;
    usage?: Record<string, unknown> | null;
    incompleteReason?: string;
  } = {},
) {
  const status = options.status ?? 'completed';
  return {
    id: options.id ?? 'resp_scripted',
    object: 'response',
    created_at: 1760000000,
    model: options.model ?? 'gpt-6.1-sol',
    status,
    ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
    incomplete_details: options.incompleteReason ? { reason: options.incompleteReason } : null,
    error: status === 'failed' ? { code: 'server_error', message: 'Hidden provider detail' } : null,
    output: [
      {
        type: 'message',
        id: `msg_${options.id ?? 'scripted'}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: options.text ?? 'Done.', annotations: [] }],
      },
    ],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  };
}

/**
 * A stand-in for the OpenAI client's `responses.create`, so the real Agents SDK model and runner
 * process raw provider payloads in tests. `calls` records each request body and its options.
 */
export function scriptedResponsesClient(script: ScriptedResponsesCall[]) {
  const calls: { body: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  let next = 0;
  const create = (body: Record<string, unknown>, options: Record<string, unknown> = {}) => {
    calls.push({ body: structuredClone(body), options: { ...options } });
    const call = script[next++];
    if (!call) return Promise.reject(new Error('Scripted Responses calls are exhausted.'));
    if (call.type === 'reject') return Promise.reject(call.error);
    if (!body.stream) {
      if (call.type !== 'response')
        return Promise.reject(new Error('A non-streamed request needs a complete response.'));
      return Promise.resolve(structuredClone(call.response));
    }
    const events =
      call.type === 'events'
        ? call.events
        : [
            {
              type: 'response.created',
              sequence_number: 0,
              response: { ...call.response, status: 'in_progress', output: [], usage: null },
            },
            {
              type: `response.${String(call.response.status)}`,
              sequence_number: 1,
              response: call.response,
            },
          ];
    const failure = call.type === 'events' ? call.error : undefined;
    const signal = options.signal as AbortSignal | undefined;
    return Promise.resolve(
      (async function* () {
        for (const event of events) {
          signal?.throwIfAborted();
          yield structuredClone(event);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (failure) throw failure;
      })(),
    );
  };
  return { client: { responses: { create } }, calls };
}
