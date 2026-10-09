import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Artifacts } from './artifacts.js';
import {
  criteria,
  providerFailure,
  validateReview,
  type Disclosure,
  type ModelUsage,
  type Review,
  type ReviewEvidence,
} from './models.js';
import type { CalibrationFixture, FixtureLabels } from './fixtures.js';

type ResultName = Review['criteria'][number]['result'];
export type Judgment = {
  criterion: (typeof criteria)[number];
  expected: ResultName[];
  actual: ResultName;
  matched: boolean;
  missedDefect: boolean;
  falseAlarm: boolean;
};
export function scoreReview(labels: FixtureLabels, review: Review) {
  const judgments: Judgment[] = criteria.flatMap((criterion) => {
    const expected = labels.expectedCriteria[criterion];
    if (!expected) return [];
    const actual = review.criteria.find((item) => item.criterion === criterion)!.result;
    return [
      {
        criterion,
        expected,
        actual,
        matched: expected.includes(actual),
        missedDefect: !expected.includes('pass') && actual === 'pass',
        falseAlarm: expected.length === 1 && expected[0] === 'pass' && actual !== 'pass',
      },
    ];
  });
  return {
    verdictMatched: labels.expectedVerdicts.includes(review.verdict),
    badPlanAccepted:
      !labels.expectedVerdicts.includes('acceptable') && review.verdict === 'acceptable',
    judgments,
    matched: labels.expectedVerdicts.includes(review.verdict) && judgments.every((j) => j.matched),
  };
}
export type CalibrationAttempt = {
  fixtureId: string;
  repetition: number;
  elapsedMs: number;
} & (
  | {
      status: 'completed';
      review: Review;
      usage: ModelUsage;
      score: ReturnType<typeof scoreReview>;
    }
  | { status: 'error'; diagnostic: ReturnType<typeof providerFailure> }
);

export function summarizeCalibration(
  fixtures: CalibrationFixture[],
  repeat: number,
  attempts: CalibrationAttempt[],
) {
  const completed = attempts.filter(
    (a): a is Extract<CalibrationAttempt, { status: 'completed' }> => a.status === 'completed',
  );
  const judgments = completed.flatMap((a) => a.score.judgments);
  const stable = fixtures.map((fixture) => {
    const results = completed.filter((a) => a.fixtureId === fixture.id);
    const signatures = new Set(
      results.map((a) =>
        JSON.stringify([
          a.review.verdict,
          ...criteria.map((c) => a.review.criteria.find((i) => i.criterion === c)!.result),
        ]),
      ),
    );
    return {
      fixtureId: fixture.id,
      completed: results.length,
      requested: repeat,
      consistency:
        results.length < 2 ? 'not_measured' : signatures.size === 1 ? 'stable' : 'variable',
    };
  });
  return {
    requested: fixtures.length * repeat,
    attempted: attempts.length,
    completed: completed.length,
    errors: attempts.length - completed.length,
    pending: fixtures.length * repeat - attempts.length,
    fixtureMatches: completed.filter((a) => a.score.matched).length,
    verdictMatches: completed.filter((a) => a.score.verdictMatched).length,
    badPlansAccepted: completed.filter((a) => a.score.badPlanAccepted).length,
    labeledJudgments: judgments.length,
    judgmentMatches: judgments.filter((j) => j.matched).length,
    missedDefects: judgments.filter((j) => j.missedDefect).length,
    falseAlarms: judgments.filter((j) => j.falseAlarm).length,
    criterionResults: criteria.map((criterion) => {
      const rows = judgments.filter((j) => j.criterion === criterion);
      return {
        criterion,
        labeled: rows.length,
        matched: rows.filter((j) => j.matched).length,
        missedDefects: rows.filter((j) => j.missedDefect).length,
        falseAlarms: rows.filter((j) => j.falseAlarm).length,
      };
    }),
    stability: stable,
    inputTokens: completed.reduce((sum, a) => sum + a.usage.inputTokens, 0),
    outputTokens: completed.reduce((sum, a) => sum + a.usage.outputTokens, 0),
    measuredLatencyMs: completed.map((a) => a.elapsedMs),
    monetaryCost: null,
  };
}

