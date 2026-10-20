import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import { safeIdentifier } from '@askesis/agent/usage';
import { Artifacts, reportMarkdown } from './artifacts.js';
import { checkPlan, overallVerdict, CHECKS_VERSION } from './checks.js';
import {
  type EvaluationModels,
  evaluatorLedger,
  evaluatorFailureOutcome,
  ReviewValidationError,
  REVIEW_VERSION,
  providerFailure,
  type Disclosure,
} from './models.js';
import type { Scenario } from './scenario.js';
import { buildRunResult } from './progress.js';
import { EVALUATOR_PROMPTS, promptIdentity } from './prompts.js';
import { pricingSnapshot, sumCosts } from './pricing.js';
import {
  buildMetrics,
  coachRecords,
  ledgerRecord,
  attributeRequests,
  summarizeUsage,
  legacyPair,
  type RegradeUsage,
  type UsageMetrics,
} from './usage-report.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
type Metrics = UsageMetrics & Record<string, unknown>;
/** Upgrades once; v2 inventories and every stored cost decision are preserved verbatim. */
export async function upgradeLegacyMetrics(
  directory: string,
  snapshot: BenchmarkSnapshot,
  assessment: { scripted?: unknown },
): Promise<Metrics> {
  const artifacts = new Artifacts(directory);
  let raw: string | undefined;
  let old: Record<string, unknown> = {};
  let historicalBasis: 'absent' | 'unreadable' | 'legacy' = 'absent';
  try {
    raw = await readFile(resolve(directory, 'metrics.json'), 'utf8');
  } catch (error) {
    if (!(object(error) && error.code === 'ENOENT')) throw error;
  }
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (object(parsed)) {
        old = parsed;
        historicalBasis = 'legacy';
      } else historicalBasis = 'unreadable';
    } catch {
      historicalBasis = 'unreadable';
    }
    if (old.usageSchemaVersion === 2 && Array.isArray(old.ledgers) && Array.isArray(old.requests))
      return old as Metrics;
    // Preserve the source byte for byte before replacing it, including malformed JSON.
    await artifacts.text('metrics-before-usage-v2.json', raw);
  }
  const scripted = assessment.scripted === true;
  const coach = coachRecords(
    snapshot.runs,
    scripted,
    true,
    Array.isArray(old.coachUsage) ? old.coachUsage : [],
  );
  const ledgers = coach.ledgers;
  for (const role of ['simulator', 'voice', 'reviewer'] as const) {
    const entries = Array.isArray(old.evaluationUsage)
      ? old.evaluationUsage.filter((v) => object(v) && v.role === role)
      : [];
    const pairs = entries.flatMap((v) =>
      object(v) && legacyPair(v.usage) ? [legacyPair(v.usage)!] : [],
    );
    ledgers.push(
      ledgerRecord(
        {
          ledgerId: `historical:${role}`,
          role,
          phase: 'run',
          coverage: scripted ? 'scripted' : 'historical',
          legacy: pairs.length
            ? {
                inputTokens: pairs.reduce((s, p) => s + p.inputTokens, 0),
                outputTokens: pairs.reduce((s, p) => s + p.outputTokens, 0),
              }
            : null,
          legacyEntries: entries.length,
        },
        null,
        scripted,
      ),
    );
  }
  const regrades: RegradeUsage[] = [];
  const reviews = (await readdir(directory))
    .filter((f) => /^review-\d+\.json$/.test(f))
    .sort((a, b) => Number(a.slice(7, -5)) - Number(b.slice(7, -5)));
  for (const file of reviews) {
    let review: Record<string, unknown> = {};
    try {
      const value = await json(resolve(directory, file));
      if (object(value)) review = value;
    } catch {
      /* Missing detail is historical, never zero. */
    }
    const detail = review.usageDetail;
    if (
      object(detail) &&
      Array.isArray(detail.ledgers) &&
      Array.isArray(detail.requests) &&
      object(detail.summary) &&
      object(detail.costEstimate)
    ) {
      regrades.push(detail as RegradeUsage);
      continue;
    }
    const stamp = file.slice(7, -5);
    const legacy = legacyPair(review.usage);
    const records = [
      ledgerRecord(
        {
          ledgerId: `historical:regrade:${stamp}:reviewer`,
          role: 'reviewer',
          phase: 'regrade',
          coverage: 'historical',
          legacy,
          legacyEntries: legacy ? 1 : 0,
        },
        null,
      ),
    ];
    regrades.push({
      regradedAt: new Date(Number(stamp)).toISOString(),
      status: 'historical',
      reviewerModel: safeIdentifier(review.model),
      pricing: null,
      ledgers: records,
      requests: [],
      summary: summarizeUsage(records, []),
      costEstimate: sumCosts(records, []),
      reviewFile: file,
    });
  }
  const metrics = {
    ...old,
    ...buildMetrics(ledgers, coach.requests, regrades),
    historical: true,
    historicalBasis,
  };
  await artifacts.json('metrics.json', metrics);
  return metrics;
}

