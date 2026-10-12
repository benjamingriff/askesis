import { VERDICT_GLYPH, VERDICT_LABEL } from '../lib/format';
import type { Verdict } from '../types';

export function VerdictBadge({ verdict, large = false }: { verdict: Verdict; large?: boolean }) {
  return (
    <span className={`verdict verdict-${verdict}${large ? ' large' : ''}`}>
      <b aria-hidden="true">{VERDICT_GLYPH[verdict]}</b>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

const RESULT_GLYPH: Record<string, string> = { pass: '✓', fail: '✕', uncertain: '?', skipped: '–' };

export function ResultBadge({ result }: { result: string }) {
  return (
    <span className={`result result-${result}`}>
      <b aria-hidden="true">{RESULT_GLYPH[result] ?? '•'}</b>
      {result}
    </span>
  );
}

/** Compact strip of pass/fail pips, one per check or criterion. */
export function Pips({ items }: { items: { key: string; status: string; label: string }[] }) {
  if (items.length === 0) return <span className="muted">—</span>;
  return (
    <span
      className="pips"
      aria-label={items.map((item) => `${item.label}: ${item.status}`).join(', ')}
    >
      {items.map((item) => (
        <i
          key={item.key}
          className={`pip pip-${item.status}`}
          title={`${item.label}: ${item.status}`}
        />
      ))}
    </span>
  );
}

export function Tag({
  children,
  tone = 'neutral',
}: {
  children: string;
  tone?: 'neutral' | 'warn' | 'accent';
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="muted">—</span>;
  return (
    <span className="score-bar">
      <span className="score-track">
        <span style={{ width: `${score * 100}%` }} />
      </span>
      <span className="score-value">{Math.round(score * 100)}</span>
    </span>
  );
}
