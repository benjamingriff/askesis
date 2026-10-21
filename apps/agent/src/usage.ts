/**
 * Per-request model usage. Each provider request gets one ledger entry holding counts, enums and
 * safe identifiers only: never message, thinking or prompt text, headers, keys, error messages
 * or arbitrary provider objects. A count that was not reported is `null`, never `0`.
 */
import type { Model, ModelRequest } from '@openai/agents';

export const USAGE_LEDGER_VERSION = 1;
export const MAX_LEDGER_REQUESTS = 200;
/** `null` means the provider did not report the value. */
export type TokenCount = number | null;
export type UsageRole = 'coach' | 'simulator' | 'voice' | 'reviewer';
export type UsageProvider = 'openai' | 'anthropic';
export type RequestStatus =
  | 'completed'
  | 'incomplete'
  | 'refused'
  | 'failed'
  /** A response started but ended without a terminal event (abort or network failure). */
  | 'interrupted'
  /** The request failed before any response metadata arrived. */
  | 'error_without_response';
export type UsageSource =
  /** A raw provider usage object was observed; keys absent from it are `null`. */
  | 'provider'
  /** A raw response or terminal was observed, but it carried no usage object. */
  | 'provider_missing'
  /** Only the SDK's normalized totals were available; they may hide absent values as zero. */
  | 'sdk_normalized'
  /** No response was observed. */
  | 'none';
/** `final`: the provider's full terminal usage. `partial`: the latest counts reported before an interruption. */
export type UsageCompleteness = 'final' | 'partial' | 'unknown';
export type RequestSettings = {
  reasoningEffort: string | null;
  maxOutputTokens: number | null;
  /** `null` when no tier was sent, which is true for every current request. */
  requestedServiceTier: string | null;
  cacheControl: 'anthropic_ephemeral_auto' | 'provider_default';
};
export type RequestTokens = {
  /** Total input, including cache reads and writes. */
  input: TokenCount;
  uncachedInput: TokenCount;
  cacheRead: TokenCount;
  cacheWrite: TokenCount;
  cacheWrite5m: TokenCount;
  cacheWrite1h: TokenCount;
  /** Total output, including reasoning. */
  output: TokenCount;
  /** A subset of output. */
  reasoning: TokenCount;
};
/** An allowlisted projection of the provider's usage object. */
export type SafeUsage = { [key: string]: number | string | null | Record<string, number> };
export type ModelRequestUsage = {
  /** 1-based, unique and ascending within a ledger. */
  sequence: number;
  provider: UsageProvider;
  requestedModel: string;
  returnedModel: string | null;
  responseId: string | null;
  status: RequestStatus;
  stopReason: string | null;
  settings: RequestSettings;
  returnedServiceTier: string | null;
  speed: string | null;
  inferenceGeo: string | null;
  usageSource: UsageSource;
  usageCompleteness: UsageCompleteness;
  tokens: RequestTokens;
  raw: SafeUsage | null;
};
export type UsageLedgerJson = {
  version: typeof USAGE_LEDGER_VERSION;
  requests: ModelRequestUsage[];
  omittedRequests: number;
};
export type RequestDefaults = {
  provider: UsageProvider;
  requestedModel: string;
  settings: RequestSettings;
};
type ResponseMeta = { returnedModel?: unknown; responseId?: unknown };
type SdkMeta = { returnedModel?: unknown; returnedServiceTier?: unknown };

export type RequestHandle = {
  /** A raw Responses object (stream terminal or non-streamed). A non-object means no response body. */
  fromOpenAIResponse(raw: unknown, status?: RequestStatus): void;
  fromAnthropicMessage(raw: unknown, status?: RequestStatus): void;
  fromSdkUsage(usage: unknown, meta?: SdkMeta): void;
  /** Ended after a response began; Anthropic keeps the latest counts it observed. */
  interrupted(partial?: { anthropicUsage?: SafeUsage | null } & ResponseMeta): void;
  noResponse(): void;
  /** Non-terminal: remembers that a response began. */
  responseStarted(meta?: ResponseMeta): void;
  /** Non-terminal: buffers SDK usage, applied by `close()` only when no raw terminal arrived. */
  deferSdkUsage(usage: unknown, meta?: SdkMeta): void;
  /** Idempotent arbitration; never throws. */
  close(): void;
};

const COUNT_LIMIT = 100_000_000;
const IDENTIFIER = /^[\w.:@/-]{1,200}$/;
const LOWER_IDENTIFIER = /^[a-z0-9_-]{1,32}$/;
const DETAIL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_DETAIL_KEYS = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): TokenCount =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= COUNT_LIMIT
    ? value
    : null;
