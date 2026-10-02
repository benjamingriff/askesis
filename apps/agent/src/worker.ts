import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { type AgentApi, ApiError, type Claim } from './api.js';
import { PROMPT_VERSION, type AgentConfig } from './config.js';
import { failureCode, type CoachingRuntime } from './runtime.js';

const MAX_HEARTBEAT_FAILURES = 3;

export class Worker {
  readonly id = randomUUID();
  private stopping = false;
  private active: AbortController | undefined;
  private heartbeatPending: Promise<void> | undefined;
  constructor(
    private config: AgentConfig,
    private api: AgentApi,
    private runtime: CoachingRuntime,
    private report: (code: string, runId?: string) => void = () => {},
  ) {}
  private register(ready: boolean) {
    return this.api.register(this.config.AGENT_BOOTSTRAP_TOKEN, {
      id: this.id,
      provider: this.config.AGENT_PROVIDER,
      model: this.config.AGENT_MODEL,
      reasoning: this.config.AGENT_REASONING,
      promptVersion: PROMPT_VERSION,
      ready,
    });
  }
  async execute(claim: Claim) {
    const controller = new AbortController();
    this.active = controller;
    const remaining = Math.max(1, Date.parse(claim.deadlineAt) - Date.now());
    const deadline = setTimeout(() => controller.abort('EXECUTION_TIMEOUT'), remaining);
    let heartbeat: Promise<void> | undefined;
    // A single failed heartbeat (network blip, or a tool call holding the run lock) must not
    // discard the run while its lease is still valid; give up only after repeated failures.
    let failures = 0;
    const interval = setInterval(() => {
      if (heartbeat) return;
      heartbeat = this.api
        .heartbeat(claim)
        .then((state) => {
          failures = 0;
          if (state.status === 'cancelling') controller.abort('CANCELLED');
        })
        .catch((error: unknown) => {
          failures += 1;
          if (
            failures >= MAX_HEARTBEAT_FAILURES ||
            (error instanceof ApiError && [401, 403, 404, 409].includes(error.status))
          )
            controller.abort('LEASE_LOST');
        })
        .finally(() => {
          heartbeat = undefined;
        });
    }, 15000);
    try {
      const context = await this.api.context(claim, controller.signal);
      const output = await this.runtime.execute(context, claim, this.api, controller.signal);
      controller.signal.throwIfAborted();
      const result = await this.api.finish(claim, { status: 'completed', ...output });
      this.report(result.status, claim.runId);
    } catch (error) {
      const reason = controller.signal.reason as unknown;
      const status = reason === 'CANCELLED' ? 'cancelled' : 'failed';
      const code =
        reason === 'EXECUTION_TIMEOUT'
          ? 'EXECUTION_TIMEOUT'
          : reason === 'WORKER_SHUTDOWN'
            ? 'WORKER_SHUTDOWN'
            : failureCode(error);
      try {
        const result = await this.api.finish(claim, {
          status,
          ...(status === 'failed' ? { failureCode: code } : {}),
        });
        this.report(result.status, claim.runId);
      } catch {
        this.report(error instanceof ApiError ? error.code : 'EXECUTION_INTERRUPTED', claim.runId);
      }
    } finally {
      clearTimeout(deadline);
      clearInterval(interval);
      await heartbeat;
      this.active = undefined;
    }
  }
  async run() {
    // Worker liveness remains fresh during a long model execution.
    await this.register(true);
    const interval = setInterval(() => {
      if (this.heartbeatPending || this.stopping) return;
      this.heartbeatPending = this.register(true)
        .then(() => {})
        .catch(() => {
          this.report('REGISTRATION_FAILED');
        })
        .finally(() => {
          this.heartbeatPending = undefined;
        });
    }, 15000);
    try {
      while (!this.stopping) {
        try {
          const { claim } = await this.api.claim(this.config.AGENT_BOOTSTRAP_TOKEN, this.id);
          if (claim) {
            if (this.stopping) {
              await this.api.finish(claim, { status: 'failed', failureCode: 'WORKER_SHUTDOWN' });
            } else await this.execute(claim);
          } else await pause(this.config.AGENT_POLL_MS);
        } catch {
          this.report('POLL_FAILED');
          await pause(this.config.AGENT_POLL_MS);
        }
      }
    } finally {
      clearInterval(interval);
      await this.heartbeatPending;
      await this.register(false).catch(() => {});
    }
  }
  stop() {
    this.stopping = true;
    this.active?.abort('WORKER_SHUTDOWN');
  }
}
