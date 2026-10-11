import { RefLink } from '../../components/RefLink';
import { Tag, VerdictBadge } from '../../components/Badges';
import { promptKey } from '../../lib/cohorts';
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatTokens,
  humanize,
} from '../../lib/format';
import { modelName } from '../../lib/models';
import { href } from '../../lib/route';
import type { RunDetail, SessionFlag } from '../../types';
import { Stat } from '../Overview';

const SEVERITY_GLYPH: Record<SessionFlag['severity'], string> = {
  critical: '✕',
  warning: '!',
  info: 'i',
};

export function SessionHeader({ run, color }: { run: RunDetail; color: string | undefined }) {
  return (
    <div className="detail-header">
      <a className="back-link" href={href('conversations')}>
        ← All conversations
      </a>
      <div className="detail-title">
        <h1>{run.planTitle ?? humanize(run.scenarioId)}</h1>
        <VerdictBadge verdict={run.verdict} large />
        {run.review?.verdict && (
          <span className={`human-verdict human-${run.review.verdict}`}>
            You: {humanize(run.review.verdict)}
          </span>
        )}
      </div>
      <div className="detail-meta">
        <span>
          <i className="model-dot" style={{ background: color }} />
          {modelName(run.coachModel)} · {run.reasoning}
        </span>
        <span className="mono">{promptKey(run)}</span>
        <span>
          {run.scenarioId} v{run.scenarioVersion ?? '?'}
        </span>
        {run.revision && (
          <span className="mono">
            {run.revision}
            {run.workingTreeDirty ? '*' : ''}
          </span>
        )}
        <span>{formatDateTime(run.startedAt)}</span>
        {run.demo && <Tag tone="accent">demo</Tag>}
        {run.scripted && <Tag>scripted</Tag>}
        {run.stopReason && run.stopReason !== 'completed' && (
          <Tag tone="warn">{run.stopReason}</Tag>
        )}
      </div>
      <p className="run-id mono">{run.id}</p>
    </div>
  );
}

export function Scorecard({ run }: { run: RunDetail }) {
  const stats = run.conversation;
  const passed =
    run.checkDetails.filter((check) => check.status === 'pass').length +
    run.judgments.filter((judgment) => judgment.result === 'pass').length;
  const required = stats?.requiredFacts ?? [];
  const requiredFound = required.filter((fact) => stats?.factsDisclosed.includes(fact)).length;
  const optional = (stats?.factsDisclosed ?? []).filter((fact) => !required.includes(fact)).length;
  const optionalAvailable = (stats?.factsAvailable ?? []).filter(
    (fact) => !required.includes(fact),
  ).length;
  const checkable = run.beliefs.filter((belief) => belief.expected !== null);
  const correct = checkable.filter(
    (belief) => belief.status === 'match' || belief.status === 'assumed',
  ).length;
  return (
    <div className="stat-strip">
      <Stat
        label="Score"
        value={formatPercent(run.score)}
        sub={`${passed} of ${run.checkDetails.length + run.judgments.length} passed`}
      />
      <Stat
        label="Required facts learned"
        value={stats ? `${requiredFound}/${required.length}` : '—'}
        sub={stats ? `+${optional} of ${optionalAvailable} optional` : undefined}
      />
      <Stat
        label="Recorded correctly"
        value={checkable.length > 0 ? `${correct}/${checkable.length}` : '—'}
        sub={stats ? `${stats.assumptions} assumed before told` : undefined}
      />
      <Stat
        label="Questions asked"
        value={stats ? String(stats.questions) : '—'}
        sub={stats ? `max ${stats.maxQuestionsPerTurn} per message` : undefined}
      />
      <Stat
        label="Turns to plan"
        value={stats?.turnsToPlan != null ? String(stats.turnsToPlan) : '—'}
        sub={
          stats?.timeToPlanMs != null
            ? `${formatDuration(stats.timeToPlanMs)} to first save`
            : 'no schedule saved'
        }
      />
      <Stat
        label="Coach tokens"
        value={formatTokens(run.tokens.coachInput + run.tokens.coachOutput)}
        sub={
          stats?.medianTurnMs != null
            ? `median turn ${formatDuration(stats.medianTurnMs)}`
            : undefined
        }
      />
    </div>
  );
}

export function FlagList({
  flags,
  onSelectRef,
}: {
  flags: SessionFlag[];
  onSelectRef: (ref: string) => void;
}) {
  if (flags.length === 0) {
    return (
      <div className="flag-list empty">
        <span className="flag-glyph flag-ok">✓</span> No conversation or plan flags raised.
      </div>
    );
  }
  return (
    <ul className="flag-list">
      {flags.map((flag) => (
        <li key={flag.id} className={`flag flag-${flag.severity}`}>
          <span className={`flag-glyph flag-${flag.severity}`} aria-label={flag.severity}>
            {SEVERITY_GLYPH[flag.severity]}
          </span>
          <strong>{flag.label}</strong>
          <span className="muted">{flag.detail}</span>
          {flag.ref && (
            <RefLink refId={flag.ref} onSelect={onSelectRef}>
              Show
            </RefLink>
          )}
        </li>
      ))}
    </ul>
  );
}