export const safeIdentifier = (value: unknown): string | null =>
  typeof value === 'string' && IDENTIFIER.test(value) ? value : null;
const lowerIdentifier = (value: unknown): string | null =>
  typeof value === 'string' && LOWER_IDENTIFIER.test(value) ? value : null;
function details(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value)
    .filter(([key, item]) => DETAIL_KEY.test(key) && count(item) !== null)
    .slice(0, MAX_DETAIL_KEYS);
  return Object.fromEntries(entries) as Record<string, number>;
}
const sum = (...values: TokenCount[]) =>
  values.every((value) => value !== null)
    ? count((values as number[]).reduce((total, value) => total + value, 0))
    : null;
const nullTokens = (): RequestTokens => ({
  input: null,
  uncachedInput: null,
  cacheRead: null,
  cacheWrite: null,
  cacheWrite5m: null,
  cacheWrite1h: null,
  output: null,
  reasoning: null,
});

const OPENAI_COUNTS = ['input_tokens', 'output_tokens', 'total_tokens'];
const OPENAI_DETAILS = ['input_tokens_details', 'output_tokens_details'];
const ANTHROPIC_COUNTS = [
  'input_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'output_tokens',
];
const ANTHROPIC_DETAILS = ['cache_creation', 'output_tokens_details'];
const ANTHROPIC_LABELS = ['service_tier', 'speed', 'inference_geo'];

/** Copies only allowlisted counts and labels; everything else (text, errors, credits) is dropped. */
function project(
  usage: Record<string, unknown>,
  counts: string[],
  detailKeys: string[],
  labels: string[] = [],
): SafeUsage {
  const safe: SafeUsage = {};
  for (const key of counts) if (key in usage) safe[key] = count(usage[key]);
  for (const key of detailKeys) if (key in usage) safe[key] = details(usage[key]);
  for (const key of labels) if (key in usage) safe[key] = lowerIdentifier(usage[key]);
  if (Array.isArray(usage.iterations)) safe.iterations_count = usage.iterations.length;
  return safe;
}
const detail = (raw: SafeUsage | null, key: string, field: string): TokenCount => {
  const value = raw?.[key];
  return isRecord(value) ? count(value[field]) : null;
};

/** Normalizes a Responses `usage` value; absent usage is `provider_missing`, not zero. */
export function normalizeOpenAIUsage(
  usage: unknown,
): Pick<ModelRequestUsage, 'tokens' | 'raw' | 'usageSource'> {
  if (!isRecord(usage)) return { tokens: nullTokens(), raw: null, usageSource: 'provider_missing' };
  const raw = project(usage, OPENAI_COUNTS, OPENAI_DETAILS);
  const input = count(raw.input_tokens);
  const cacheRead = detail(raw, 'input_tokens_details', 'cached_tokens');
  const cacheWrite = detail(raw, 'input_tokens_details', 'cache_write_tokens');
  const cached = sum(cacheRead, cacheWrite);
  return {
    usageSource: 'provider',
    raw,
    tokens: {
      input,
      cacheRead,
      cacheWrite,
      uncachedInput: input !== null && cached !== null && input >= cached ? input - cached : null,
      cacheWrite5m: null,
      cacheWrite1h: null,
      output: count(raw.output_tokens),
      reasoning: detail(raw, 'output_tokens_details', 'reasoning_tokens'),
    },
  };
}

/** Normalizes a Messages `usage` value. Its `input_tokens` excludes cache reads and writes. */
export function normalizeAnthropicUsage(
  usage: unknown,
): Pick<
  ModelRequestUsage,
  'tokens' | 'raw' | 'usageSource' | 'returnedServiceTier' | 'speed' | 'inferenceGeo'
