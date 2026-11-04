import { Fragment, useState } from 'react';
import { RefLink } from '../../components/RefLink';
import { humanize } from '../../lib/format';
import type { BeliefRow, BeliefStatus, Decision, RunDetail } from '../../types';

const STATUS_LABEL: Record<BeliefStatus, string> = {
  match: 'Correct',
  mismatch: 'Wrong',
  assumed: 'Assumed',
  missing: 'Missing',
  review: 'Check',
};

const STATUS_GLYPH: Record<BeliefStatus, string> = {
  match: '✓',
  mismatch: '✕',
  assumed: '!',
  missing: '–',
  review: '?',
};

/** Which scenario facts the athlete disclosed, at which message, and what used them. */
export function FactMatrix({
  run,
  onSelectRef,
}: {
  run: RunDetail;
  onSelectRef: (ref: string) => void;
}) {
  const stats = run.conversation;
  const facts = stats?.factsAvailable.length ? stats.factsAvailable : Object.keys(run.facts);
  const required = new Set(stats?.requiredFacts ?? []);
  const columns = run.disclosures;
  if (facts.length === 0 || columns.length === 0)
    return <p className="muted">No disclosure record for this run.</p>;
  const beliefsByFact = new Map<string, BeliefRow[]>();
  for (const belief of run.beliefs)
    beliefsByFact.set(belief.factId, [...(beliefsByFact.get(belief.factId) ?? []), belief]);

  return (
    <div className="table-wrap">
      <table className="fact-matrix">
        <thead>
          <tr>
            <th>Fact</th>
            {columns.map((column) => (
              <th
                key={column.sequence}
                className="center"
                title={
                  column.kind === 'answer'
                    ? undefined
                    : column.kind === 'nudge'
                      ? 'Athlete asked the coach to go ahead'
                      : 'Athlete could not answer'
                }
              >
                <RefLink refId={`message:${column.sequence}`} onSelect={onSelectRef}>
                  {`m${column.sequence}`}
                </RefLink>
                {column.kind !== 'answer' && (
                  <span className={`column-kind kind-${column.kind}`}>
                    {column.kind === 'nudge' ? 'nudge' : '?'}
                  </span>
                )}
              </th>
            ))}
            <th>Recorded as</th>
          </tr>
        </thead>
        <tbody>
          {facts.map((fact) => {
            const first = columns.find((column) => column.factIds.includes(fact));
            const beliefs = beliefsByFact.get(fact) ?? [];
            return (
              <tr key={fact} className={first ? undefined : 'undisclosed'}>
                <th title={run.facts[fact]}>
                  <span>{humanize(fact)}</span>
                  {required.has(fact) && <span className="required">required</span>}
                </th>
                {columns.map((column) => {
                  const hit = column.factIds.includes(fact);
                  const repeat = hit && first !== column;
                  return (
                    <td key={column.sequence} className="center">
                      {hit && (
                        <i
                          className={`disclosed${repeat ? ' repeat' : ''}`}
                          title={repeat ? 'Disclosed again' : 'Disclosed'}
                        />
                      )}
                    </td>
                  );
                })}
                <td>
                  {beliefs.length === 0 ? (
                    <span className="muted small">
                      {first ? 'not tracked' : required.has(fact) ? 'never disclosed' : '—'}
                    </span>
                  ) : (
                    <span className="belief-chips">
                      {beliefs.map((belief) => (
                        <span
                          key={belief.field}
                          className={`belief-chip belief-${belief.status}`}
                          title={`${belief.label}: ${STATUS_LABEL[belief.status]}`}
                        >
                          {STATUS_GLYPH[belief.status]} {belief.label}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the athlete said versus what the coach saved, and whether it waited to be told. */
export function BeliefLedger({
  run,
  onSelectRef,
}: {
  run: RunDetail;
  onSelectRef: (ref: string) => void;
}) {
  if (run.beliefs.length === 0) return <p className="muted">No saved brief to compare.</p>;
  return (
    <div className="table-wrap">
      <table className="belief-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Athlete said</th>
            <th>Coach recorded</th>
            <th>Told</th>
            <th>Recorded</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {run.beliefs.map((belief) => (
            <tr key={belief.field} id={`belief-${belief.field}`}>
              <th>{belief.label}</th>
              <td className={belief.expected === null ? 'muted' : undefined}>
                {belief.expected ??
                  (belief.note ? <span className="quote">“{belief.note}”</span> : 'free text')}
              </td>
              <td className="recorded">
                {belief.recorded ?? <span className="muted">not recorded</span>}
              </td>
              <td>
                {belief.disclosedAt === null ? (
                  <span className="muted">never</span>
                ) : (
                  <RefLink refId={`message:${belief.disclosedAt}`} onSelect={onSelectRef} />
                )}
              </td>
              <td>
                {belief.recordedInTurn === null ? (
                  <span className="muted">—</span>
                ) : (
                  <RefLink refId={`turn:${belief.recordedInTurn}`} onSelect={onSelectRef} />
                )}
              </td>
              <td>
                <span className={`belief-chip belief-${belief.status}`}>
                  {STATUS_GLYPH[belief.status]} {STATUS_LABEL[belief.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="footnote">
        <strong>Assumed</strong> means the value was saved in a turn before the athlete stated it.
        It may still be right. <strong>Check</strong> marks free text with nothing to compare
        automatically.
      </p>
    </div>
  );
}

/** Every write the coach made, grouped by turn, with field-level brief diffs. */
export function DecisionLog({
  run,
  onSelectRef,
}: {
  run: RunDetail;
  onSelectRef: (ref: string) => void;
}) {
  const turns = [...new Set(run.decisions.map((decision) => decision.turnIndex))];
  if (turns.length === 0) return <p className="muted">The coach made no tool calls.</p>;
  return (
    <ol className="decision-log">
      {turns.map((turnIndex) => {
        const own = run.decisions.filter((decision) => decision.turnIndex === turnIndex);
        const writes = own.filter((decision) => !/^(read|preview|check)_/.test(decision.tool));
        const reads = own.filter((decision) => /^(read|preview|check)_/.test(decision.tool));
        const trigger = own[0]?.triggerSequence ?? null;
        return (
          <li key={turnIndex} className="decision-turn">
            <div className="decision-turn-head">
              <RefLink
                refId={`turn:${turnIndex}`}
                onSelect={onSelectRef}
              >{`Turn ${turnIndex}`}</RefLink>
              {trigger !== null && <span className="muted">after message {trigger}</span>}
            </div>
            {reads.length > 0 && (
              <div className="decision-reads">
                Looked up:{' '}
                {reads.map((decision) => decision.title.replace(/^Failed: /, '')).join(' · ')}
              </div>
            )}
            {writes.map((decision, index) => (
              <DecisionItem key={`${decision.at}-${index}`} decision={decision} />
            ))}
          </li>
        );
      })}
    </ol>
  );
}

function DecisionItem({ decision }: { decision: Decision }) {
  const [showContext, setShowContext] = useState(false);
  const context = decision.changes.find((change) => change.field === 'Context');
  const fields = decision.changes.filter((change) => change.field !== 'Context');
  return (
    <div
      className={`decision decision-${decision.tool}${decision.status === 'failed' ? ' failed' : ''}`}
    >
      <div className="decision-title">
        <i className="decision-dot" />
        <strong>{decision.title}</strong>
      </div>
      {decision.details.length > 0 && (
        <ul className="decision-details">
          {decision.details.map((detail, index) => (
            <li
              key={index}
              className={
                /^error:/.test(detail) ? 'error' : /^warning:/.test(detail) ? 'warning' : undefined
              }
            >
              {detail}
            </li>
          ))}
        </ul>
      )}
      {fields.length > 0 && (
        <ul className="change-list">
          {fields.map((change) => (
            <Fragment key={change.field}>
              <li>
                <span>{change.field}</span>
                <span className="before">{change.before ?? '—'}</span>
                <span className="arrow">→</span>
                <span className="after">{change.after ?? '—'}</span>
              </li>
            </Fragment>
          ))}
        </ul>
      )}
      {context && (
        <div className="context-change">
          <button
            type="button"
            className="text-button"
            onClick={() => setShowContext(!showContext)}
          >
            {showContext ? 'Hide' : 'Show'} brief context {context.before ? 'rewrite' : ''}
          </button>
          {showContext && (
            <div className="context-diff">
              {context.before && <p className="before">{context.before}</p>}
              <p className="after">{context.after}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
