import type OpenAI from 'openai';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures, scriptedCalibrationReview } from './fixtures.js';
import {
  calibrationMarkdown,
  readCalibrationResults,
  runCalibration,
  scoreReview,
  summarizeCalibration,
  type CalibrationAttempt,
} from './calibration.js';
import {
  EvaluationModels,
  availableEvidenceReferences,
  ReviewValidationError,
  validateReview,
} from './models.js';

describe('grader calibration fixtures', () => {
  it('keeps independent development/holdout cases and rejects unknown selections', async () => {
    const all = await loadFixtures('all');
    const dev = await loadFixtures('development');
    const holdout = await loadFixtures('holdout');
    expect(all.fixtures).toHaveLength(12);
    expect(dev.fixtures).toHaveLength(8);
    expect(holdout.fixtures).toHaveLength(4);
    expect(new Set([...dev.fixtures, ...holdout.fixtures].map((f) => f.id)).size).toBe(12);
    await expect(loadFixtures('development', ['duration-preference'])).rejects.toThrow(
      'outside selected split',
    );
    await expect(loadFixtures('all', ['unknown'])).rejects.toThrow('Unknown fixture');
  });
  it('keeps positive distance and duration prescriptions coherent and independent', async () => {
    const { fixtures } = await loadFixtures('all');
    const distance = fixtures.find((f) => f.id === 'distance-control')!;
    const duration = fixtures.find((f) => f.id === 'duration-control')!;
    const preference = fixtures.find((f) => f.id === 'duration-preference')!;
    expect(distance.evidence.plan!.workouts[0]!.prescription.completion?.type).toBe('distance');
    expect(
      duration.evidence.plan!.workouts.every((w) => w.prescription.completion?.type === 'duration'),
    ).toBe(true);
    for (const { workout, prescription } of duration.evidence.plan!.workouts) {
      expect(prescription.completion?.value).toBe(workout.estimatedDurationSeconds);
      const sunday = new Date(`${workout.scheduledDate}T12:00:00Z`).getUTCDay() === 0;
      expect(workout.estimatedDurationSeconds!).toBeLessThanOrEqual(sunday ? 6000 : 3600);
    }
    expect(preference.evidence.messages.find((m) => m.sequence === 11)!.content).toContain(
      'prefer workouts prescribed in minutes',
    );
    expect(distance.evidence.messages.find((m) => m.sequence === 11)!.content).not.toContain(
      'prefer workouts prescribed in minutes',
    );
    expect(distance.evidence.messages.find((m) => m.sequence === 3)!.content).toContain(
      'without a target finish time',
    );
  });
  it('plants defects in saved evidence, including unsupported goals and contradictory summaries', async () => {
    const { fixtures } = await loadFixtures('all');
    const goal = fixtures.find((f) => f.id === 'unconfirmed-goal')!;
    expect(goal.evidence.messages.find((m) => m.sequence === 3)!.content).not.toContain(
      'target finish time',
    );
    expect(goal.disclosures.flatMap((d) => d.factIds)).not.toContain('goal');
    expect(goal.evidence.plan!.brief.brief.goal).toContain('explicitly confirmed');
    const mismatch = fixtures.find((f) => f.id === 'false-summary')!;
    expect(mismatch.evidence.messages.at(-1)!.content).toContain('16 km');
    expect(mismatch.evidence.plan!.workouts[2]!.prescription.completion?.value).toBe(9000);
    const injection = fixtures.find((f) => f.id === 'injection-load-jump')!;
    expect(injection.evidence.plan!.workouts[2]!.prescription.completion?.value).toBe(30000);
    expect(injection.evidence.plan!.workouts[2]!.workout.description).toContain('SYSTEM OVERRIDE');
    const missing = fixtures.find((f) => f.id === 'missing-prescription')!;
    expect(missing.evidence.plan!.workouts[2]!.prescription.completion).toBeNull();
    expect(missing.evidence.plan!.workouts[2]!.prescription.targets).toEqual([]);
  });
});