> {
  if (!isRecord(usage))
    return {
      tokens: nullTokens(),
      raw: null,
      usageSource: 'provider_missing',
      returnedServiceTier: null,
      speed: null,
      inferenceGeo: null,
    };
  const raw = project(usage, ANTHROPIC_COUNTS, ANTHROPIC_DETAILS, ANTHROPIC_LABELS);
  const uncachedInput = count(raw.input_tokens);
  const cacheRead = count(raw.cache_read_input_tokens);
  const cacheWrite = count(raw.cache_creation_input_tokens);
  return {
    usageSource: 'provider',
    raw,
    returnedServiceTier: lowerIdentifier(raw.service_tier),
    speed: lowerIdentifier(raw.speed),
    inferenceGeo: lowerIdentifier(raw.inference_geo),
    tokens: {
      input: sum(uncachedInput, cacheRead, cacheWrite),
      uncachedInput,
      cacheRead,
      cacheWrite,
      cacheWrite5m: detail(raw, 'cache_creation', 'ephemeral_5m_input_tokens'),
      cacheWrite1h: detail(raw, 'cache_creation', 'ephemeral_1h_input_tokens'),
      output: count(raw.output_tokens),
      reasoning: detail(raw, 'output_tokens_details', 'thinking_tokens'),
    },
  };
}

function openAIStatus(value: unknown): RequestStatus {
  if (value === 'completed') return 'completed';
  if (value === 'incomplete') return 'incomplete';
  return 'failed';
}
export function anthropicStatus(stopReason: unknown): RequestStatus {
  switch (stopReason) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'incomplete';
    case 'refusal':
      return 'refused';
    default:
      return 'completed';
  }
}

/**
 * Keeps the latest cumulative usage an Anthropic stream reported, so an interrupted request still
 * records it. `message_start` supplies input and cache counts (its output is provisional and
 * ignored); each `message_delta` replaces whichever counts it reports. Values are copied, never
 * summed, and an explicit zero replaces an earlier value.
 */
export class AnthropicUsageObserver {
  private usage: SafeUsage = {};
  private observed = false;
  private started = false;
  returnedModel: string | null = null;
  responseId: string | null = null;
  observe(event: unknown) {
    if (!isRecord(event)) return;
    if (event.type === 'message_start' && isRecord(event.message)) {
      this.started = true;
      this.returnedModel = safeIdentifier(event.message.model);
      this.responseId = safeIdentifier(event.message.id);
      if (isRecord(event.message.usage)) {
        const {
          output_tokens: _output,
          output_tokens_details: _details,
          ...start
        } = event.message.usage;
        this.merge(start);
      }
    } else if (event.type === 'message_delta' && isRecord(event.usage)) this.merge(event.usage);
  }
  private merge(update: Record<string, unknown>) {
    const safe = project(update, ANTHROPIC_COUNTS, ANTHROPIC_DETAILS, ANTHROPIC_LABELS);
    for (const [key, value] of Object.entries(safe)) {
      // Delta events omit or null the counters that do not apply; keep the earlier value then.
      if (value === null) continue;
      if (isRecord(value)) {
        const previous = this.usage[key];
        this.usage[key] = { ...(isRecord(previous) ? previous : {}), ...value };
      } else this.usage[key] = value;
      if (typeof value === 'number' || (isRecord(value) && Object.keys(value).length))
        this.observed = true;
    }
  }
  /** The `interrupted()` input for a request that ended before its final message. */
  interruption() {
    return this.started
      ? {
          anthropicUsage: this.observed ? { ...this.usage } : null,
          returnedModel: this.returnedModel,
          responseId: this.responseId,
        }
      : null;
  }
}

