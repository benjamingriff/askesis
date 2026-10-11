import { useState } from 'react';
import { ResultBadge } from '../../components/Badges';
import { saveReview } from '../../lib/data';
import { formatDateTime, humanize } from '../../lib/format';
import { href } from '../../lib/route';
import { CRITERIA, type HumanReview, type HumanVerdict, type RunSummary } from '../../types';

// A failure taxonomy to label runs consistently; free-text tags are allowed too.
const SUGGESTED_TAGS = [
  'ignored constraint',
  'wrong baseline',
  'assumed facts',
  'unsafe progression',
  'too many questions',
  'slow to plan',
  'summary mismatch',
  'weak prescriptions',
  'tone',
  'exemplary',
];

const VERDICTS: { id: HumanVerdict; label: string }[] = [
  { id: 'fit', label: 'Fit for purpose' },
  { id: 'needs_revision', label: 'Needs revision' },
  { id: 'unfit', label: 'Unfit' },
];

type Draft = Omit<HumanReview, 'updatedAt'>;

function empty(review: HumanReview | null): Draft {
  return {
    verdict: review?.verdict ?? null,
    criteria: { ...(review?.criteria ?? {}) },
    tags: [...(review?.tags ?? [])],
    notes: review?.notes ?? '',
  };
}

/** Human review form: a verdict, agreement with the model reviewer, tags and notes. */
export function ReviewPanel({ run, queue }: { run: RunSummary; queue: RunSummary[] }) {
  const [draft, setDraft] = useState<Draft>(() => empty(run.review));
  const [saved, setSaved] = useState<HumanReview | null>(run.review);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [custom, setCustom] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(empty(saved));
  const nextUnreviewed = queue.find(
    (entry) => entry.id !== run.id && entry.review === null && !entry.demo,
  );

  if (run.demo) {
    return (
      <div className="review-panel">
        <h2>Your review</h2>
        <p className="muted small">Demo runs are synthetic and cannot be reviewed.</p>
      </div>
    );
  }

  const save = async (advance: boolean) => {
    setStatus('saving');
    try {
      const result = await saveReview(run.id, draft);
      setSaved(result);
      setDraft(empty(result));
      setStatus('idle');
      if (advance && nextUnreviewed)
        window.location.hash = href('conversations', nextUnreviewed.id);
    } catch {
      setStatus('error');
    }
  };
  const toggleTag = (tag: string) =>
    setDraft({
      ...draft,
      tags: draft.tags.includes(tag)
        ? draft.tags.filter((item) => item !== tag)
        : [...draft.tags, tag],
    });

  return (
    <div className="review-panel">
      <div className="side-heading">
        <h2>Your review</h2>
        <span className="muted small">
          {saved ? `Saved ${formatDateTime(saved.updatedAt)}` : 'Not reviewed'}
        </span>
      </div>

      <div className="review-block">
        <h3>Is this plan and conversation fit for purpose?</h3>
        <div className="verdict-buttons">
          {VERDICTS.map((verdict) => (
            <button
              key={verdict.id}
              type="button"
              className={`verdict-button human-${verdict.id}`}
              aria-pressed={draft.verdict === verdict.id}
              onClick={() =>
                setDraft({ ...draft, verdict: draft.verdict === verdict.id ? null : verdict.id })
              }
            >
              {verdict.label}
            </button>
          ))}
        </div>
      </div>

      <div className="review-block">
        <h3>Do you agree with the model reviewer?</h3>
        {run.criteria.length === 0 && (
          <p className="muted small">No reviewer judgements for this run.</p>
        )}
        <ul className="agreement-list">
          {CRITERIA.filter((criterion) =>
            run.criteria.some((item) => item.criterion === criterion),
          ).map((criterion) => {
            const model = run.criteria.find((item) => item.criterion === criterion);
            const value = draft.criteria[criterion];
            const set = (next: 'agree' | 'disagree') => {
              const criteria = { ...draft.criteria };
              if (value === next) delete criteria[criterion];
              else criteria[criterion] = next;
              setDraft({ ...draft, criteria });
            };
            return (
              <li key={criterion}>
                <span className="agreement-name">{humanize(criterion)}</span>
                {model && <ResultBadge result={model.result} />}
                <span className="agreement-toggle">
                  <button
                    type="button"
                    aria-pressed={value === 'agree'}
                    aria-label={`Agree with ${criterion}`}
                    onClick={() => set('agree')}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    aria-pressed={value === 'disagree'}
                    aria-label={`Disagree with ${criterion}`}
                    onClick={() => set('disagree')}
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="review-block">
        <h3>Tags</h3>
        <div className="tag-picker">
          {[...new Set([...SUGGESTED_TAGS, ...draft.tags])].map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip-button"
              aria-pressed={draft.tags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        <form
          className="custom-tag"
          onSubmit={(event) => {
            event.preventDefault();
            const tag = custom.trim().toLowerCase();
            if (tag && !draft.tags.includes(tag))
              setDraft({ ...draft, tags: [...draft.tags, tag] });
            setCustom('');
          }}
        >
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="Add a tag"
            aria-label="Add a tag"
          />
        </form>
      </div>

      <div className="review-block">
        <h3>Notes</h3>
        <textarea
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          rows={5}
          placeholder="What would a coach change? Cite message numbers where useful."
        />
      </div>

      <div className="review-actions">
        <button
          type="button"
          className="primary"
          disabled={!dirty || status === 'saving'}
          onClick={() => void save(false)}
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={status === 'saving' || (!dirty && !nextUnreviewed)}
          onClick={() => void save(true)}
        >
          {nextUnreviewed ? 'Save & next unreviewed' : 'Save'}
        </button>
      </div>
      {status === 'error' && <p className="error-text">Saving failed. Check the dev server.</p>}
      <p className="footnote">
        Saved as human-review.json in the run folder. Reviews feed the grader agreement on the
        Grader page.
      </p>
    </div>
  );
}