type Reviewer = (
  evidence: ReviewEvidence,
  disclosures: Disclosure[],
  signal: AbortSignal,
) => Promise<{ review: Review; usage: ModelUsage }>;
export async function runCalibration(options: {
  directory: string;
  fixtures: CalibrationFixture[];
  repeat: number;
  scripted: boolean;
  signal: AbortSignal;
  reviewer: Reviewer;
  onProgress?: (text: string) => void;
}) {
  const { fixtures, repeat, directory, scripted, signal, reviewer } = options;
  const artifacts = new Artifacts(directory);
  await artifacts.init();
  const attempts: CalibrationAttempt[] = [];
  for (const fixture of fixtures) {
    const evidence = new Artifacts(resolve(directory, fixture.id));
    await evidence.init();
    await evidence.json('input.json', {
      evidence: fixture.evidence,
      disclosures: fixture.disclosures,
    });
    const { evidence: _evidence, disclosures: _disclosures, ...labels } = fixture;
    await evidence.json('expected.json', labels);
  }
  let operationalFailure = false;
  try {
    outer: for (const fixture of fixtures) {
      for (let repetition = 1; repetition <= repeat; repetition++) {
        if (signal.aborted) {
          operationalFailure = true;
          break outer;
        }
        const stage = `${fixture.id} — attempt ${repetition}/${repeat}`;
        options.onProgress?.(stage);
        await artifacts.json('state.json', {
          stage,
          scripted,
          completed: attempts.length,
          requested: fixtures.length * repeat,
        });
        await artifacts.event({ stage: 'grading', fixtureId: fixture.id, repetition });
        const started = performance.now();
        let attempt: CalibrationAttempt;
        try {
          // Labels, descriptions, IDs and split are intentionally absent from the model request.
          const result = await reviewer(
            structuredClone(fixture.evidence),
            structuredClone(fixture.disclosures),
            signal,
          );
          validateReview(result.review, fixture.evidence);
          attempt = {
            fixtureId: fixture.id,
            repetition,
            status: 'completed',
            elapsedMs: performance.now() - started,
            ...result,
            score: scoreReview(fixture, result.review),
          };
          options.onProgress?.(
            `${attempt.score.matched ? 'Matches labels' : 'Disagrees with labels'}: ${result.review.verdict}`,
          );
        } catch (error) {
          operationalFailure = true;
          attempt = {
            fixtureId: fixture.id,
            repetition,
            status: 'error',
            elapsedMs: performance.now() - started,
            diagnostic: providerFailure(error),
          };
          options.onProgress?.(
            `Grader failed: ${attempt.diagnostic.category} (${attempt.diagnostic.errorType}).`,
          );
        }
        attempts.push(attempt);
        await new Artifacts(resolve(directory, fixture.id)).json(
          `attempt-${repetition}.json`,
          attempt,
        );
        await artifacts.event({ stage: attempt.status, fixtureId: fixture.id, repetition });
        await saveCalibrationReport(directory, fixtures, repeat, attempts, scripted);
        // Do not spend more requests after a provider/configuration failure. Evidence remains usable.
        if (attempt.status === 'error') break outer;
      }
    }
  } finally {
    await saveCalibrationReport(directory, fixtures, repeat, attempts, scripted);
    await artifacts.json('state.json', {
      stage: signal.aborted ? 'interrupted' : operationalFailure ? 'failed' : 'completed',
      scripted,
      completed: attempts.filter((a) => a.status === 'completed').length,
      attempted: attempts.length,
      requested: fixtures.length * repeat,
    });
  }
  return {
    attempts,
    summary: summarizeCalibration(fixtures, repeat, attempts),
    operationalFailure: operationalFailure || signal.aborted,
  };
}

async function saveCalibrationReport(
  directory: string,
  fixtures: CalibrationFixture[],
  repeat: number,
  attempts: CalibrationAttempt[],
  scripted: boolean,
) {
  const artifacts = new Artifacts(directory);
  const summary = summarizeCalibration(fixtures, repeat, attempts);
  await artifacts.json('results.json', {
    scripted,
    labelStatus: 'provisional-engineering-labels',
    summary,
    attempts,
  });
  await writeFile(
    resolve(directory, 'report.md'),
    calibrationMarkdown(fixtures, attempts, summary, scripted),
    { mode: 0o600 },
  );
}