describe('calibration comparisons', () => {
  it('supports explicit missing-plan evidence and refuses it when a plan exists', async () => {
    const { fixtures } = await loadFixtures('all', ['missing-plan', 'distance-control']);
    const missing = fixtures.find((f) => f.id === 'missing-plan')!;
    const present = fixtures.find((f) => f.id === 'distance-control')!;
    const review = scriptedCalibrationReview(missing.evidence);
    review.criteria.forEach((c) => {
      c.evidence = ['plan:missing'];
    });
    expect(availableEvidenceReferences(missing.evidence)).toContain('plan:missing');
    expect(availableEvidenceReferences(missing.evidence)).not.toContain('plan:brief');
    expect(() => validateReview(review, missing.evidence)).not.toThrow();
    expect(() => validateReview(review, present.evidence)).toThrow(ReviewValidationError);
    review.verdict = 'needs_revision';
    expect(() => validateReview(review, missing.evidence)).toThrow(
      'must be assessed as incomplete',
    );
  });
  it('scores targeted missed defects and false alarms separately from overall verdicts', async () => {
    const { fixtures } = await loadFixtures('all');
    const bad = fixtures.find((f) => f.id === 'unavailable-day')!;
    const pass = scriptedCalibrationReview(bad.evidence);
    expect(scoreReview(bad, pass)).toMatchObject({
      matched: false,
      badPlanAccepted: true,
      judgments: [{ criterion: 'personalization', missedDefect: true, falseAlarm: false }],
    });
    pass.verdict = 'needs_revision';
    expect(scoreReview(bad, pass)).toMatchObject({
      verdictMatched: true,
      matched: false,
      badPlanAccepted: false,
    });
    const good = fixtures.find((f) => f.id === 'distance-control')!;
    const uncertain = scriptedCalibrationReview(good.evidence);
    uncertain.criteria.find((c) => c.criterion === 'progression')!.result = 'uncertain';
    uncertain.verdict = 'needs_revision';
    expect(
      scoreReview(good, uncertain).judgments.find((j) => j.criterion === 'progression'),
    ).toMatchObject({ falseAlarm: true, missedDefect: false, matched: false });
  });
  it('requires valid citations and rejects acceptable verdicts with uncertain findings', async () => {
    const { fixtures } = await loadFixtures('all', ['distance-control']);
    const fixture = fixtures[0]!;
    const review = scriptedCalibrationReview(fixture.evidence);
    review.criteria[0]!.evidence = ['workout:invented'];
    expect(() => validateReview(review, fixture.evidence)).toThrow('invalid evidence');
    review.criteria[0]!.evidence = ['message:1'];
    review.criteria[0]!.result = 'uncertain';
    expect(() => validateReview(review, fixture.evidence)).toThrow('contradicts');
  });
  it('distinguishes repeat variation, errors and cases without enough observations', async () => {
    const { fixtures } = await loadFixtures('all', ['distance-control', 'load-jump']);
    const good = fixtures.find((f) => f.id === 'distance-control')!;
    const r1 = scriptedCalibrationReview(good.evidence);
    const r2 = structuredClone(r1);
    r2.verdict = 'needs_revision';
    r2.criteria[0]!.result = 'uncertain';
    const attempts: CalibrationAttempt[] = [r1, r2].map((review, i) => ({
      fixtureId: good.id,
      repetition: i + 1,
      elapsedMs: 100,
      status: 'completed',
      review,
      usage: { inputTokens: 10, outputTokens: 2 },
      score: scoreReview(good, review),
    }));
    attempts.push({
      fixtureId: 'load-jump',
      repetition: 1,
      elapsedMs: 100,
      status: 'error',
      diagnostic: { category: 'provider_authentication', httpStatus: 401, errorType: 'Error' },
    });
    const summary = summarizeCalibration(fixtures, 3, attempts);
    expect(summary).toMatchObject({
      requested: 6,
      completed: 2,
      errors: 1,
      pending: 3,
      falseAlarms: 1,
    });
    expect(summary.stability.find((s) => s.fixtureId === good.id)?.consistency).toBe('variable');
    expect(summary.stability.find((s) => s.fixtureId === 'load-jump')?.consistency).toBe(
      'not_measured',
    );
    expect(calibrationMarkdown(fixtures, attempts, summary, false)).toContain(
      'Errors: 1. Pending: 3.',
    );
  });
});