/** The real grade operation, separated from CLI startup for offline artifact tests. */
export async function regradeDirectory(
  directory: string,
  options: { models: EvaluationModels; now?: () => number; signal?: AbortSignal },
) {
  const signal = options.signal ?? new AbortController().signal;
  const snapshot = (await json(resolve(directory, 'snapshot.json'))) as BenchmarkSnapshot;
  const disclosures = (await json(resolve(directory, 'disclosures.json'))) as Disclosure[];
  const assessmentRaw = await readFile(resolve(directory, 'assessment.json'), 'utf8');
  let assessmentSource: unknown;
  try {
    assessmentSource = JSON.parse(assessmentRaw);
  } catch {
    assessmentSource = null;
  }
  const originalAssessment = object(assessmentSource) ? assessmentSource : {};
  const assessment = {
    stopReason:
      typeof originalAssessment.stopReason === 'string' ? originalAssessment.stopReason : 'unknown',
    scripted: originalAssessment.scripted === true,
  };
  const scenario = (await json(resolve(directory, 'scenario.json'))) as Scenario;
  if (scenario.edition !== 'v1')
    throw new Error(
      'This run used the retired running-poc scenario format and cannot be regraded.',
    );
  const metrics = await upgradeLegacyMetrics(directory, snapshot, assessment);
  const timestamp = (options.now ?? Date.now)();
  const regradedAt = new Date(timestamp).toISOString();
  const reviewFile = `review-${timestamp}.json`;
  const ledger = evaluatorLedger(options.models.model, 'reviewer');
  const record = ledgerRecord(
    { ledgerId: `regrade:${regradedAt}:reviewer`, role: 'reviewer', phase: 'regrade', regradedAt },
    ledger.toJSON(),
  );
  let result: Awaited<ReturnType<EvaluationModels['review']>> | undefined;
  let failure: unknown;
  let failed = false;
  try {
    signal.throwIfAborted();
    result = await options.models.review(snapshot, disclosures, signal, ledger);
    signal.throwIfAborted();
    record.outcome = 'succeeded';
  } catch (error) {
    failed = true;
    failure = error;
    record.outcome = evaluatorFailureOutcome(error, signal, ledger);
  }
  const recorded = ledger.toJSON();
  record.recordedRequests = recorded.requests.length;
  record.omittedRequests = recorded.omittedRequests;
  const requests = attributeRequests(record, recorded);
  const detail: RegradeUsage = {
    regradedAt,
    status: failed
      ? record.outcome === 'rejected_output'
        ? 'rejected_output'
        : 'failed'
      : 'completed',
    reviewerModel: options.models.model,
    pricing: pricingSnapshot(),
    ledgers: [record],
    requests,
    summary: summarizeUsage([record], requests),
    costEstimate: sumCosts([record], requests),
    reviewFile,
  };
  const updated = {
    ...metrics,
    ...buildMetrics(metrics.ledgers, metrics.requests, [...metrics.regrades, detail]),
    historical: metrics.historical,
    pricing: metrics.pricing,
  };
  const artifacts = new Artifacts(directory);
  const legacyUsage =
    result?.usage ?? (failure instanceof ReviewValidationError ? failure.usage : undefined);
  await artifacts.json(reviewFile, {
    ...(result ?? {}),
    ...(legacyUsage ? { usage: legacyUsage } : {}),
    ...(failed ? { diagnostic: providerFailure(failure) } : {}),
    model: options.models.model,
    reviewerVersion: REVIEW_VERSION,
    reviewerPromptHash: promptIdentity(EVALUATOR_PROMPTS.reviewer).hash,
    usageDetail: detail,
  });
  await artifacts.json('metrics.json', updated);
  if (failed) throw failure;
  const checks = checkPlan(
    snapshot,
    scenario,
    disclosures.flatMap((item) => item.factIds),
  );
  const verdict = overallVerdict(checks, result!.review, assessment.stopReason);
  await artifacts.text(`assessment-before-review-${timestamp}.json`, assessmentRaw);
  await artifacts.json('assessment.json', {
    verdict,
    stopReason: assessment.stopReason,
    review: result!.review,
    checks,
    scripted: assessment.scripted,
    checksVersion: CHECKS_VERSION,
    regradedAt,
    reviewerModel: options.models.model,
    reviewerVersion: REVIEW_VERSION,
    reviewerPromptHash: promptIdentity(EVALUATOR_PROMPTS.reviewer).hash,
  });
  const summary = buildRunResult(
    scenario,
    snapshot,
    { stopReason: assessment.stopReason, verdict, review: result!.review, checks },
    resolve(directory, 'report.md'),
  );
  summary.usage = {
    coachUsd: updated.costEstimate.coach.usd,
    evaluatorUsd: updated.costEstimate.evaluatorOverhead.usd,
    cacheHitRatio: updated.summary.combined.cacheHitRatio.value,
    complete: updated.summary.combined.complete,
  };
  await artifacts.json('result.json', summary);
  await artifacts.text(
    'report.md',
    reportMarkdown(
      basename(directory),
      verdict,
      assessment.stopReason,
      snapshot,
      checks,
      result!.review,
      assessment.scripted,
      updated,
    ),
  );
  return summary;
}
