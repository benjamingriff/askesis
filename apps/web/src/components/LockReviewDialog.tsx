import { CheckCircle2, CircleAlert, Lock, TriangleAlert } from 'lucide-react';
import { formatShort } from '../lib/format';
import type { Plan, Preview } from '../plan-data';
import { PlanningReview } from './PlanningReview';
import { Button, CheckRow, Dialog, Notice, Pill } from './ui';

const CHANGE_LABEL: Record<string, string> = {
  added: 'New',
  new: 'New',
  changed: 'Edited',
  updated: 'Edited',
  moved: 'Moved',
  removed: 'Removed',
  deleted: 'Removed',
};

export function LockReviewDialog({
  open,
  plan,
  preview,
  validating,
  validateError,
  briefConfirmed,
  acknowledged,
  onBriefConfirmed,
  onAcknowledged,
  busy,
  error,
  lockedVersion,
  onRetry,
  onLock,
  onClose,
}: {
  open: boolean;
  plan: Plan;
  preview: Preview | null;
  validating: boolean;
  validateError?: string | undefined;
  briefConfirmed: boolean;
  acknowledged: boolean;
  onBriefConfirmed: (value: boolean) => void;
  onAcknowledged: (value: boolean) => void;
  busy: boolean;
  error?: string | undefined;
  lockedVersion: number | null;
  onRetry: () => void;
  onLock: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const nextVersion = (plan.locked?.versionNumber ?? 0) + 1;
  if (lockedVersion !== null)
    return (
      <Dialog
        open
        size="sm"
        onClose={onClose}
        title={`Plan v${lockedVersion} locked`}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="lock-success">
          <span>
            <Lock size={40} aria-hidden="true" />
          </span>
          <p>
            Your brief, pace guides and workouts are frozen together as version {lockedVersion}.
          </p>
        </div>
      </Dialog>
    );
  const errors = preview?.findings.filter((f) => f.severity === 'error') ?? [];
  const warnings = preview?.findings.filter((f) => f.severity === 'warning') ?? [];
  const blocking = errors.some(
    (f) => !(f.code === 'brief.confirmation_required' && briefConfirmed),
  );
  const needsBrief = !!preview?.briefReview && !preview.briefReview.confirmed;
  const ready =
    !!preview && preview.hasChanges && !blocking && (!warnings.length || acknowledged) && !busy;
  const workouts = preview?.summary.affectedWorkouts ?? [];
  const entities = Object.entries(preview?.summary.entities ?? {}).filter(
    ([, counts]) => counts.added || counts.changed || counts.removed,
  );
  return (
    <Dialog
      open
      size="lg"
      busy={busy}
      onClose={onClose}
      title={`Lock plan v${nextVersion}`}
      description="Locking makes this version immutable. Confirming and locking are human decisions — your coach can’t do them for you."
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Keep editing
          </Button>
          <Button
            variant="primary"
            icon={Lock}
            busy={busy}
            disabled={!ready}
            aria-label="Confirm and lock version"
            onClick={onLock}
          >
            Lock plan v{nextVersion}
          </Button>
        </>
      }
    >
      <div className="lock-review" aria-label="Lock review">
        {validating ? <p role="status">Checking the draft…</p> : null}
        {validateError ? (
          <Notice
            tone="danger"
            role="alert"
            action={
              <Button size="sm" variant="ghost" onClick={onRetry}>
                Retry
              </Button>
            }
          >
            {validateError}
          </Notice>
        ) : null}
        {error ? (
          <Notice
            tone="danger"
            role="alert"
            action={
              <Button size="sm" variant="ghost" onClick={onRetry}>
                Review again
              </Button>
            }
          >
            {error}
          </Notice>
        ) : null}
        {preview ? (
          <>
            {plan.draft?.basedOnVersionId &&
            plan.locked &&
            plan.draft.basedOnVersionId !== plan.locked.id ? (
              <Notice tone="warning" icon={TriangleAlert}>
                This draft was restored from an older version. Locking it replaces the current
                schedule with the restored content while preserving all previous versions.
              </Notice>
            ) : null}
            {!preview.hasChanges ? (
              <Notice tone="neutral" icon={CircleAlert}>
                No content changes since the locked version. Edit the draft or discard it; no new
                version will be created.
              </Notice>
            ) : null}
            {preview.briefReview ? (
              <div className="review-card">
                <PlanningReview state={preview.briefReview} />
                {needsBrief ? (
                  <CheckRow
                    checked={briefConfirmed}
                    onChange={onBriefConfirmed}
                    label="I confirm the planning assumptions and pace guides shown above."
                    hint="Your coach can update assumptions, but only you can confirm them."
                  />
                ) : (
                  <p className="confirmed">
                    <CheckCircle2 size={16} aria-hidden="true" /> Assumptions already confirmed
                  </p>
                )}
              </div>
            ) : null}
            <div className="review-card">
              <h3>What’s changing{plan.locked ? ` from v${plan.locked.versionNumber}` : ''}</h3>
              {preview.summary.headerChanges.length ? (
                <p className="muted">Changed fields: {preview.summary.headerChanges.join(', ')}.</p>
              ) : null}
              {workouts.length ? (
                <ul className="change-list">
                  {workouts.slice(0, 12).map((workout, index) => (
                    <li key={index}>
                      <Pill tone="accent">{CHANGE_LABEL[workout.change] ?? workout.change}</Pill>
                      <span>
                        {formatShort(workout.date)} · {workout.title}
                        {workout.previousDate && workout.previousDate !== workout.date
                          ? ` (was ${formatShort(workout.previousDate)})`
                          : ''}
                      </span>
                    </li>
                  ))}
                  {workouts.length > 12 ? (
                    <li className="muted">+ {workouts.length - 12} more</li>
                  ) : null}
                </ul>
              ) : null}
              {entities.length ? (
                <ul className="plain-list">
                  {entities.map(([entity, counts]) => (
                    <li key={entity}>
                      {entity.replaceAll('_', ' ')}: {counts.added} added, {counts.changed} changed,{' '}
                      {counts.removed} removed.
                    </li>
                  ))}
                </ul>
              ) : null}
              {!workouts.length && !entities.length && !preview.summary.headerChanges.length ? (
                <p className="muted">No workout changes.</p>
              ) : null}
            </div>
            <div className="review-card">
              <h3>Things to know</h3>
              {preview.findings.length === 0 ? (
                <p className="confirmed">
                  <CheckCircle2 size={16} aria-hidden="true" /> No validation issues.
                </p>
              ) : (
                <ul className="finding-list">
                  {preview.findings.map((finding, index) => (
                    <li key={`${finding.code}:${index}`} className={finding.severity}>
                      {finding.severity === 'error' ? (
                        <CircleAlert size={18} aria-hidden="true" />
                      ) : (
                        <TriangleAlert size={18} aria-hidden="true" />
                      )}
                      <span>
                        <strong>{finding.severity === 'error' ? 'Error' : 'Warning'}:</strong>{' '}
                        {finding.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {warnings.length ? (
                <CheckRow
                  checked={acknowledged}
                  onChange={onAcknowledged}
                  label="I have reviewed and accept all warnings listed above."
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
