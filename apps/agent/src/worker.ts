import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { type AgentApi, ApiError, type Claim } from './api.js';
import { modelProfile, type AgentConfig } from './config.js';
import { PROMPT_HASH, PROMPT_VERSION } from './prompt.js';
import { failureCode, type CoachingRuntime } from './runtime/index.js';
import { failureDetails, registrationDetails, type WorkerReporter } from './logger.js';
import { coachRequestDefaults, UsageLedger } from './usage.js';

const MAX_HEARTBEAT_FAILURES = 3;
const REGISTRATION_RETRY_MS = 5000;

export class Worker {
  readonly id = randomUUID();
  private stopping = false;
  private shutdown = new AbortController();
  private active: { execution: AbortController; hardStop: AbortController } | undefined;
  private heartbeatPending: Promise<void> | undefined;
  constructor(
    private config: AgentConfig,
    private api: AgentApi,
    private runtime: CoachingRuntime,
    private report: WorkerReporter = () => {},
  ) {}
  private register(ready: boolean) {
    return this.api.register(this.config.AGENT_BOOTSTRAP_TOKEN, {
      id: this.id,
      provider: this.config.AGENT_PROVIDER,
      model: this.config.AGENT_MODEL,
      reasoning: this.config.AGENT_REASONING,
      promptVersion: PROMPT_VERSION,
      promptHash: PROMPT_HASH,
      ready,
    });
  }
  /** Every finish reports the run's ledger, even with no requests, so NULL usage means unreported. */
  private usage(ledger: UsageLedger) {
    return { ...ledger.legacyTotals(), usage: ledger.toJSON() };
  }
  async execute(claim: Claim) {
    const ledger = new UsageLedger(coachRequestDefaults(modelProfile(this.config)));
    const controller = new AbortController();
    const hardStop = new AbortController();
    this.active = { execution: controller, hardStop };
    const interrupt = (reason: string) => {
      hardStop.abort(reason);
      controller.abort(reason);
    };
    const remaining = Math.max(1, Date.parse(claim.deadlineAt) - Date.now());
    const deadline = setTimeout(() => interrupt('EXECUTION_TIMEOUT'), remaining);
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
          this.report('HEARTBEAT_FAILED', claim.runId, {
            operation: 'heartbeat',
            phase: 'running',
            attempt: failures,
            ...failureDetails(error),
          });
          if (
            failures >= MAX_HEARTBEAT_FAILURES ||
            (error instanceof ApiError && [401, 403, 404, 409].includes(error.status))
          )
            interrupt('LEASE_LOST');
        })
        .finally(() => {
          heartbeat = undefined;
        });
    }, 15000);
    try {
      const context = await this.api.context(claim, controller.signal);
      const output = await this.runtime.execute(
        context,
        claim,
        this.api,
        controller.signal,
        hardStop.signal,
        ledger,
      );
      controller.signal.throwIfAborted();
      // Built once: a transport retry resends the identical body.
      const body = { status: 'completed', ...output, ...this.usage(ledger) };
      const result = await this.api.finish(claim, body);
      this.report(result.status, claim.runId);
    } catch (error) {
      const reason = controller.signal.reason as unknown;
      const status =
        reason === 'CANCELLED' || (error instanceof ApiError && error.code === 'CANCELLED')
          ? 'cancelled'
          : 'failed';
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
          ...this.usage(ledger),
        });
        this.report(
          result.status,
          claim.runId,
          status === 'failed' ? { failureCode: code } : undefined,
        );
      } catch (finishError) {
        this.report('FINISH_FAILED', claim.runId, {
          operation: 'finish',
          phase: 'running',
          failureCode: code,
          ...failureDetails(finishError),
        });
      }
    } finally {
      clearTimeout(deadline);
      clearInterval(interval);
      await heartbeat;
      this.active = undefined;
    }
  }
  async run() {
    // During a rollout the new worker can reach an older API that rejects its prompt version.
    // Keep retrying registration without claiming work until the compatible API is ready.
    let registered = false;
    let attempt = 0;
    while (!this.stopping) {
      attempt += 1;
      try {
        await this.register(true);
        registered = true;
        this.report('WORKER_READY', undefined, {
          operation: 'register',
          phase: 'startup',
          attempt,
        });
        break;
      } catch (error) {
        this.report('REGISTRATION_FAILED', undefined, {
          operation: 'register',
          phase: 'startup',
          attempt,
          retryInMs: REGISTRATION_RETRY_MS,
          ...registrationDetails(error),
        });
        await pause(REGISTRATION_RETRY_MS, undefined, { signal: this.shutdown.signal }).catch(
          () => {},
        );
      }
    }
    if (!registered) return;
    // Worker liveness remains fresh during a long model execution.
    const interval = setInterval(() => {
      if (this.heartbeatPending || this.stopping) return;
      this.heartbeatPending = this.register(true)
        .then(() => {})
        .catch((error) => {
          this.report('REGISTRATION_FAILED', undefined, {
            operation: 'register',
            phase: 'running',
            retryInMs: 15000,
            ...registrationDetails(error),
          });
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
              await this.api.finish(claim, {
                status: 'failed',
                failureCode: 'WORKER_SHUTDOWN',
                ...this.usage(new UsageLedger()),
              });
            } else await this.execute(claim);
          } else await pause(this.config.AGENT_POLL_MS);
        } catch (error) {
          this.report('POLL_FAILED', undefined, {
            operation: 'claim',
            phase: 'running',
            retryInMs: this.config.AGENT_POLL_MS,
            ...failureDetails(error),
          });
          await pause(this.config.AGENT_POLL_MS);
        }
      }
    } finally {
      clearInterval(interval);
      await this.heartbeatPending;
      await this.register(false).catch((error) => {
        this.report('REGISTRATION_FAILED', undefined, {
          operation: 'register',
          phase: 'shutdown',
          ...registrationDetails(error),
        });
      });
    }
  }
  stop() {
    this.stopping = true;
    this.shutdown.abort();
    this.active?.hardStop.abort('WORKER_SHUTDOWN');
    this.active?.execution.abort('WORKER_SHUTDOWN');
  }
}