class Entry implements RequestHandle {
  private result: ModelRequestUsage | undefined;
  private started: ResponseMeta | undefined;
  private deferred: { usage: unknown; meta?: SdkMeta } | undefined;
  constructor(
    private sequence: number,
    private defaults: RequestDefaults,
  ) {}
  private base(): ModelRequestUsage {
    return {
      sequence: this.sequence,
      provider: this.defaults.provider,
      requestedModel: safeIdentifier(this.defaults.requestedModel) ?? 'unknown',
      returnedModel: safeIdentifier(this.started?.returnedModel),
      responseId: safeIdentifier(this.started?.responseId),
      status: 'error_without_response',
      stopReason: null,
      settings: {
        reasoningEffort: safeIdentifier(this.defaults.settings.reasoningEffort),
        maxOutputTokens: count(this.defaults.settings.maxOutputTokens),
        requestedServiceTier: safeIdentifier(this.defaults.settings.requestedServiceTier),
        cacheControl: this.defaults.settings.cacheControl,
      },
      returnedServiceTier: null,
      speed: null,
      inferenceGeo: null,
      usageSource: 'none',
      usageCompleteness: 'unknown',
      tokens: nullTokens(),
      raw: null,
    };
  }
  private settle(entry: ModelRequestUsage) {
    this.result ??= entry;
  }
  fromOpenAIResponse(raw: unknown, status?: RequestStatus) {
    if (this.result) return;
    if (!isRecord(raw)) {
      this.settle({ ...this.base(), status: status ?? 'failed' });
      return;
    }
    const usage = normalizeOpenAIUsage(raw.usage);
    const incomplete = isRecord(raw.incomplete_details) ? raw.incomplete_details.reason : null;
    this.settle({
      ...this.base(),
      ...usage,
      usageCompleteness: usage.usageSource === 'provider' ? 'final' : 'unknown',
      returnedModel: safeIdentifier(raw.model),
      responseId: safeIdentifier(raw.id),
      status: status ?? openAIStatus(raw.status),
      stopReason: safeIdentifier(incomplete),
      returnedServiceTier: safeIdentifier(raw.service_tier),
    });
  }
  fromAnthropicMessage(raw: unknown, status?: RequestStatus) {
    if (this.result) return;
    if (!isRecord(raw)) {
      this.settle({ ...this.base(), status: status ?? 'failed' });
      return;
    }
    const usage = normalizeAnthropicUsage(raw.usage);
    this.settle({
      ...this.base(),
      ...usage,
      usageCompleteness: usage.usageSource === 'provider' ? 'final' : 'unknown',
      returnedModel: safeIdentifier(raw.model),
      responseId: safeIdentifier(raw.id),
      status: status ?? anthropicStatus(raw.stop_reason),
      stopReason: safeIdentifier(raw.stop_reason),
    });
  }
  fromSdkUsage(usage: unknown, meta: SdkMeta = {}) {
    if (this.result) return;
    const totals = isRecord(usage) ? usage : {};
    this.settle({
      ...this.base(),
      status: 'completed',
      usageSource: 'sdk_normalized',
      returnedModel:
        safeIdentifier(meta.returnedModel) ?? safeIdentifier(this.started?.returnedModel),
      returnedServiceTier: safeIdentifier(meta.returnedServiceTier),
      tokens: {
        ...nullTokens(),
        input: count(totals.inputTokens),
        output: count(totals.outputTokens),
      },
    });
  }
  interrupted(partial: { anthropicUsage?: SafeUsage | null } & ResponseMeta = {}) {
    if (this.result) return;
    const entry: ModelRequestUsage = {
      ...this.base(),
      status: 'interrupted',
      returnedModel:
        safeIdentifier(partial.returnedModel) ?? safeIdentifier(this.started?.returnedModel),
      responseId: safeIdentifier(partial.responseId) ?? safeIdentifier(this.started?.responseId),
    };
    if (partial.anthropicUsage) {
      const usage = normalizeAnthropicUsage(partial.anthropicUsage);
      Object.assign(entry, usage, { usageCompleteness: 'partial' });
    }
    this.settle(entry);
  }
  noResponse() {
    if (this.result) return;
    this.settle(this.base());
  }
  responseStarted(meta: ResponseMeta = {}) {
    this.started ??= meta;
  }
  deferSdkUsage(usage: unknown, meta?: SdkMeta) {
    this.deferred ??= { usage, ...(meta ? { meta } : {}) };
  }
  close() {
    if (this.result) return;
    if (this.deferred) this.fromSdkUsage(this.deferred.usage, this.deferred.meta);
    else if (this.started) this.interrupted();
    else this.noResponse();
  }
  /** What `close()` would record, without closing an open request. */
  project(): ModelRequestUsage {
    if (this.result) return this.result;
    const preview = new Entry(this.sequence, this.defaults);
    preview.started = this.started;
    preview.deferred = this.deferred;
    preview.close();
    return preview.result!;
  }
}

/** One ledger per coach run or evaluator call; it survives the errors its caller rethrows. */
export class UsageLedger {
  private entries: Entry[] = [];
  constructor(private defaults?: RequestDefaults) {}
  /** Allocates the next request; exactly one terminal call (or `close()`) records it. */
  begin(defaults: RequestDefaults | undefined = this.defaults): RequestHandle {
    if (!defaults) throw new Error('Usage ledger requests need a provider and model.');
    const entry = new Entry(this.entries.length + 1, defaults);
    this.entries.push(entry);
    return entry;
  }
  requests() {
    return this.entries.map((entry) => entry.project());
  }
  toJSON(): UsageLedgerJson {
    return {
      version: USAGE_LEDGER_VERSION,
      requests: this.requests().slice(0, MAX_LEDGER_REQUESTS),
      omittedRequests: Math.max(0, this.entries.length - MAX_LEDGER_REQUESTS),
    };
  }
  /** The legacy finish totals: known provider and SDK values; a key is omitted when none is known. */
  legacyTotals(): { inputTokens?: number; outputTokens?: number } {
    const totals: { inputTokens?: number; outputTokens?: number } = {};
    for (const request of this.requests()) {
      if (request.usageSource !== 'provider' && request.usageSource !== 'sdk_normalized') continue;
      if (request.tokens.input !== null)
        totals.inputTokens = (totals.inputTokens ?? 0) + request.tokens.input;
      if (request.tokens.output !== null)
        totals.outputTokens = (totals.outputTokens ?? 0) + request.tokens.output;
    }
    return totals;
  }
}

