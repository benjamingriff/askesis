import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import { Artifacts } from './artifacts.js';
import { loadFixtures, scriptedCalibrationReview } from './fixtures.js';
import { EvaluationModels } from './models.js';
import { loadScenario } from './scenario.js';
import { regradeDirectory, upgradeLegacyMetrics } from './regrade.js';
import { buildMetrics, type UsageMetrics } from './usage-report.js';
import { PRICE_TABLE } from './pricing-table.js';
import { BenchmarkError } from './local.js';

const { fixtures } = await loadFixtures('all', ['missing-plan']);
const evidence = fixtures[0]!.evidence;
const scenario = await loadScenario('running-improver');
const assessment = { stopReason: 'failed', scripted: false, verdict: 'incomplete', review: null };
let directory: string;
let artifacts: Artifacts;
const started = {
  id: 'started',
  status: 'failed',
  started_at: '2026-10-20',
  input_tokens: 1000,
  output_tokens: 200,
  usage: null,
};
const queued = {
  id: 'queued',
  status: 'cancelled',
  started_at: null,
  input_tokens: null,
  output_tokens: null,
  usage: null,
};
const snapshot = { ...evidence, runs: [started, queued] } as unknown as BenchmarkSnapshot;
const json = async (name: string) => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
const metrics = () => json('metrics.json') as Promise<UsageMetrics & Record<string, unknown>>;
function models(failure?: Error, rejected: boolean | 'malformed' = false) {
  const review = scriptedCalibrationReview(evidence);
  if (rejected === true) review.criteria[0]!.evidence = ['workout:invented'];
  const response = {
    object: 'response',
    id: 'resp-test',
    model: 'gpt-6.1-sol',
    service_tier: 'default',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        id: 'msg-test',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: rejected === 'malformed' ? '{invalidjson' : JSON.stringify(review),
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
      output_tokens: 10,
      output_tokens_details: { reasoning_tokens: 3 },
    },
  };
  const client = {
    responses: {
      create: async () => {
        if (failure) throw failure;
        return response;
      },
    },
  } as unknown as OpenAI;
  return new EvaluationModels('test', 'gpt-6.1-sol', client);
}
const grade = (stamp = 1760000000000, model = models()) =>
  regradeDirectory(directory, { models: model, now: () => stamp });