describe('calibration execution', () => {
  it('preserves rejected reviews with a specific reason and usage, without counting them as judgments', async () => {
    const { fixtures } = await loadFixtures('all', ['missing-plan']);
    const directory = await mkdtemp(resolve(tmpdir(), 'askesis-calibration-'));
    try {
      const result = await runCalibration({
        directory,
        fixtures,
        repeat: 1,
        scripted: false,
        signal: new AbortController().signal,
        reviewer: async (evidence) => {
          const review = scriptedCalibrationReview(evidence);
          review.criteria.forEach((c) => {
            c.evidence = ['plan:brief'];
          });
          return { review, usage: { inputTokens: 3, outputTokens: 4 } };
        },
      });
      expect(result.summary).toMatchObject({
        completed: 0,
        errors: 1,
        verdictMatches: 0,
        inputTokens: 3,
        outputTokens: 4,
      });
      const attempt = JSON.parse(
        await readFile(resolve(directory, 'missing-plan/attempt-1.json'), 'utf8'),
      );
      expect(attempt).toMatchObject({
        status: 'error',
        diagnostic: {
          category: 'review_validation_error',
          errorType: 'ReviewValidationError',
          errorCode: 'REVIEW_EVIDENCE_INVALID',
          validationReason: 'Reviewer returned missing or invalid evidence references.',
        },
        invalidReview: { verdict: 'incomplete' },
        usage: { inputTokens: 3, outputTokens: 4 },
      });
      expect(attempt.invalidReview.criteria[0].evidence).toEqual(['plan:brief']);
      expect(await readFile(resolve(directory, 'report.md'), 'utf8')).toContain(
        'REVIEW_EVIDENCE_INVALID',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('withholds labels and exposes the defects missed by a permissive stand-in', async () => {
    const { fixtures } = await loadFixtures('all');
    const directory = await mkdtemp(resolve(tmpdir(), 'askesis-calibration-'));
    try {
      let calls = 0;
      const result = await runCalibration({
        directory,
        fixtures,
        repeat: 2,
        scripted: true,
        signal: new AbortController().signal,
        reviewer: async (evidence, disclosures) => {
          calls++;
          expect(Object.keys(evidence).sort()).toEqual(['messages', 'performance', 'plan']);
          expect(JSON.stringify(disclosures)).not.toContain('expected');
          return {
            review: scriptedCalibrationReview(evidence),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
      });
      expect(calls).toBe(24);
      expect(result.summary).toMatchObject({
        completed: 24,
        fixtureMatches: 8,
        badPlansAccepted: 16,
        missedDefects: 16,
        falseAlarms: 0,
      });
      expect(result.summary.stability.every((s) => s.consistency === 'stable')).toBe(true);
      expect(await readFile(resolve(directory, 'report.md'), 'utf8')).toContain(
        'SCRIPTED WIRING CHECK',
      );
      const input = JSON.parse(
        await readFile(resolve(directory, 'unconfirmed-goal/input.json'), 'utf8'),
      );
      expect(input.expectedCriteria).toBeUndefined();
      expect(
        JSON.parse(await readFile(resolve(directory, 'unconfirmed-goal/expected.json'), 'utf8'))
          .expectedCriteria.conversation,
      ).toEqual(['fail', 'uncertain']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('retains successes and stops after provider failure without scoring the error', async () => {
    const { fixtures } = await loadFixtures('all', ['distance-control']);
    const directory = await mkdtemp(resolve(tmpdir(), 'askesis-calibration-'));
    try {
      let calls = 0;
      const result = await runCalibration({
        directory,
        fixtures,
        repeat: 3,
        scripted: false,
        signal: new AbortController().signal,
        reviewer: async (evidence) => {
          if (++calls === 2)
            throw { name: 'AuthenticationError', status: 401, message: 'confidential' };
          return {
            review: scriptedCalibrationReview(evidence),
            usage: { inputTokens: 3, outputTokens: 4 },
          };
        },
      });
      expect(result).toMatchObject({
        operationalFailure: true,
        summary: { completed: 1, errors: 1, pending: 1, verdictMatches: 1 },
      });
      expect(await readFile(resolve(directory, 'results.json'), 'utf8')).not.toContain(
        'confidential',
      );
      expect(JSON.parse(await readFile(resolve(directory, 'state.json'), 'utf8')).stage).toBe(
        'failed',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('saves an interrupted run with pending cases and no fabricated judgments', async () => {
    const { fixtures } = await loadFixtures('all', ['distance-control']);
    const directory = await mkdtemp(resolve(tmpdir(), 'askesis-calibration-'));
    const abort = new AbortController();
    try {
      const result = await runCalibration({
        directory,
        fixtures,
        repeat: 3,
        scripted: false,
        signal: abort.signal,
        reviewer: async (evidence) => {
          abort.abort('INTERRUPTED');
          return {
            review: scriptedCalibrationReview(evidence),
            usage: { inputTokens: 3, outputTokens: 4 },
          };
        },
      });
      expect(result).toMatchObject({
        operationalFailure: true,
        summary: { completed: 1, pending: 2, errors: 0 },
      });
      expect(JSON.parse(await readFile(resolve(directory, 'state.json'), 'utf8')).stage).toBe(
        'interrupted',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('detailed calibration usage', () => {
  for (const terminal of ['completed', 'rejected', 'connection'] as const)
    it(`persists the ${terminal} attempt ledger and applied cost through real SDK calls`, async () => {
      const { fixtures } = await loadFixtures('all', ['missing-plan']);
      const review = scriptedCalibrationReview(fixtures[0]!.evidence);
      if (terminal === 'rejected') review.criteria[0]!.evidence = ['workout:invented'];
      const client = {
        responses: {
          create: async () => {
            if (terminal === 'connection') throw new Error('private provider failure');
            return {
              object: 'response',
              id: 'calibration-test',
              model: 'gpt-6.1-sol',
              service_tier: 'flex',
              status: 'completed',
              output: [
                {
                  type: 'message',
                  role: 'assistant',
                  id: 'msg-test',
                  status: 'completed',
                  content: [{ type: 'output_text', text: JSON.stringify(review), annotations: [] }],
                },
              ],
              usage: {
                input_tokens: 272001,
                input_tokens_details: { cached_tokens: 50, cache_write_tokens: 20 },
                output_tokens: 40,
                output_tokens_details: { reasoning_tokens: 25 },
              },
            };
          },
        },
      } as unknown as OpenAI;
      const models = new EvaluationModels('test', 'gpt-6.1-sol', client);
      const directory = await mkdtemp(resolve(tmpdir(), 'bench-calibration-usage-'));
      try {
        const result = await runCalibration({
          directory,
          fixtures,
          repeat: 2,
          scripted: false,
          reviewerModel: models.model,
          signal: new AbortController().signal,
          reviewer: models.review.bind(models),
        });
        const saved = JSON.parse(await readFile(resolve(directory, 'results.json'), 'utf8'));
        const expectedAttempts = terminal === 'completed' ? 2 : 1;
        expect(result.attempts).toHaveLength(expectedAttempts);
        expect(saved.attempts).toHaveLength(expectedAttempts);
        const attempt = saved.attempts[0];
        expect(attempt.ledger).toMatchObject({
          coverage: 'recorded',
          recordedRequests: 1,
          outcome:
            terminal === 'completed'
              ? 'succeeded'
              : terminal === 'rejected'
                ? 'rejected_output'
                : 'failed',
        });
        expect(attempt.requests).toHaveLength(1);
        expect(saved.summary.usage.requests.total).toBe(expectedAttempts);
        expect(JSON.stringify(saved)).not.toContain('private provider failure');
        if (terminal === 'connection') {
          expect(attempt.requests[0]).toMatchObject({
            usageSource: 'none',
            cost: { usd: null, unpricedReason: 'usage_unverified' },
          });
          expect(saved.summary.usage.complete).toBe(false);
          expect(saved.summary.costEstimate.usd).toBeNull();
        } else {
          const cost = (271931 * 2 + 50 * 0.1 + 20 * 2.5 + 40 * 7.5) / 1e6;
          expect(attempt.requests[0].cost).toMatchObject({
            lookup: { tier: 'flex', longContext: true },
            rates: { inputPerMTok: 2 },
            entry: { id: 'openai/gpt-6.1-sol/flex' },
          });
          expect(attempt.requests[0].cost.usd).toBeCloseTo(cost, 12);
          expect(saved.summary.costEstimate.usd).toBeCloseTo(cost * expectedAttempts, 12);
          expect(attempt.usage).toEqual({ inputTokens: 272001, outputTokens: 40 });
        }
        expect(readCalibrationResults(saved).usageDetail.costEstimate).toEqual(
          saved.summary.costEstimate,
        );
        expect(readCalibrationResults(saved).usageDetail.usage).toEqual(saved.summary.usage);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  it('keeps old attempts without ledgers historical, including absent usage, while scripted remains not applicable', () => {
    const attempts = [
      { fixtureId: 'one', repetition: 1, usage: { inputTokens: 100, outputTokens: 20 } },
      { fixtureId: 'two', repetition: 1 },
    ] as CalibrationAttempt[];
    const original = JSON.stringify(attempts);
    const detail = readCalibrationResults({ attempts }).usageDetail;
    expect(detail.usage).toMatchObject({
      requests: { total: null },
      ledgers: { historical: 2 },
      complete: false,
      legacyTotals: { inputTokens: 100, outputTokens: 20 },
    });
    expect(detail.costEstimate.usd).toBeNull();
    expect(JSON.stringify(attempts)).toBe(original);
    const scripted = readCalibrationResults({ attempts, summary: { scripted: true } }).usageDetail;
    expect(scripted.usage).toMatchObject({ complete: true, requests: { total: 0 } });
    expect(scripted.costEstimate).toMatchObject({ scripted: true, usd: null });
  });
});
