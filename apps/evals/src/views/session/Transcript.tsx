import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ResultBadge } from '../../components/Badges';
import { JsonView } from '../../components/JsonView';
import { formatDuration, formatTokens, humanize } from '../../lib/format';
import type { CoachTurn, Decision, RunDetail } from '../../types';

/** Criteria whose evidence cites each reference, e.g. "message:12" → ["progression"]. */
export function citationsByRef(
  run: RunDetail,
): Map<string, { criterion: string; result: string }[]> {
  const map = new Map<string, { criterion: string; result: string }[]>();
  for (const judgment of run.judgments) {
    for (const reference of judgment.evidence) {
      map.set(reference, [
        ...(map.get(reference) ?? []),
        { criterion: judgment.criterion, result: judgment.result },
      ]);
    }
  }
  return map;
}

export function Transcript({
  run,
  selectedTurn,
  onSelectTurn,
}: {
  run: RunDetail;
  selectedTurn: number | null;
  onSelectTurn: (turn: number) => void;
}) {
  const citations = citationsByRef(run);
  const turnByReply = new Map(
    run.turns
      .filter((turn) => turn.replySequence !== null)
      .map((turn) => [turn.replySequence, turn]),
  );
  const disclosures = new Map(run.disclosures.map((entry) => [entry.sequence, entry]));
  const turn = run.turns.find((entry) => entry.index === selectedTurn) ?? null;
  const unreplied = run.turns.filter((entry) => entry.replySequence === null);

  if (run.messages.length === 0) return <p className="muted">No conversation recorded.</p>;

  return (
    <div className="transcript-layout">
      <ol className="transcript">
        {run.messages.map((message) => {
          const coachTurn =
            message.role === 'assistant' ? turnByReply.get(message.sequence) : undefined;
          const disclosure = disclosures.get(message.sequence);
          const cited = citations.get(`message:${message.sequence}`) ?? [];
          const selected = coachTurn !== undefined && coachTurn.index === selectedTurn;
          return (
            <li
              key={message.sequence}
              id={`msg-${message.sequence}`}
              className={`message message-${message.role}${selected ? ' selected' : ''}`}
              onClick={coachTurn ? () => onSelectTurn(coachTurn.index) : undefined}
            >
              {coachTurn && <span id={`turn-${coachTurn.index}`} className="anchor" />}
              <div className="message-meta">
                <span className="message-who">
                  {message.role === 'user'
                    ? 'Athlete'
                    : message.role === 'assistant'
                      ? 'Coach'
                      : message.role}
                  {coachTurn && <span className="muted"> · turn {coachTurn.index}</span>}
                </span>
                <span className="message-tags">
                  {disclosure?.factIds.map((fact) => (
                    <span key={fact} className="fact-chip">
                      {humanize(fact)}
                    </span>
                  ))}
                  {disclosure?.kind === 'nudge' && (
                    <span className="fact-chip warn">asked to go ahead</span>
                  )}
                  {disclosure?.kind === 'unknown' && (
                    <span className="fact-chip muted">couldn&apos;t answer</span>
                  )}
                  {message.sequence === 1 && message.role === 'user' && (
                    <span className="fact-chip muted">opening</span>
                  )}
                  <span className="mono muted">message:{message.sequence}</span>
                </span>
              </div>
              {coachTurn && (
                <div className="turn-metrics">
                  <span>{formatDuration(coachTurn.durationMs)}</span>
                  <span>
                    {formatTokens(coachTurn.inputTokens)} in ·{' '}
                    {formatTokens(coachTurn.outputTokens)} out
                  </span>
                  <span>
                    {coachTurn.questions} question{coachTurn.questions === 1 ? '' : 's'}
                  </span>
                  {coachTurn.tools.length > 0 && (
                    <span>
                      {coachTurn.tools.length} tool{coachTurn.tools.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              )}
              <div className="message-body">
                <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
              </div>
              {coachTurn && coachTurn.tools.length > 0 && (
                <div className="tool-chips">
                  {coachTurn.tools.map((tool) => (
                    <span
                      key={tool.operationId}
                      className={`tool-chip tool-${tool.kind}${tool.status === 'failed' ? ' failed' : ''}`}
                      title={tool.summary}
                    >
                      {tool.name}
                    </span>
                  ))}
                </div>
              )}
              {cited.length > 0 && (
                <div className="citations">
                  <span className="muted">Cited by reviewer:</span>
                  {cited.map((citation) => (
                    <span key={citation.criterion} className={`citation result-${citation.result}`}>
                      {humanize(citation.criterion)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {unreplied.map((entry) => (
          <li
            key={entry.runId}
            id={`turn-${entry.index}`}
            className={`message message-assistant missing${entry.index === selectedTurn ? ' selected' : ''}`}
            onClick={() => onSelectTurn(entry.index)}
          >
            <div className="message-meta">
              <span className="message-who">Coach · turn {entry.index}</span>
              <span className="muted">{entry.status}</span>
            </div>
            <div className="message-body muted">
              No reply was saved for this turn{entry.failureCode ? ` (${entry.failureCode})` : ''}.
            </div>
          </li>
        ))}
      </ol>
      <aside className="inspector">
        {turn ? (
          <TurnInspector
            turn={turn}
            decisions={run.decisions.filter((decision) => decision.turnIndex === turn.index)}
          />
        ) : (
          <p className="muted">Select a coach message to inspect its turn.</p>
        )}
      </aside>
    </div>
  );
}

function TurnInspector({ turn, decisions }: { turn: CoachTurn; decisions: Decision[] }) {
  const model = turn.modelMs.reduce((sum, value) => sum + value, 0);
  const tools = turn.toolMs.reduce((sum, value) => sum + value, 0);
  const queue = turn.queueWaitMs ?? 0;
  const total = Math.max(1, queue + model + tools, turn.durationMs ?? 0);
  const other = Math.max(0, (turn.durationMs ?? 0) - model - tools);
  const changes = decisions.flatMap((decision) =>
    decision.changes.filter((change) => change.field !== 'Context'),
  );
  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <h3>Turn {turn.index}</h3>
        <ResultBadge result={turn.status === 'completed' ? 'pass' : 'fail'} />
      </div>
      <p className="muted small">
        Responding to message {turn.triggerSequence ?? '?'}
        {turn.replySequence !== null ? ` · replied in message ${turn.replySequence}` : ''}
      </p>
      <div className="time-split" aria-label="Where the turn's time went">
        {queue > 0 && (
          <span
            className="split-queue"
            style={{ flexGrow: queue }}
            title={`Queued ${formatDuration(queue)}`}
          />
        )}
        {turn.modelMs.map((ms, index) => (
          <span
            key={`m${index}`}
            className="split-model"
            style={{ flexGrow: ms }}
            title={`Model call ${index + 1}: ${formatDuration(ms)}`}
          />
        ))}
        {tools > 0 && (
          <span
            className="split-tool"
            style={{ flexGrow: tools }}
            title={`Tools ${Math.round(tools)} ms`}
          />
        )}
        {other > total * 0.02 && (
          <span
            className="split-other"
            style={{ flexGrow: other }}
            title={`Other ${formatDuration(other)}`}
          />
        )}
      </div>
      <dl className="inspector-stats">
        <dt>Duration</dt>
        <dd>{formatDuration(turn.durationMs)}</dd>
        <dt>Model calls</dt>
        <dd>
          {turn.modelMs.length} · {formatDuration(model)}
        </dd>
        <dt>First visible</dt>
        <dd>{formatDuration(turn.firstVisibleMs)}</dd>
        <dt>Tokens</dt>
        <dd>
          {formatTokens(turn.inputTokens)} in · {formatTokens(turn.outputTokens)} out
        </dd>
        <dt>Reply</dt>
        <dd>
          {turn.words} words · {turn.questions} question{turn.questions === 1 ? '' : 's'}
        </dd>
      </dl>
      {changes.length > 0 && (
        <>
          <h4>Brief changes</h4>
          <ul className="change-list compact">
            {changes.map((change, index) => (
              <li key={`${change.field}-${index}`}>
                <span>{change.field}</span>
                <span className="before">{change.before ?? '—'}</span>
                <span className="after">{change.after ?? '—'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Tool calls</h4>
      {turn.tools.length === 0 ? (
        <p className="muted small">No tools called.</p>
      ) : (
        <ol className="inspector-tools">
          {turn.tools.map((tool) => (
            <li key={tool.operationId}>
              <div className="inspector-tool-head">
                <code className={`tool-${tool.kind}`}>{tool.name}</code>
                <span className="muted">
                  {tool.elapsedMs !== null ? `${Math.round(tool.elapsedMs)} ms` : tool.status}
                </span>
              </div>
              <p>{tool.summary}</p>
              <JsonView label="Input" value={tool.input} />
              <JsonView label="Result" value={tool.result} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