export function fixtureHash(fixture: CalibrationFixture) {
  return createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
}
const escape = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function calibrationMarkdown(
  fixtures: CalibrationFixture[],
  attempts: CalibrationAttempt[],
  summary: ReturnType<typeof summarizeCalibration>,
  scripted: boolean,
) {
  const lines = [
    '# Grader calibration',
    '',
    scripted
      ? '**SCRIPTED WIRING CHECK: no live model was evaluated. These disagreements are expected from the permissive stand-in.**'
      : '**Live grader comparison against provisional engineering labels; labels need owner/coach review.**',
    '',
    `Completed: ${summary.completed}/${summary.requested}. Errors: ${summary.errors}. Pending: ${summary.pending}.`,
    '',
    `Verdict agreement: ${summary.verdictMatches}/${summary.completed}. Entire fixture agreement: ${summary.fixtureMatches}/${summary.completed}.`,
    '',
    `Labeled criterion agreement: ${summary.judgmentMatches}/${summary.labeledJudgments}. Missed defects: ${summary.missedDefects}. False alarms: ${summary.falseAlarms}. Bad plans accepted: ${summary.badPlansAccepted}.`,
    '',
    'Only explicitly labelled criteria count in agreement metrics. Fail/uncertain flags on positive labels are false alarms; pass on defect labels is a missed defect. Fail versus uncertain disagreements remain visible. Errors and unattempted cases do not count as grading decisions. Consistency compares the verdict and all six criterion results, independent of explanation wording.',
    '',
    '## Attempts',
    '',
    '| Fixture | Attempt | Expected verdict | Actual verdict | Label agreement | Seconds |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const fixture of fixtures) {
    const rows = attempts.filter((a) => a.fixtureId === fixture.id);
    if (!rows.length)
      lines.push(
        `| [${fixture.id}](${fixture.id}/input.json) | — | ${fixture.expectedVerdicts.join(' / ')} | Not attempted | — | — |`,
      );
    for (const a of rows)
      lines.push(
        `| [${fixture.id}](${fixture.id}/attempt-${a.repetition}.json) | ${a.repetition} | ${fixture.expectedVerdicts.join(' / ')} | ${a.status === 'completed' ? a.review.verdict : 'Error'} | ${a.status === 'completed' ? (a.score.matched ? 'Match' : 'Disagreement') : 'Not scored'} | ${(a.elapsedMs / 1000).toFixed(1)} |`,
      );
  }
  lines.push(
    '',
    '## Criterion comparison',
    '',
    '| Criterion | Agreement | Missed defects | False alarms |',
    '| --- | --- | --- | --- |',
  );
  for (const row of summary.criterionResults)
    lines.push(
      `| ${row.criterion} | ${row.matched}/${row.labeled} | ${row.missedDefects} | ${row.falseAlarms} |`,
    );
  lines.push(
    '',
    '## Repeat consistency',
    '',
    ...summary.stability.map(
      (row) =>
        `- ${row.fixtureId}: ${row.consistency}; ${row.completed}/${row.requested} completed.`,
    ),
    '',
    '## Disagreements and errors',
    '',
  );
  for (const a of attempts) {
    if (a.status === 'error')
      lines.push(
        `- ${a.fixtureId}, attempt ${a.repetition}: ${a.diagnostic.category}; ${a.diagnostic.errorType}. See the saved attempt for safe diagnostics.`,
      );
    else if (!a.score.matched) {
      lines.push(`### ${a.fixtureId} — attempt ${a.repetition}`, '', escape(a.review.summary), '');
      if (!a.score.verdictMatched) lines.push(`- Verdict disagrees: ${a.review.verdict}.`);
      for (const j of a.score.judgments.filter((j) => !j.matched)) {
        const finding = a.review.criteria.find((i) => i.criterion === j.criterion)!;
        lines.push(
          `- ${j.criterion}: expected ${j.expected.join(' / ')}, received ${j.actual}. ${escape(finding.explanation)} (${finding.evidence.join(', ')})`,
        );
      }
      lines.push('');
    }
  }
  lines.push(
    '',
    '## Fixture labels',
    '',
    ...fixtures.map((f) => `- [${f.id}](${f.id}/expected.json) (${f.split}): ${f.description}`),
    '',
    '## Usage',
    '',
    `Recorded successful-call usage: ${summary.inputTokens} input tokens; ${summary.outputTokens} output tokens. Monetary cost is unknown; cache breakdown and failed-call usage are not recorded.`,
    '',
    '[Machine-readable results](results.json) · [Manifest](manifest.json) · [Progress](progress.jsonl)',
    '',
    'This suite tests the existing grader only. No coach, API, PostgreSQL or deterministic plan check participates. Fixture evidence and labels are persisted separately, and labels are withheld from the reviewer. Holdout cases should remain untouched while tuning against development cases.',
    '',
  );
  return lines.join('\n');
}
