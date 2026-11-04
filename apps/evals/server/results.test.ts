import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadIndex, loadRunDetail, resolveId, saveHighlights, saveReview } from './results';

let root: string;

async function write(relative: string, value: unknown) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'evals-results-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadIndex', () => {
  it('normalizes a completed run and scores checks plus criteria', async () => {
    const run = '2026-10-09T14-43-40-829Z-c2f3e198';
    await write(`${run}/manifest.json`, {
      startedAt: '2026-10-09T14:43:40.842Z',
      scenarioId: 'running-poc',
      revision: '14a311dcd74c4746',
      scripted: false,
    });
    await write(`${run}/configuration.json`, {
      coach: { model: 'gpt-6.1-sol', reasoning: 'medium' },
      reviewerModel: 'gpt-6.1-sol',
    });
    await write(`${run}/assessment.json`, {
      verdict: 'needs_revision',
      stopReason: 'completed',
      review: {
        verdict: 'needs_revision',
        criteria: [
          { criterion: 'goal_fit', result: 'pass', explanation: 'ok', evidence: ['plan:brief'] },
          { criterion: 'progression', result: 'fail', explanation: 'jump', evidence: [] },
        ],
      },
      checks: [
        { id: 'plan_saved', status: 'pass', explanation: '', evidence: [] },
        { id: 'coverage', status: 'pass', explanation: '', evidence: [] },
      ],
    });
    await write(`${run}/metrics.json`, {
      coachUsage: [
        { inputTokens: 100, outputTokens: 10 },
        { inputTokens: 200, outputTokens: 20 },
      ],
      evaluationUsage: [{ role: 'reviewer', usage: { inputTokens: 50, outputTokens: 5 } }],
    });
    await write(
      `${run}/progress.jsonl`,
      '{"at":"2026-10-09T14:43:43.000Z","stage":"ready"}\n{"at":"2026-10-09T14:45:43.000Z","stage":"done"}\n{"at":',
    );
    await write(
      `${run}/tool-trace.jsonl`,
      '{"status":"started"}\n{"status":"completed"}\n{"status":"failed"}\n',
    );

    const index = await loadIndex(root);
    expect(index.runs).toHaveLength(1);
    const summary = index.runs[0];
    expect(summary).toMatchObject({
      id: run,
      coachModel: 'gpt-6.1-sol',
      reasoning: 'medium',
      verdict: 'needs_revision',
      revision: '14a311d',
      durationMs: 120_000,
      toolCalls: 2,
      toolFailures: 1,
      coachTurns: 2,
      tokens: { coachInput: 300, coachOutput: 30, evaluationInput: 50, evaluationOutput: 5 },
    });
    expect(summary?.score).toBeCloseTo(3 / 4);
  });

  it('treats a run without an assessment as running and skips directories without a manifest', async () => {
    await write('2026-10-09T11-07-21-939Z-fe629067/manifest.json', {
      startedAt: '2026-10-09T11:07:21Z',
    });
    await write('2026-10-09T11-07-21-939Z-fe629067/state.json', { stage: 'Coach turn 2' });
    await write('stray/notes.txt', 'nothing');

    const index = await loadIndex(root);
    expect(index.runs[0]).toMatchObject({ verdict: 'running', stage: 'Coach turn 2', score: null });
    expect(index.skipped).toEqual([{ id: 'stray', reason: 'missing manifest.json' }]);
  });

  it('reads calibration suites with fixture labels', async () => {
    const suite = 'calibration-2026-10-09T23-12-04-163Z-eac411b1';
    await write(`${suite}/manifest.json`, {
      startedAt: '2026-10-09T23:12:04.164Z',
      scripted: true,
      split: 'all',
      repeat: 2,
      fixtures: [{ id: 'load-jump', split: 'development' }],
    });
    await write(`${suite}/load-jump/expected.json`, {
      description: 'Long run jumps to 30 km.',
      expectedVerdicts: ['needs_revision'],
      expectedCriteria: { progression: ['fail'] },
    });
    await write(`${suite}/results.json`, {
      summary: {
        requested: 2,
        completed: 2,
        labeledJudgments: 2,
        judgmentMatches: 0,
        missedDefects: 2,
      },
      attempts: [
        {
          fixtureId: 'load-jump',
          repetition: 1,
          status: 'completed',
          review: {
            verdict: 'acceptable',
            criteria: [{ criterion: 'progression', result: 'pass' }],
          },
          score: {
            verdictMatched: false,
            badPlanAccepted: true,
            judgments: [
              {
                criterion: 'progression',
                expected: ['fail'],
                actual: 'pass',
                matched: false,
                missedDefect: true,
              },
            ],
          },
        },
      ],
    });

    const [calibration] = (await loadIndex(root)).calibrations;
    expect(calibration?.fixtures[0]).toMatchObject({
      id: 'load-jump',
      expectedCriteria: { progression: ['fail'] },
    });
    expect(calibration?.missedDefects).toBe(2);
    expect(calibration?.attempts[0]).toMatchObject({
      verdict: 'acceptable',
      badPlanAccepted: true,
    });
  });
});

describe('run ids', () => {
  it('rejects ids that escape the results directory', async () => {
    expect(resolveId(root, '../secrets')).toBeNull();
    expect(resolveId(root, 'a/b')).toBeNull();
    expect(resolveId(root, '..')).toBeNull();
    expect(await loadRunDetail(root, '../etc')).toBeNull();
  });
});

describe('human annotations', () => {
  it('retains communication ratings and phrase highlights independently on reload', async () => {
    const run = '2026-10-14-human-review';
    await write(`${run}/manifest.json`, { scenarioId: 'running-improver' });
    const review = {
      verdict: 'fit',
      notes: 'Clear explanation.',
      communication: { tone: 4, clarity: 5, adaptation: 3 },
    };
    const highlights = [
      {
        sequence: 2,
        quote: 'What has your running looked like?',
        tag: 'great question',
        createdAt: '2026-10-14T12:00:00Z',
      },
    ];
    await saveReview(root, run, review);
    await saveHighlights(root, run, highlights);
    const reloaded = await loadRunDetail(root, run);
    expect(reloaded?.review).toMatchObject(review);
    expect(reloaded?.highlights).toEqual(highlights);
    await saveReview(root, run, { ...review, notes: 'Updated notes.' });
    expect((await loadRunDetail(root, run))?.highlights).toEqual(highlights);
    expect(await saveHighlights(root, '../escape', highlights)).toBe('not_found');
  });
});
