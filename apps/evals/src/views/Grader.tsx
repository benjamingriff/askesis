import { useState } from 'react';
import { StackedBars, type StackRow } from '../charts/StackedBars';
import { ResultBadge, Tag } from '../components/Badges';
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatTokens,
  humanize,
} from '../lib/format';
import { modelName } from '../lib/models';
import {
  CRITERIA,
  type CalibrationAttempt,
  type CalibrationFixture,
  type CalibrationRun,
  type RunSummary,
} from '../types';
import { href } from '../lib/route';
import { Stat } from './Overview';

export function Grader({
  calibration,
  runs,
}: {
  calibration: CalibrationRun | null;
  runs: RunSummary[];
}) {
  if (!calibration) {
    return (
      <div className="chart-feed">
        <HumanAgreement runs={runs} />
        <div className="empty-state">
          <h2>No calibration suites yet</h2>
          <p>
            Run <code>pnpm bench calibrate</code> to grade the reviewer against labelled fixtures.
          </p>
        </div>
      </div>
    );
  }
  const c = calibration;
  const stable = c.stability.filter((item) => item.consistency === 'stable').length;
  const rows: StackRow[] = c.criterionResults.map((item) => {
    const other = Math.max(0, item.labeled - item.matched - item.missedDefects - item.falseAlarms);
    return {
      key: item.criterion,
      label: humanize(item.criterion),
      color: 'var(--accent)',
      segments: [
        {
          key: 'matched',
          label: 'Agreed with label',
          glyph: '✓',
          value: item.matched,
          className: 'seg-acceptable',
        },
        {
          key: 'missed',
          label: 'Missed defect',
          glyph: '✕',
          value: item.missedDefects,
          className: 'seg-incomplete',
        },
        {
          key: 'false',
          label: 'False alarm',
          glyph: '!',
          value: item.falseAlarms,
          className: 'seg-needs_revision',
        },
        {
          key: 'other',
          label: 'Other disagreement',
          glyph: '?',
          value: other,
          className: 'seg-assessment_unavailable',
        },
      ],
    };
  });
  const totalLatency = c.attempts.reduce((sum, attempt) => sum + (attempt.elapsedMs ?? 0), 0);
  const tokens = c.attempts.reduce(
    (sum, attempt) => sum + attempt.inputTokens + attempt.outputTokens,
    0,
  );

  return (
    <div className="chart-feed">
      <div className="detail-header">
        <div className="detail-title">
          <h1>
            {c.scripted
              ? 'Scripted stand-in reviewer'
              : `Reviewer · ${modelName(c.reviewerModel ?? 'unknown')}`}
          </h1>
          {c.demo && <Tag tone="accent">demo</Tag>}
          {c.scripted && <Tag tone="warn">scripted wiring check</Tag>}
        </div>
        <div className="detail-meta">
          <span>{c.reviewerVersion ?? 'unknown reviewer'}</span>
          <span>split: {c.split}</span>
          <span>×{c.repeat} repeats</span>
          {c.revision && (
            <span className="mono">
              {c.revision}
              {c.workingTreeDirty ? '*' : ''}
            </span>
          )}
          <span>{formatDateTime(c.startedAt)}</span>
          <span>labels: provisional</span>
        </div>
      </div>

      {c.scripted && (
        <div className="callout warn">
          <span>
            <strong>Scripted wiring check.</strong> A permissive stand-in passes every saved plan,
            so missed defects here prove the report catches them. It says nothing about a live
            model&apos;s grading quality.
          </span>
        </div>
      )}

      <div className="stat-strip">
        <Stat
          label="Criterion agreement"
          value={formatPercent(ratio(c.judgmentMatches, c.labeledJudgments))}
          sub={`${c.judgmentMatches} of ${c.labeledJudgments} labelled`}
        />
        <Stat
          label="Verdict agreement"
          value={formatPercent(ratio(c.verdictMatches, c.completed))}
          sub={`${c.verdictMatches} of ${c.completed}`}
        />
        <Stat label="Missed defects" value={String(c.missedDefects)} />
        <Stat label="False alarms" value={String(c.falseAlarms)} />
        <Stat label="Bad plans accepted" value={String(c.badPlansAccepted)} />
        <Stat
          label="Stable fixtures"
          value={`${stable}/${c.stability.length}`}
          sub={`${formatDuration(totalLatency)} · ${formatTokens(tokens)} tokens`}
        />
      </div>

      {c.errors > 0 && (
        <div className="callout warn">
          <span>
            {c.errors} attempt{c.errors === 1 ? '' : 's'} errored and are excluded from agreement
            denominators.
          </span>
        </div>
      )}

      <HumanAgreement runs={runs} />

      <section className="chart-section" id="agreement" aria-label="Agreement by criterion">
        <div className="chart-heading">
          <div>
            <h2>Agreement by criterion</h2>
            <p>
              Only explicitly labelled criteria count. A pass on an expected defect is a missed
              defect; flagging a good criterion is a false alarm.
            </p>
          </div>
        </div>
        <StackedBars rows={rows} unit="judgements" />
      </section>

      <section className="chart-section" id="fixtures" aria-label="Fixture matrix">
        <div className="chart-heading">
          <div>
            <h2>Fixture matrix</h2>
            <p>
              Each square is one repetition. Outlined cells carry a label; red outlines disagree
              with it.
            </p>
          </div>
        </div>
        <FixtureMatrix calibration={c} />
      </section>

      <section className="chart-section" id="judgements" aria-label="Judgements">
        <div className="chart-heading">
          <div>
            <h2>Judgements</h2>
            <p>Reviewer explanations per attempt. Labels are never sent to the reviewer.</p>
          </div>
        </div>
        <div className="attempts">
          {c.fixtures.map((fixture) => (
            <FixtureAttempts
              key={fixture.id}
              fixture={fixture}
              attempts={c.attempts.filter((attempt) => attempt.fixtureId === fixture.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function FixtureMatrix({ calibration }: { calibration: CalibrationRun }) {
  const columns = ['verdict', ...CRITERIA];
  return (
    <div className="table-wrap">
      <table className="fixture-matrix">
        <thead>
          <tr>
            <th>Fixture</th>
            {columns.map((column) => (
              <th key={column}>{humanize(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calibration.fixtures.map((fixture) => {
            const attempts = calibration.attempts.filter(
              (attempt) => attempt.fixtureId === fixture.id,
            );
            return (
              <tr key={fixture.id}>
                <th title={fixture.description}>
                  <span className="fixture-name">{fixture.id}</span>
                  <span className={`split split-${fixture.split}`}>{fixture.split}</span>
                </th>
                <td>
                  <MatrixCell
                    expected={fixture.expectedVerdicts}
                    actual={attempts.map((attempt) => attempt.verdict ?? 'error')}
                    verdict
                  />
                </td>
                {CRITERIA.map((criterion) => (
                  <td key={criterion}>
                    <MatrixCell
                      expected={fixture.expectedCriteria[criterion] ?? []}
                      actual={attempts.map(
                        (attempt) =>
                          attempt.criteria.find((item) => item.criterion === criterion)?.result ??
                          'error',
                      )}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const VERDICT_TONE: Record<string, string> = {
  acceptable: 'pass',
  needs_revision: 'fail',
  incomplete: 'uncertain',
};

function MatrixCell({
  expected,
  actual,
  verdict = false,
}: {
  expected: string[];
  actual: string[];
  verdict?: boolean;
}) {
  const labelled = expected.length > 0;
  return (
    <div className={`matrix-cell${labelled ? ' labelled' : ''}`}>
      <span className="squares">
        {actual.map((value, index) => {
          const tone = verdict ? (VERDICT_TONE[value] ?? 'error') : value;
          const wrong = labelled && !expected.includes(value);
          return (
            <i
              key={index}
              className={`square square-${tone}${wrong ? ' wrong' : ''}`}
              title={`Attempt ${index + 1}: ${value}`}
            />
          );
        })}
      </span>
      {labelled && (
        <small>expect {expected.map((value) => value.replace('_', ' ')).join(' / ')}</small>
      )}
    </div>
  );
}

function FixtureAttempts({
  fixture,
  attempts,
}: {
  fixture: CalibrationFixture;
  attempts: CalibrationAttempt[];
}) {
  const [open, setOpen] = useState(false);
  const disagreements = attempts.reduce(
    (sum, attempt) =>
      sum +
      attempt.judgments.filter((judgment) => !judgment.matched).length +
      (attempt.verdictMatched === false ? 1 : 0),
    0,
  );
  return (
    <article className="attempt-group">
      <button className="attempt-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <strong>{fixture.id}</strong>
        <span className="muted">{fixture.description}</span>
        {disagreements > 0 ? (
          <Tag tone="warn">{`${disagreements} disagreements`}</Tag>
        ) : (
          <Tag>agrees</Tag>
        )}
      </button>
      {open && (
        <div className="attempt-body">
          {attempts.map((attempt) => (
            <div key={attempt.repetition} className="attempt">
              <div className="attempt-meta">
                <span>Attempt {attempt.repetition}</span>
                <span>verdict: {attempt.verdict ?? attempt.status}</span>
                {attempt.badPlanAccepted && <Tag tone="warn">bad plan accepted</Tag>}
              </div>
              {attempt.summary && <p>{attempt.summary}</p>}
              <ul className="check-list">
                {attempt.criteria.map((criterion) => {
                  const judgment = attempt.judgments.find(
                    (item) => item.criterion === criterion.criterion,
                  );
                  return (
                    <li key={criterion.criterion}>
                      <ResultBadge result={criterion.result} />
                      <strong>{humanize(criterion.criterion)}</strong>
                      <span className="muted">{criterion.explanation}</span>
                      {judgment && !judgment.matched && (
                        <Tag tone="warn">{`expected ${judgment.expected.join('/')}`}</Tag>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/** How often your reviews agree with the model reviewer on real benchmark runs. */
function HumanAgreement({ runs }: { runs: RunSummary[] }) {
  const reviewed = runs.filter((run) => run.review !== null && !run.demo);
  const withVerdict = reviewed.filter((run) => run.review?.verdict && run.verdict !== 'running');
  const verdictAgree = withVerdict.filter(
    (run) => (run.review?.verdict === 'fit') === (run.verdict === 'acceptable'),
  ).length;
  const rows = CRITERIA.map((criterion) => {
    const marks = reviewed
      .map((run) => run.review?.criteria[criterion])
      .filter((mark) => mark !== undefined);
    return {
      criterion,
      agree: marks.filter((mark) => mark === 'agree').length,
      disagree: marks.filter((mark) => mark === 'disagree').length,
    };
  });
  const disagreements = reviewed.filter(
    (run) =>
      Object.values(run.review?.criteria ?? {}).includes('disagree') ||
      (run.review?.verdict && (run.review.verdict === 'fit') !== (run.verdict === 'acceptable')),
  );
  return (
    <section className="chart-section" id="human" aria-label="Human vs model reviewer">
      <div className="chart-heading">
        <div>
          <h2>You vs the model reviewer</h2>
          <p>
            Your reviews from the Conversations page are the ground truth the reviewer should match
            on real runs. Fixtures below test it on planted defects.
          </p>
        </div>
      </div>
      {reviewed.length === 0 ? (
        <p className="muted">
          No human reviews yet. Open a conversation and use the review panel.{' '}
          <a className="text-link" href={href('conversations')}>
            Go to conversations
          </a>
        </p>
      ) : (
        <div className="human-agreement">
          <div className="stat-inline">
            <span>Runs reviewed</span>
            <strong>{reviewed.length}</strong>
          </div>
          <div className="stat-inline">
            <span>Verdict agreement</span>
            <strong>{formatPercent(ratio(verdictAgree, withVerdict.length))}</strong>
            <small>
              {verdictAgree} of {withVerdict.length}
            </small>
          </div>
          <ul className="agreement-bars">
            {rows.map((row) => (
              <li key={row.criterion}>
                <span>{humanize(row.criterion)}</span>
                <span className="stack-track small">
                  {row.agree > 0 && (
                    <span
                      className="stack-segment seg-acceptable"
                      style={{ flexGrow: row.agree }}
                    />
                  )}
                  {row.disagree > 0 && (
                    <span
                      className="stack-segment seg-incomplete"
                      style={{ flexGrow: row.disagree }}
                    />
                  )}
                  {row.agree + row.disagree === 0 && (
                    <span
                      className="stack-segment seg-assessment_unavailable"
                      style={{ flexGrow: 1 }}
                    />
                  )}
                </span>
                <span className="muted small">
                  {row.agree}✓ {row.disagree}✕
                </span>
              </li>
            ))}
          </ul>
          {disagreements.length > 0 && (
            <div className="disagreements">
              <h3>Disagreements to inspect</h3>
              {disagreements.map((run) => {
                const verdictClash =
                  run.review?.verdict &&
                  (run.review.verdict === 'fit') !== (run.verdict === 'acceptable');
                const criteria = Object.entries(run.review?.criteria ?? {})
                  .filter(([, mark]) => mark === 'disagree')
                  .map(([criterion]) => humanize(criterion).toLowerCase());
                return (
                  <a key={run.id} href={href('conversations', run.id)} className="text-link">
                    {formatDateTime(run.startedAt)} ·{' '}
                    {verdictClash
                      ? `model said ${run.verdict.replace('_', ' ')}, you said ${run.review?.verdict?.replace('_', ' ')}`
                      : `you disagree on ${criteria.join(', ')}`}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
