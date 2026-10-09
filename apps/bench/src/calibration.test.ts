import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures, scriptedCalibrationReview } from './fixtures.js';
import {
  calibrationMarkdown,
  runCalibration,
  scoreReview,
  summarizeCalibration,
  type CalibrationAttempt,
} from './calibration.js';
import { validateReview } from './models.js';

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
