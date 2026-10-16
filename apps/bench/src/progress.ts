import { z } from 'zod';

export const NoticeSchema = z.object({ type: z.literal('notice'), message: z.string() });

export const ProgressSchema = z.object({
  type: z.literal('progress'),
  scenario: z.string(),
  stage: z.string(),
  interaction: z.number(),
  maxMessages: z.number(),
  maxMinutes: z.number(),
  tools: z.number(),
});
export type ProgressUpdate = z.infer<typeof ProgressSchema>;
export const ResultSchema = z.object({
  type: z.literal('result'),
  scenario: z.string(),
  stopReason: z.string(),
  verdict: z.string(),
  reviewCompleted: z.boolean(),
  messages: z.number(),
  maxMessages: z.number(),
  maxMinutes: z.number(),
  report: z.string(),
  failedChecks: z.array(z.string()),
});
export type RunResult = z.infer<typeof ResultSchema>;

export function bar(value: number, total: number, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round((value / Math.max(1, total)) * width)));
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

export function executionDescription(
  result: Pick<RunResult, 'stopReason' | 'maxMessages' | 'maxMinutes'>,
) {
  const reasons: Record<string, string> = {
    completed: 'completed',
    setup_failed: 'failed during setup — see execution.log beside the report',
    coach_failed: 'failed during coach execution — see saved progress',
    athlete_failed: 'failed during simulated athlete response — see saved progress',
    message_limit: `incomplete — athlete message limit reached (${result.maxMessages})`,
    TIME_LIMIT: `incomplete — scenario time limit reached (${result.maxMinutes} minutes)`,
    INTERRUPTED: 'interrupted by user',
    TURN_LIMIT: 'failed — coach model-turn limit reached',
    TOOL_LIMIT: 'failed — coach tool-operation limit reached',
    OUTPUT_LIMIT: 'failed — output limit reached',
    EXECUTION_TIMEOUT: 'failed — coach execution deadline reached',
    PROVIDER_ERROR: 'failed — model provider error',
    MODEL_REFUSAL: 'failed — model refused the request',
    STALE_CONTEXT: 'failed — plan changed during execution',
    WORKER_FAILED: 'failed — benchmark worker stopped unexpectedly',
    WORKER_SHUTDOWN: 'failed — coaching worker shut down',
    cancelled: 'cancelled',
  };
  return reasons[result.stopReason] ?? `failed — ${result.stopReason}`;
}

export function resultLines(result: RunResult) {
  return [
    `${result.scenario}:`,
    `  Execution: ${executionDescription(result)}`,
    `  Assessment: ${result.verdict} | Reviewer: ${result.reviewCompleted ? 'completed' : 'unavailable'}`,
    `  Athlete messages: ${result.messages}/${result.maxMessages} (opening request included)`,
    ...(result.failedChecks.length ? [`  Failed checks: ${result.failedChecks.join(', ')}`] : []),
    `  Report: ${result.report}`,
  ].join('\n');
}

/** One live line on a terminal; durable stage lines when redirected. Never prints transcripts. */
export class BenchDisplay {
  private current?: ProgressUpdate;
  private started = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;
  private previous = '';
  constructor(
    private prefix = '',
    private output: Pick<NodeJS.WriteStream, 'write' | 'isTTY' | 'columns'> = process.stdout,
  ) {}

  update(value: ProgressUpdate) {
    this.current = value;
    this.draw();
    if (this.output.isTTY && !this.timer) {
      this.timer = setInterval(() => this.draw(), 1000);
      this.timer.unref();
    }
  }

  private draw() {
    const p = this.current;
    if (!p) return;
    const seconds = Math.floor((Date.now() - this.started) / 1000);
    const label = `${this.prefix}${p.scenario} | messages ${p.interaction}/${p.maxMessages} ${bar(p.interaction, p.maxMessages, 6)} | ${p.stage} | ${p.tools} tools | ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s / ${p.maxMinutes}m`;
    if (this.output.isTTY) {
      this.output.write(
        `\r\x1b[2K${label.slice(0, Math.max(1, (this.output.columns ?? 120) - 1))}`,
      );
    } else if (p.stage !== this.previous) {
      this.output.write(`${label}\n`);
    }
    this.previous = p.stage;
  }

  finish() {
    if (this.timer) clearInterval(this.timer);
    if (this.current && this.output.isTTY) this.output.write('\n');
    this.timer = undefined;
  }
}
