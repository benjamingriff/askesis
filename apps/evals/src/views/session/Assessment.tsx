import { ResultBadge } from '../../components/Badges';
import { RefLink } from '../../components/RefLink';
import { humanize } from '../../lib/format';
import type { RunDetail } from '../../types';

export function Assessment({
  run,
  onSelectRef,
}: {
  run: RunDetail;
  onSelectRef: (ref: string) => void;
}) {
  const failedChecks = run.checkDetails.filter((check) => check.status !== 'pass');
  return (
    <>
      {run.reviewSummary ? (
        <p className="review-summary">{run.reviewSummary}</p>
      ) : (
        <p className="muted">No reviewer assessment was recorded.</p>
      )}
      <div className="criteria-grid">
        {run.judgments.map((judgment) => (
          <article
            key={judgment.criterion}
            className={`criterion-card result-border-${judgment.result}`}
          >
            <header>
              <h3>{humanize(judgment.criterion)}</h3>
              <ResultBadge result={judgment.result} />
            </header>
            <p>{judgment.explanation}</p>
            {judgment.evidence.length > 0 && (
              <div className="evidence">
                {judgment.evidence.map((reference) => (
                  <RefLink key={reference} refId={reference} onSelect={onSelectRef} />
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      <h3 className="subhead">
        Exact checks{' '}
        <span className="muted">
          {run.checkDetails.length - failedChecks.length}/{run.checkDetails.length} passed
        </span>
      </h3>
      <ul className="check-list">
        {[...failedChecks, ...run.checkDetails.filter((check) => check.status === 'pass')].map(
          (check) => (
            <li key={check.id}>
              <ResultBadge result={check.status} />
              <strong>{humanize(check.id)}</strong>
              <span className="muted">{check.explanation}</span>
            </li>
          ),
        )}
      </ul>
    </>
  );
}