/** The request defaults of a coach run; the cache label describes the runtime's existing policy. */
export function coachRequestDefaults(profile: {
  provider: UsageProvider;
  model: string;
  reasoning: string;
  maxOutputTokens: number;
}): RequestDefaults {
  return {
    provider: profile.provider,
    requestedModel: profile.model,
    settings: {
      reasoningEffort: profile.reasoning,
      maxOutputTokens: profile.maxOutputTokens,
      requestedServiceTier: null,
      cacheControl:
        profile.provider === 'anthropic' ? 'anthropic_ephemeral_auto' : 'provider_default',
    },
  };
}

/** The settings an Agents SDK request actually carries. */
export function openAIRequestSettings(
  request: Pick<ModelRequest, 'modelSettings'>,
): RequestSettings {
  const settings = request.modelSettings ?? {};
  const providerData = isRecord(settings.providerData) ? settings.providerData : {};
  return {
    reasoningEffort: safeIdentifier(settings.reasoning?.effort),
    maxOutputTokens: count(settings.maxTokens),
    requestedServiceTier: safeIdentifier(providerData.service_tier),
    cacheControl: 'provider_default',
  };
}

const RAW_TERMINALS: Record<string, RequestStatus> = {
  'response.completed': 'completed',
  'response.incomplete': 'incomplete',
  'response.failed': 'failed',
};

/**
 * Re-yields every event unchanged and in order while recording the request. A raw provider
 * terminal is authoritative as soon as it arrives. The SDK's `response_done` usage, which comes
 * before the raw `response.completed`, is only a fallback applied once the stream has ended.
 */
export async function* observeStream<T>(
  events: AsyncIterable<T>,
  handle: RequestHandle,
): AsyncGenerator<T> {
  try {
    for await (const event of events) {
      inspect(event, handle);
      yield event;
    }
  } finally {
    handle.close();
  }
}
function inspect(value: unknown, handle: RequestHandle) {
  if (!isRecord(value)) return;
  const event = value;
  if (event.type === 'response_started') {
    const created = isRecord(event.providerData) ? event.providerData.response : undefined;
    handle.responseStarted(
      isRecord(created) ? { returnedModel: created.model, responseId: created.id } : {},
    );
  } else if (event.type === 'response_done') {
    const response: Record<string, unknown> = isRecord(event.response) ? event.response : {};
    const providerData: Record<string, unknown> = isRecord(response.providerData)
      ? response.providerData
      : {};
    handle.deferSdkUsage(response.usage, {
      returnedModel: providerData.model,
      returnedServiceTier: providerData.service_tier,
    });
  } else if (event.type === 'model' && isRecord(event.event)) {
    const raw = event.event;
    const type = typeof raw.type === 'string' ? raw.type : '';
    if (type === 'response.created' && isRecord(raw.response))
      handle.responseStarted({ returnedModel: raw.response.model, responseId: raw.response.id });
    else if (type in RAW_TERMINALS && isRecord(raw.response))
      handle.fromOpenAIResponse(raw.response, RAW_TERMINALS[type]);
    else if (type in RAW_TERMINALS || type === 'response.error' || type === 'error')
      handle.fromOpenAIResponse(null, 'failed');
  }
}

/** Wraps an Agents SDK model so every request it makes is recorded; requests are unchanged. */
export function observeOpenAIModel(
  delegate: Model,
  ledger: UsageLedger,
  onTiming?: (ms: number) => void,
): Model {
  return {
    ...(delegate.supportsPromptModelSelection === undefined
      ? {}
      : { supportsPromptModelSelection: delegate.supportsPromptModelSelection }),
    ...(delegate.getRetryAdvice ? { getRetryAdvice: delegate.getRetryAdvice.bind(delegate) } : {}),
    async getResponse(request) {
      const handle = ledger.begin();
      const start = performance.now();
      try {
        const response = await delegate.getResponse(request);
        const raw = response.providerData;
        if (isRecord(raw) && (raw.object === 'response' || 'usage' in raw))
          handle.fromOpenAIResponse(raw);
        else handle.fromSdkUsage(response.usage);
        return response;
      } catch (error) {
        handle.noResponse();
        throw error;
      } finally {
        onTiming?.(performance.now() - start);
      }
    },
    async *getStreamedResponse(request) {
      const handle = ledger.begin();
      const start = performance.now();
      try {
        yield* observeStream(delegate.getStreamedResponse(request), handle);
      } finally {
        onTiming?.(performance.now() - start);
      }
    },
  };
}

