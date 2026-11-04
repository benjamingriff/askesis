import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ResultBadge } from '../../components/Badges';
import { JsonView } from '../../components/JsonView';
import { formatDuration, formatTokens, humanize } from '../../lib/format';
import { saveHighlights } from '../../lib/data';
import type { CoachTurn, Decision, Disclosure, Highlight, RunDetail } from '../../types';

// Labels for phrases in coach replies; your judgement of tone, not a model's.
const HIGHLIGHT_TAGS = [
  'great question',
  'warm',
  'clear explanation',
  'too long',
  'sycophantic',
  'jargon',
  'unclear',
  'robotic',
  'pushy',
];

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
  const [highlights, setHighlights] = useState<Highlight[]>(run.highlights);
  const [pending, setPending] = useState<{ sequence: number; quote: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const persist = (next: Highlight[]) => {
    setHighlights(next);
    setSaveFailed(false);
    if (!run.demo) {
      setSaving(true);
      saveHighlights(run.id, next)
        .then(setHighlights)
        .catch(() => setSaveFailed(true))
        .finally(() => setSaving(false));
    }
  };
  const capture = (sequence: number, element: HTMLElement) => {
    const selection = window.getSelection();
    const quote = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!quote || !selection?.anchorNode || !element.contains(selection.anchorNode)) return;
    setPending({ sequence, quote: quote.slice(0, 600) });
  };
  const unreplied = run.turns.filter((entry) => entry.replySequence === null);

  if (run.messages.length === 0) return <p className="muted">No conversation recorded.</p>;

  return (
    <div className="transcript-layout">
      <ol className="transcript">
        {saveFailed && (
          <li className="error-text small">
            Saving highlights failed. Check the dev server.{' '}
            <button type="button" disabled={saving} onClick={() => persist(highlights)}>
              Retry
            </button>
          </li>
        )}
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
                  {disclosure?.voice && <VoiceChip voice={disclosure.voice} />}
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
              {coachTurn && coachTurn.steps.length > 0 && <TurnSteps turn={coachTurn} />}
              <div
                className="message-body"
                onMouseUp={
                  message.role === 'assistant'
                    ? (event) => capture(message.sequence, event.currentTarget)
                    : undefined
                }
              >
                <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
              </div>
              {pending?.sequence === message.sequence && (
                <div className="highlight-bar" onClick={(event) => event.stopPropagation()}>
                  <q>{pending.quote}</q>
                  {HIGHLIGHT_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      disabled={saving}
                      className="chip-button"
                      onClick={() => {
                        persist([
                          ...highlights,
                          { ...pending, tag, createdAt: new Date().toISOString() },
                        ]);
                        setPending(null);
                        window.getSelection()?.removeAllRanges();
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                  <button type="button" className="muted" onClick={() => setPending(null)}>
                    Cancel
                  </button>
                </div>
              )}
              {highlights.some((highlight) => highlight.sequence === message.sequence) && (
                <ul className="highlights" onClick={(event) => event.stopPropagation()}>
                  {highlights
                    .filter((highlight) => highlight.sequence === message.sequence)
                    .map((highlight) => (
                      <li key={`${highlight.createdAt}-${highlight.quote}`}>
                        <span className="fact-chip muted">{highlight.tag}</span>
                        <q>{highlight.quote}</q>
                        <button
                          type="button"
                          disabled={saving}
                          aria-label={`Remove ${highlight.tag} highlight`}
                          onClick={() => persist(highlights.filter((item) => item !== highlight))}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {disclosure?.voice?.status === 'voiced' && disclosure.voice.authored && (
                <details className="authored-facts">
                  <summary>Facts this message had to convey</summary>
                  <p>{disclosure.voice.authored}</p>
                </details>
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
            {entry.steps.length > 0 && <TurnSteps turn={entry} />}
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

const VOICE_STATUS: Record<NonNullable<Disclosure['voice']>['status'], string> = {
  voiced: 'voiced',
  fallback: 'authored text (voice rejected)',
  skipped: 'authored text (scripted)',
};

function VoiceChip({ voice }: { voice: NonNullable<Disclosure['voice']> }) {
  return (
    <span
      className={`fact-chip ${voice.status === 'fallback' ? 'warn' : 'muted'}`}
      title={`${voice.attempts} voice attempt${voice.attempts === 1 ? '' : 's'}`}
    >
      {voice.id} · {VOICE_STATUS[voice.status]}
    </span>
  );
}

/** What the coach wrote and called before its reply, in the order it happened. */
function TurnSteps({ turn }: { turn: CoachTurn }) {
  const tools = new Map(turn.tools.map((tool) => [tool.operationId, tool]));
  return (
    <ol className="turn-steps" onClick={(event) => event.stopPropagation()}>
      {!turn.stepsOrdered && (
        <li className="small muted">
          This run predates saved text times, so text is shown before its tool calls.
        </li>
      )}
      {turn.steps.map((step, index) => {
        if (step.kind === 'text')
          return (
            <li key={`text-${index}`} className="turn-step-text">
              <Markdown remarkPlugins={[remarkGfm]}>{step.content}</Markdown>
            </li>
          );
        const tool = tools.get(step.operationId);
        if (!tool) return null;
        return (
          <li key={step.operationId}>
            <details className={`tool-card${tool.status === 'failed' ? ' failed' : ''}`}>
              <summary>
                <code className={`tool-${tool.kind}`}>{tool.name}</code>
                <span className="tool-card-summary">{tool.summary}</span>
                <span className="muted mono small">
                  {tool.elapsedMs !== null ? `${Math.round(tool.elapsedMs)} ms` : tool.status}
                </span>
              </summary>
              <JsonView label="Input" value={tool.input} />
              <JsonView label="Result" value={tool.result} />
            </details>
          </li>
        );
      })}
    </ol>
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
