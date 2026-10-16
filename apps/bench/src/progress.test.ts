import { describe, expect, it, vi } from 'vitest';
import { BenchDisplay, executionDescription, resultLines, type RunResult } from './progress.js';

const result: RunResult = {
  type: 'result',
  scenario: 'cycle-beginner',
  stopReason: 'completed',
  verdict: 'incomplete',
  reviewCompleted: true,
  messages: 9,
  maxMessages: 18,
  maxMinutes: 30,
  report: '/results/report.md',
  failedChecks: ['prescriptions'],
};

describe('benchmark console', () => {
  it('distinguishes successful execution, incomplete plan assessment and missing reviewer', () => {
    expect(resultLines(result)).toContain('Execution: completed');
    expect(resultLines(result)).toContain('Assessment: incomplete | Reviewer: completed');
    expect(
      resultLines({ ...result, reviewCompleted: false, verdict: 'assessment_unavailable' }),
    ).toContain('Assessment: assessment_unavailable | Reviewer: unavailable');
    expect(resultLines(result)).toContain('Failed checks: prescriptions');
    expect(resultLines(result)).toContain('opening request included');
  });

  it.each([
    ['message_limit', 'athlete message limit reached (18)'],
    ['TIME_LIMIT', 'scenario time limit reached (30 minutes)'],
    ['TURN_LIMIT', 'coach model-turn limit'],
    ['TOOL_LIMIT', 'coach tool-operation limit'],
    ['OUTPUT_LIMIT', 'output limit'],
    ['EXECUTION_TIMEOUT', 'coach execution deadline'],
    ['PROVIDER_ERROR', 'model provider error'],
    ['MODEL_REFUSAL', 'model refused'],
    ['STALE_CONTEXT', 'plan changed'],
    ['INTERRUPTED', 'interrupted by user'],
    ['setup_failed', 'failed during setup'],
  ])('explains %s', (stopReason, description) => {
    expect(executionDescription({ ...result, stopReason })).toContain(description);
  });

  it('writes durable stage changes without terminal escape codes when redirected', () => {
    const write = vi.fn();
    const display = new BenchDisplay('Suite 1/8 | ', { write, isTTY: false, columns: 120 });
    const progress = {
      type: 'progress' as const,
      scenario: 'cycle-beginner',
      stage: 'Coach reply 1',
      interaction: 1,
      maxMessages: 18,
      maxMinutes: 30,
      tools: 0,
    };
    display.update(progress);
    display.update(progress);
    display.update({ ...progress, stage: 'Review running' });
    display.finish();
    expect(write).toHaveBeenCalledTimes(2);
    const output = write.mock.calls.flat().join('');
    expect(output).toContain('messages');
    expect(output).toContain('1/18');
    expect(output).not.toContain('\x1b');
  });

  it('redraws a live terminal line and stops its timer after completion', () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn();
      const display = new BenchDisplay('', { write, isTTY: true, columns: 160 });
      display.update({
        type: 'progress',
        scenario: 'cycle-beginner',
        stage: 'Waiting for model',
        interaction: 1,
        maxMessages: 18,
        maxMinutes: 30,
        tools: 0,
      });
      vi.advanceTimersByTime(2000);
      expect(write).toHaveBeenCalledTimes(3);
      expect(write.mock.calls[2]![0]).toContain('0m02s');
      display.finish();
      const count = write.mock.calls.length;
      vi.advanceTimersByTime(5000);
      expect(write).toHaveBeenCalledTimes(count);
    } finally {
      vi.useRealTimers();
    }
  });
});