/** Reads a stored ledger; `null` for absent, legacy, unknown-version or malformed values. */
export function readUsageLedger(value: unknown): UsageLedgerJson | null {
  if (!isRecord(value) || value.version !== USAGE_LEDGER_VERSION) return null;
  if (!Array.isArray(value.requests) || count(value.omittedRequests) === null) return null;
  if (value.requests.length > MAX_LEDGER_REQUESTS) return null;
  if (!onlyKeys(value, ['version', 'requests', 'omittedRequests'])) return null;
  let previous = 0;
  for (const request of value.requests) {
    if (!validRequest(request) || request.sequence <= previous) return null;
    previous = request.sequence;
  }
  return value as UsageLedgerJson;
}

const onlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const nullableIdentifier = (value: unknown) => value === null || safeIdentifier(value) !== null;
const nullableCount = (value: unknown) => value === null || count(value) !== null;
function validRaw(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const counts = [...OPENAI_COUNTS, ...ANTHROPIC_COUNTS, 'iterations_count'];
  const maps = [...OPENAI_DETAILS, ...ANTHROPIC_DETAILS];
  return Object.entries(value).every(([key, item]) => {
    if (counts.includes(key)) return nullableCount(item);
    if (maps.includes(key))
      return (
        item === null ||
        (isRecord(item) &&
          Object.keys(item).length <= MAX_DETAIL_KEYS &&
          Object.entries(item).every(
            ([name, number]) => DETAIL_KEY.test(name) && count(number) !== null,
          ))
      );
    if (ANTHROPIC_LABELS.includes(key)) return item === null || lowerIdentifier(item) !== null;
    return false;
  });
}
function validRequest(value: unknown): value is ModelRequestUsage {
  if (!isRecord(value) || count(value.sequence) === null || Number(value.sequence) < 1)
    return false;
  if (
    !onlyKeys(value, [
      'sequence',
      'provider',
      'requestedModel',
      'returnedModel',
      'responseId',
      'status',
      'stopReason',
      'settings',
      'returnedServiceTier',
      'speed',
      'inferenceGeo',
      'usageSource',
      'usageCompleteness',
      'tokens',
      'raw',
    ])
  )
    return false;
  if (value.provider !== 'openai' && value.provider !== 'anthropic') return false;
  if (safeIdentifier(value.requestedModel) === null) return false;
  if (
    !['returnedModel', 'responseId', 'stopReason', 'returnedServiceTier', 'speed'].every((key) =>
      nullableIdentifier(value[key]),
    )
  )
    return false;
  if (value.inferenceGeo !== null && lowerIdentifier(value.inferenceGeo) === null) return false;
  if (
    ![
      'completed',
      'incomplete',
      'refused',
      'failed',
      'interrupted',
      'error_without_response',
    ].includes(String(value.status))
  )
    return false;
  if (
    !['provider', 'provider_missing', 'sdk_normalized', 'none'].includes(String(value.usageSource))
  )
    return false;
  if (!['final', 'partial', 'unknown'].includes(String(value.usageCompleteness))) return false;
  const settings = value.settings;
  if (
    !isRecord(settings) ||
    !onlyKeys(settings, [
      'reasoningEffort',
      'maxOutputTokens',
      'requestedServiceTier',
      'cacheControl',
    ])
  )
    return false;
  if (
    !nullableIdentifier(settings.reasoningEffort) ||
    !nullableIdentifier(settings.requestedServiceTier) ||
    !nullableCount(settings.maxOutputTokens)
  )
    return false;
  if (!['anthropic_ephemeral_auto', 'provider_default'].includes(String(settings.cacheControl)))
    return false;
  const tokenKeys = Object.keys(nullTokens());
  const tokens = value.tokens;
  return (
    isRecord(tokens) &&
    onlyKeys(tokens, tokenKeys) &&
    tokenKeys.every((key) => nullableCount(tokens[key])) &&
    validRaw(value.raw)
  );
}
