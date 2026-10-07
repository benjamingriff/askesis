import { ApiError, type AgentApi, type Claim } from './api.js';
import { truncateText } from './text.js';

/** How long one batch keeps retrying a transient outage before the turn gives up. */
const DELIVERY_BUDGET_MS = 30000;
const transient = (error: unknown) =>
  !(error instanceof ApiError) || error.status >= 500 || error.status === 429;

/** Backoff owns its timer/listener, so a hard stop never waits for the next attempt. */
const pause = (delay: number, signal: AbortSignal) => {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    signal.addEventListener('abort', abort, { once: true });
  });
};

type Item = {
  itemId: string;
  position: number;
  content: string;
  revision: number;
  truncated: boolean;
};
/** Bounded snapshots, serialized delivery and stable retry identities. Never send reasoning. */
export class ProgressReporter {
  private items = new Map<string, Item>();
  private dirty = new Set<string>();
  private sequence = 0;
  private tail: Promise<void> = Promise.resolve();
  private error: unknown;
  private lastFlush = performance.now();
  private characters = 0;
  private timerBusy = false;
  private timer: ReturnType<typeof setInterval>;
  readonly timings: Record<string, number | number[]> = { modelMs: [], toolMs: [] };
  readonly started = performance.now();
  constructor(
    private api: AgentApi,
    private claim: Claim,
    private interrupt: (reason: unknown) => void,
    /** Lease loss, timeout or shutdown: retrying a batch can no longer succeed. */
    private hardStopSignal: AbortSignal = new AbortController().signal,
    private retryDelayMs = 250,
  ) {
    this.timer = setInterval(() => {
      if (this.timerBusy) return;
      this.timerBusy = true;
      void this.flush()
        .catch((error) => {
          clearInterval(this.timer);
          this.error = error;
          this.interrupt(error);
        })
        .finally(() => {
          this.timerBusy = false;
        });
    }, 400);
    this.timer.unref();
  }
  elapsed() {
    return Math.max(0, performance.now() - this.started);
  }
  async delta(id: string, text: string) {
    if (this.error) throw this.error;
    let item = this.items.get(id);
    if (!item) {
      if (this.items.size >= 100) throw new ApiError('OUTPUT_LIMIT', 409);
      item = { itemId: id, position: this.items.size, content: '', revision: 0, truncated: false };
      this.items.set(id, item);
    }
    if (text && this.timings.firstVisibleMs === undefined)
      this.timings.firstVisibleMs = this.elapsed();
    const added = truncateText(
      text,
      Math.max(0, Math.min(32000 - item.content.length, 64000 - this.characters)),
    );
    const truncated = item.truncated || added.length < text.length;
    // Text past the limit only needs one revision that records the truncation.
    if (!added && truncated === item.truncated && item.revision > 0) return;
    item.content += added;
    this.characters += added.length;
    item.revision++;
    item.truncated = truncated;
    this.dirty.add(id);
    if (performance.now() - this.lastFlush >= 350 || added.length >= 4096) await this.flush();
  }
  recordTool(duration: number) {
    const values = this.timings.toolMs as number[];
    if (values.length < 200) values.push(duration);
    this.timings.toolCalls = Number(this.timings.toolCalls ?? 0) + 1;
    this.timings.toolMsTotal = Number(this.timings.toolMsTotal ?? 0) + duration;
  }
  final(content: string) {
    return [...this.items.values()].reverse().find((item) => item.content === content);
  }
  async flush(activity?: { name: string; operationId: string; state: 'started' | 'failed' }) {
    if (this.error) throw this.error;
    await this.tail;
    if (this.error) throw this.error;
    const snapshots = [...this.dirty].map((id) => ({ ...this.items.get(id)! }));
    this.dirty.clear();
    this.lastFlush = performance.now();
    if (!snapshots.length && !activity) return this.tail;
    const groups = snapshots.length
      ? Array.from({ length: Math.ceil(snapshots.length / 8) }, (_, i) =>
          snapshots.slice(i * 8, i * 8 + 8),
        )
      : [[]];
    for (const [index, items] of groups.entries()) {
      const body = {
        sequence: ++this.sequence,
        items,
        ...(index === groups.length - 1 && activity ? { activity } : {}),
      };
      this.tail = this.tail.then(async () => {
        const start = performance.now();
        const result = await this.deliver(body);
        const duration = performance.now() - start;
        this.timings.progressWriteMsTotal =
          Number(this.timings.progressWriteMsTotal ?? 0) + duration;
        this.timings.progressWriteMsMax = Math.max(
          Number(this.timings.progressWriteMsMax ?? 0),
          duration,
        );
        if (items.length && this.timings.firstDurableOutputMs === undefined)
          this.timings.firstDurableOutputMs = this.elapsed();
        if (result.status === 'cancelling') this.interrupt('CANCELLED');
      });
    }
    // Observe rejection immediately even if a timer initiated the write.
    this.tail.catch((error) => {
      clearInterval(this.timer);
      this.error = error;
      this.interrupt(error);
    });
    return this.tail;
  }
  /**
   * Batches are idempotent by sequence, so a transient API outage retries the same batch with
   * backoff instead of failing the turn. Rejections and lost leases fail immediately.
   */
  private async deliver(body: unknown) {
    this.hardStopSignal.throwIfAborted();
    const remaining = Date.parse(this.claim.deadlineAt) - Date.now();
    if (remaining <= 0) throw 'EXECUTION_TIMEOUT';
    const budget = new AbortController();
    const timer = setTimeout(
      () =>
        budget.abort(
          remaining <= DELIVERY_BUDGET_MS
            ? 'EXECUTION_TIMEOUT'
            : new ApiError('API_UNREACHABLE', 503),
        ),
      Math.min(DELIVERY_BUDGET_MS, remaining),
    );
    const signal = AbortSignal.any([this.hardStopSignal, budget.signal]);
    try {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
          return await this.api.progress(this.claim, body, signal);
        } catch (error) {
          signal.throwIfAborted();
          if (!transient(error)) throw error;
          const delay = Math.min(4000, this.retryDelayMs * 2 ** attempt);
          await pause(delay * (0.8 + Math.random() * 0.4), signal);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
  /** Persist remaining text (required), then a best-effort timing summary. */
  async close() {
    clearInterval(this.timer);
    await this.flush();
    this.timings.totalMs = this.elapsed();
    this.timings.progressBatches = this.sequence + 1;
    try {
      await this.deliver({ sequence: ++this.sequence, items: [], timings: { ...this.timings } });
    } catch {
      // Measurements must never turn a delivered reply into a failed run.
    }
  }
  throwIfFailed() {
    if (this.error) throw this.error;
  }
  cancelled() {
    throw new ApiError('CANCELLED', 409);
  }
}