function originalUnknown(m: UsageMetrics) {
  for (const scope of [
    ...Object.values(m.summary.byRole),
    m.summary.coach,
    m.summary.evaluatorOverhead,
    m.summary.combined,
  ]) {
    expect(scope.requests.total).toBeNull();
    expect(scope.complete).toBe(false);
  }
  for (const cost of [
    ...Object.values(m.costEstimate.byRole),
    m.costEstimate.coach,
    m.costEstimate.evaluatorOverhead,
    m.costEstimate.combined,
  ])
    expect(cost.usd).toBeNull();
  expect(m.combinedIncludingRegrades.summary.complete).toBe(false);
  expect(m.combinedIncludingRegrades.costEstimate.usd).toBeNull();
}
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'bench-regrade-'));
  artifacts = new Artifacts(directory);
  await artifacts.json('snapshot.json', snapshot);
  await artifacts.json('disclosures.json', []);
  await artifacts.json('assessment.json', assessment);
  await artifacts.json('scenario.json', scenario);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('real historical upgrade and regrade', () => {
  it('refreshes report costs and coverage after rejected and failed regrades without replacing the assessment', async () => {
    await artifacts.json('metrics.json', buildMetrics([], []));
    await grade();
    const originalAssessment = await readFile(resolve(directory, 'assessment.json'), 'utf8');
    const report = () => readFile(resolve(directory, 'report.md'), 'utf8');
    const assessmentSection = (text: string) => text.split('\n## Usage and estimated cost\n')[0];
    const originalSection = assessmentSection(await report());
    const initialCost = (await metrics()).combinedIncludingRegrades.costEstimate.knownUsd;

    await expect(grade(1760000001000, models(undefined, true))).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INVALID',
    });
    const rejectedReport = await report();
    expect(rejectedReport).toContain('Regrade 2025-10-09T08:53:21.000Z');
    expect(rejectedReport).toContain(`$${(initialCost * 2).toFixed(6)} (estimate)`);
    expect(assessmentSection(rejectedReport)).toBe(originalSection);
    expect(await readFile(resolve(directory, 'assessment.json'), 'utf8')).toBe(originalAssessment);

    const failure = new Error('private connection failure');
    await expect(grade(1760000002000, models(failure))).rejects.toBe(failure);
    const failedReport = await report();
    expect(failedReport).toContain('Regrade 2025-10-09T08:53:22.000Z');
    expect(failedReport).toContain('2 of 3 recorded requests priced');
    expect(failedReport).toContain('(incomplete)');
    expect(failedReport).not.toContain('private connection');
    expect(assessmentSection(failedReport)).toBe(originalSection);
    expect(await readFile(resolve(directory, 'assessment.json'), 'utf8')).toBe(originalAssessment);
  });

  it('keeps the actionable CLI error for retired scenarios before making a review call', async () => {
    await artifacts.json('scenario.json', { ...scenario, edition: undefined });
    await expect(
      grade(1760000000000, models(new Error('should not be called'))),
    ).rejects.toMatchObject({
      constructor: BenchmarkError,
      message: 'This run used the retired running-poc scenario format and cannot be regraded.',
    });
    await expect(readFile(resolve(directory, 'metrics.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  for (const source of ['absent', 'empty'] as const)
    it(`keeps ${source} historical metrics unknown while pricing the new regrade`, async () => {
      if (source === 'empty')
        await artifacts.json('metrics.json', {
          evaluationUsage: [],
          coachUsage: [],
          monetaryCost: null,
        });
      await grade();
      const m = await metrics();
      originalUnknown(m);
      expect(m.summary.coach.legacyTotals).toMatchObject({ inputTokens: 1000, outputTokens: 200 });
      expect(m.ledgers.find((l) => l.coachRunId === 'queued')!.coverage).toBe('not_started');
      const regrade = m.regrades[0]!;
      expect(regrade.summary).toMatchObject({ complete: true, requests: { total: 1 } });
      expect(regrade.costEstimate.usd).toBeCloseTo(
        (75 * 2 + 20 * 0.1 + 5 * 2.5 + 10 * 10) / 1e6,
        12,
      );
      expect(m.combinedIncludingRegrades.costEstimate.knownUsd).toBe(regrade.costEstimate.usd);
      if (source === 'empty') {
        expect(m.evaluationUsage).toEqual([]);
        expect(m.coachUsage).toEqual([]);
        expect(m.monetaryCost).toBeNull();
      } else {
        expect(m).not.toHaveProperty('evaluationUsage');
        expect(m).not.toHaveProperty('coachUsage');
      }
      expect((await json('review-1760000000000.json')).usageDetail).toEqual(regrade);
      expect((await json('review-1760000000000.json')).usage).toEqual({
        inputTokens: 100,
        outputTokens: 10,
      });
    });
  it('retains the omitted failed reviewer sentinel and counts legacy totals only once', async () => {
    await artifacts.json('metrics.json', {
      evaluationUsage: [
        { role: 'simulator', usage: { inputTokens: 10, outputTokens: 1 } },
        { role: 'simulator', usage: { inputTokens: 20, outputTokens: 2 } },
        { role: 'voice', usage: { inputTokens: 5, outputTokens: 1 } },
      ],
      coachUsage: [{ runId: 'started', inputTokens: 500, outputTokens: 50 }],
      monetaryCost: null,
    });
    await artifacts.line('events.jsonl', { stage: 'review_failed' });
    await grade();
    const m = await metrics();
    originalUnknown(m);
    expect(m.ledgers.find((l) => l.role === 'reviewer')).toMatchObject({
      coverage: 'historical',
      legacy: null,
      legacyEntries: 0,
    });
    expect(m.summary.byRole.simulator).toMatchObject({
      ledgers: { historical: 1 },
      legacyTotals: { inputTokens: 30, outputTokens: 3 },
    });
    expect(m.ledgers.find((l) => l.role === 'simulator')!.legacyEntries).toBe(2);
    expect(m.summary.combined.legacyTotals).toMatchObject({ inputTokens: 535, outputTokens: 54 });
  });
  it('keeps legacy regrades separate from a scripted original and preserves measured regrades', async () => {
    await artifacts.json('assessment.json', { ...assessment, scripted: true });
    await artifacts.json('metrics.json', { evaluationUsage: [] });
    await artifacts.json('review-1750000000000.json', {
      review: {},
      model: 'gpt-6.1-sol',
      usage: { inputTokens: 500, outputTokens: 50 },
    });
    await grade();
    const m = await metrics();
    expect(m.summary.combined).toMatchObject({ complete: true, requests: { total: 0 } });
    expect(m.costEstimate.combined.scripted).toBe(true);
    expect(m.regrades).toHaveLength(2);
    expect(m.regrades[0]).toMatchObject({
      status: 'historical',
      summary: { complete: false, legacyTotals: { inputTokens: 500, outputTokens: 50 } },
    });
    expect(m.regrades[1]!.costEstimate.complete).toBe(true);
    expect(m.combinedIncludingRegrades.costEstimate.usd).toBeNull();
    const report = await readFile(resolve(directory, 'report.md'), 'utf8');
    expect(report).toContain('Combined including regrades |');
    expect(report).toContain(`at least $${m.regrades[1]!.costEstimate.knownUsd.toFixed(6)}`);
    expect(m.combinedIncludingRegrades.costEstimate.scripted).toBe(false);
  });
  it('shows measured regrade costs for scripted originals, including later incomplete attempts', async () => {
    await artifacts.json('assessment.json', { ...assessment, scripted: true });
    await grade();
    const first = await metrics();
    const cost = first.regrades[0]!.costEstimate.usd!;
    expect(first.costEstimate.combined.scripted).toBe(true);
    expect(first.combinedIncludingRegrades.costEstimate).toMatchObject({
      scripted: false,
      complete: true,
      usd: cost,
      pricedRequests: 1,
    });
    const combinedRow = async () =>
      (await readFile(resolve(directory, 'report.md'), 'utf8'))
        .split('\n')
        .find((line) => line.startsWith('| Combined including regrades |'))!;
    expect(await combinedRow()).toContain(`$${cost.toFixed(6)} (estimate)`);
    expect(await combinedRow()).not.toContain('not applicable');

    await grade(1760000001000);
    expect((await metrics()).combinedIncludingRegrades.costEstimate.usd).toBe(cost * 2);
    const failure = new Error('connection failure');
    await expect(grade(1760000002000, models(failure))).rejects.toBe(failure);
    expect((await metrics()).combinedIncludingRegrades.costEstimate).toMatchObject({
      scripted: false,
      complete: false,
      usd: null,
      knownUsd: cost * 2,
    });
    expect(await combinedRow()).toContain(`at least $${(cost * 2).toFixed(6)}`);
    expect(await combinedRow()).toContain('2 of 3 recorded requests priced');
    expect(await combinedRow()).not.toContain('not applicable');
  });
  it('backs up unreadable metrics byte for byte', async () => {
    const raw = '{ invalid JSON\n\t';
    await artifacts.text('metrics.json', raw);
    await grade();
    expect((await metrics()).historicalBasis).toBe('unreadable');
    expect(await readFile(resolve(directory, 'metrics-before-usage-v2.json'), 'utf8')).toBe(raw);
  });
  it('appends once on a second grade, preserving previous entries and decisions after prices change', async () => {
    await grade();
    const first = await metrics();
    const previous = PRICE_TABLE[0]!.rates.inputPerMTok;
    try {
      PRICE_TABLE[0]!.rates.inputPerMTok = 999;
      await grade(1760000001000);
    } finally {
      PRICE_TABLE[0]!.rates.inputPerMTok = previous;
    }
    const second = await metrics();
    expect(second.regrades).toHaveLength(2);
    expect(second.regrades[0]).toEqual(first.regrades[0]);
    expect(second.ledgers).toEqual(first.ledgers);
    expect(second.requests).toEqual(first.requests);
    expect(second.summary).toEqual(first.summary);
    expect(second.costEstimate).toEqual(first.costEstimate);
    expect(second.regrades[1]!.requests[0]!.cost.rates!.inputPerMTok).toBe(999);
    expect((await json('review-1760000000000.json')).usageDetail).toEqual(first.regrades[0]);
  });
  it('writes failed review detail and metrics before rethrowing the same connection error', async () => {
    const failure = new Error('secret connection failure');
    await expect(grade(1760000000000, models(failure))).rejects.toBe(failure);
    const m = await metrics();
    originalUnknown(m);
    expect(m.regrades[0]).toMatchObject({
      status: 'failed',
      summary: { complete: false },
      requests: [{ usageSource: 'none' }],
    });
    expect(await json('assessment.json')).toEqual(assessment);
    const review = await json('review-1760000000000.json');
    expect(review).not.toHaveProperty('usage');
    expect(review.usageDetail).toEqual(m.regrades[0]);
    expect(JSON.stringify(review)).not.toContain('secret connection');
    const report = await readFile(resolve(directory, 'report.md'), 'utf8');
    expect(report).toContain('Regrade 2025-10-09T08:53:20.000Z');
    expect(report).toContain('Historical/missing-ledger legacy totals');
    expect(report).toContain('unknown (');
  });
  it('persists rejected output usage while leaving the prior assessment intact', async () => {
    await expect(grade(1760000000000, models(undefined, true))).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INVALID',
    });
    const m = await metrics();
    expect(m.regrades[0]).toMatchObject({
      status: 'rejected_output',
      summary: { complete: true },
      ledgers: [{ outcome: 'rejected_output' }],
    });
    expect(await json('assessment.json')).toEqual(assessment);
    expect((await json('review-1760000000000.json')).usage).toEqual({
      inputTokens: 100,
      outputTokens: 10,
    });
  });
  it('distinguishes absent v2 roles from historical roles and does not rescan review files on repeat', async () => {
    const v2 = buildMetrics([], []);
    await artifacts.json('metrics.json', v2);
    expect(
      (await upgradeLegacyMetrics(directory, snapshot, assessment)).summary.byRole.voice,
    ).toMatchObject({ complete: true, requests: { total: 0 } });
    await artifacts.json('metrics.json', { ...v2, usageSchemaVersion: undefined });
    const historical = await upgradeLegacyMetrics(directory, snapshot, assessment);
    expect(historical.summary.byRole.voice).toMatchObject({
      complete: false,
      requests: { total: null },
    });
    await artifacts.json('review-1750000000000.json', {
      usage: { inputTokens: 500, outputTokens: 50 },
    });
    expect(await upgradeLegacyMetrics(directory, snapshot, assessment)).toEqual(historical);
  });
  it('recovers a persisted detailed review without repricing if metrics was lost', async () => {
    await grade();
    const first = await metrics();
    await artifacts.text('metrics.json', 'null');
    const restored = await upgradeLegacyMetrics(directory, snapshot, assessment);
    expect(restored.regrades).toEqual(first.regrades);
  });
});

for (const raw of ['{ malformed assessment', JSON.stringify({ ...assessment, scripted: 'true' })])
  it('treats unreadable/nonboolean assessment scripted state as historical unknown', async () => {
    await artifacts.text('assessment.json', raw);
    await grade();
    originalUnknown(await metrics());
    expect(
      await readFile(resolve(directory, 'assessment-before-review-1760000000000.json'), 'utf8'),
    ).toBe(raw);
  });

it('records SDK schema parsing failures as rejected output with provider usage intact', async () => {
  await expect(grade(1760000000000, models(undefined, 'malformed'))).rejects.toThrow();
  const m = await metrics();
  expect(m.regrades[0]).toMatchObject({
    status: 'rejected_output',
    ledgers: [{ outcome: 'rejected_output' }],
    requests: [{ usageSource: 'provider', status: 'completed' }],
  });
  expect(await json('assessment.json')).toEqual(assessment);
});

it('refreshes historical usage without masking a reviewer failure when the assessment is malformed', async () => {
  const raw = '{ malformed assessment';
  await artifacts.text('assessment.json', raw);
  const failure = new Error('private provider failure');
  await expect(grade(1760000000000, models(failure))).rejects.toBe(failure);
  const report = await readFile(resolve(directory, 'report.md'), 'utf8');
  expect(report).toContain('Overall assessment: **unknown**');
  expect(report).toContain('Regrade 2025-10-09T08:53:20.000Z');
  expect(report).not.toContain('private provider');
  expect(await readFile(resolve(directory, 'assessment.json'), 'utf8')).toBe(raw);
});
