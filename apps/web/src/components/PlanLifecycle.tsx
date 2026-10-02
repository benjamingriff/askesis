import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  FileSearch,
  History,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Power,
  PowerOff,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { formatShort } from '../lib/format';
import { result } from '../lib/result';
import type { Plan, Preview } from '../plan-data';
import { usePlanPreferences } from '../plan-selection';
import { PlanningReview } from './PlanningReview';
import { Button, CheckRow, Dialog, Menu, Notice, Pill } from './ui';

export function useRequestKey() {
  const keys = useRef(new Map<string, string>());
  return (input: unknown) => {
    const signature = JSON.stringify(input);
    let key = keys.current.get(signature);
    if (key === undefined) {
      key = crypto.randomUUID();
      keys.current.set(signature, key);
    }
    return key;
  };
}

type Action = 'unlock' | 'discard' | 'archive' | 'unarchive' | 'activate' | 'deactivate' | 'lock';
type Confirm = 'unlock' | 'discard' | 'archive' | 'unarchive' | 'review' | 'details' | null;

/** Opens (or reuses) the plan's coaching conversation. */
export function useOpenPlanChat(planId: string) {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (prefill?: string) => ({
      conversation: result(
        await api.POST('/api/v1/plans/{planId}/conversations/open', {
          params: { path: { planId } },
        }),
      ),
      prefill,
    }),
    onSuccess: ({ conversation, prefill }) =>
      void navigate(`/chat/${conversation.id}`, { state: prefill ? { prefill } : undefined }),
  });
}

/**
 * All human-only lifecycle controls for a plan. State is shown separately by the status pill;
 * this toolbar only carries actions, each confirmed in a dialog anchored to the user's focus.
 */
export function PlanToolbar({
  plan,
  onChanged,
  onShowHistory,
}: {
  plan: Plan;
  onChanged?: ((plan: Plan, action: Action | 'details') => void) | undefined;
  onShowHistory?: (() => void) | undefined;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const preferences = usePlanPreferences();
  const requestKey = useRequestKey();
  const chat = useOpenPlanChat(plan.id);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [briefConfirmed, setBriefConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [locked, setLocked] = useState<number | null>(null);
  const params = { path: { planId: plan.id } };

  const settle = async (updated: Plan, action: Action | 'details') => {
    if (action === 'unlock' || action === 'activate')
      preferences.write({ planId: updated.id, view: updated.draft ? 'draft' : 'locked' });
    if (action === 'lock') preferences.write({ planId: updated.id, view: 'locked' });
    client.setQueryData(['plans', plan.id], updated);
    await client.invalidateQueries({ queryKey: ['plans'] });
    onChanged?.(updated, action);
  };

  const validate = useMutation({
    mutationFn: async () => result(await api.POST('/api/v1/plans/{planId}/validate', { params })),
    onMutate: () => {
      setPreview(null);
      setBriefConfirmed(false);
      setAcknowledged(false);
    },
    onSuccess: setPreview,
  });

  const mutation = useMutation({
    mutationFn: async (action: Action): Promise<Plan> => {
      if (
        action === 'activate' ||
        action === 'deactivate' ||
        action === 'archive' ||
        action === 'unarchive'
      )
        return result(
          await api.POST(`/api/v1/plans/{planId}/${action}`, {
            params,
            body: { expectedStateVersion: plan.stateVersion },
          }),
        );
      const body = {
        expectedStateVersion: plan.stateVersion,
        ...(plan.draft
          ? { expectedDraftId: plan.draft.id, expectedEditNumber: plan.draft.editNumber }
          : {}),
      };
      if (action === 'unlock')
        return result(await api.POST('/api/v1/plans/{planId}/unlock', { params, body }));
      const header = {
        'idempotency-key': requestKey({ action, body, preview, acknowledged, briefConfirmed }),
      };
      if (action === 'discard')
        return result(
          await api.POST('/api/v1/plans/{planId}/discard', { params: { ...params, header }, body }),
        );
      if (!preview) throw new Error('Review the plan before locking.');
      return result(
        await api.POST('/api/v1/plans/{planId}/lock', {
          params: { ...params, header },
          body: {
            ...body,
            ...(briefConfirmed && preview.briefReview && !preview.briefReview.confirmed
              ? { confirmBriefHash: preview.briefReview.hash }
              : {}),
            expectedContentHash: preview.contentHash,
            expectedValidationDigest: preview.validationDigest,
            acknowledgedWarningCodes: acknowledged
              ? preview.findings.filter((f) => f.severity === 'warning').map((f) => f.code)
              : [],
          },
        }),
      );
    },
    onSuccess: async (updated, action) => {
      if (action === 'lock') {
        setPreview(null);
        setLocked(updated.locked?.versionNumber ?? null);
      } else setConfirm(null);
      await settle(updated, action);
    },
    onError: (_error, action) => {
      if (action === 'lock') setPreview(null);
    },
  });

  const open = (next: Confirm) => {
    mutation.reset();
    setLocked(null);
    setConfirm(next);
    if (next === 'review') validate.mutate();
  };
  const close = () => {
    if (mutation.isPending) return;
    setConfirm(null);
    setPreview(null);
    setLocked(null);
    mutation.reset();
  };

  const busy = mutation.isPending;
  const archived = plan.archived;
  return (
    <>
      <div className="plan-toolbar" role="toolbar" aria-label="Plan actions">
        <Button
          icon={MessageSquare}
          aria-label="Chat about this plan"
          title="Chat about this plan"
          disabled={archived || chat.isPending}
          busy={chat.isPending}
          onClick={() => chat.mutate(undefined)}
        >
          <span className="btn-text">Coach</span>
        </Button>
        {archived ? (
          <Button icon={ArchiveRestore} disabled={busy} onClick={() => open('unarchive')}>
            Unarchive plan…
          </Button>
        ) : plan.draft ? (
          <Button
            variant="primary"
            icon={Lock}
            aria-label="Review and lock"
            title="Review the draft and lock a new version"
            disabled={busy}
            onClick={() => open('review')}
          >
            <span className="btn-text">Review &amp; lock</span>
          </Button>
        ) : (
          <Button
            icon={LockOpen}
            aria-label="Unlock plan"
            title="Unlock to create an editable draft"
            disabled={busy}
            onClick={() => open('unlock')}
          >
            <span className="btn-text">Unlock</span>
          </Button>
        )}
        <Menu
          label="Plan options"
          icon={MoreHorizontal}
          items={[
            !archived && {
              label: 'Edit details',
              icon: PencilLine,
              onSelect: () => open('details'),
            },
            {
              label: plan.draft ? 'Brief & pace guides' : 'View brief & pace guides',
              icon: ClipboardList,
              onSelect: () =>
                void navigate(
                  plan.draft
                    ? `/plans/${plan.id}/brief`
                    : `/plans/${plan.id}/versions/${plan.locked?.id}/brief`,
                ),
            },
            !!onShowHistory && { label: 'Version history', icon: History, onSelect: onShowHistory },
            !!plan.draft && {
              label: 'Inspect draft content',
              icon: FileSearch,
              onSelect: () => void navigate(`/plans/${plan.id}/draft`),
            },
            'divider',
            !archived &&
              !!plan.locked && {
                label: plan.active ? 'Deactivate plan' : 'Activate plan',
                icon: plan.active ? PowerOff : Power,
                disabled: busy,
                onSelect: () => mutation.mutate(plan.active ? 'deactivate' : 'activate'),
              },
            !archived &&
              !!plan.draft &&
              !!plan.locked && {
                label: 'Discard draft…',
                icon: Trash2,
                danger: true,
                onSelect: () => open('discard'),
              },
            !archived && {
              label: 'Archive plan…',
              icon: Archive,
              danger: true,
              onSelect: () => open('archive'),
            },
          ]}
        />
      </div>
      {mutation.error && !confirm ? (
        <Notice
          tone="danger"
          role="alert"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void client.invalidateQueries({ queryKey: ['plans', plan.id] })}
            >
              Refresh plan
            </Button>
          }
        >
          {mutation.error.message}
        </Notice>
      ) : null}
      {chat.error ? (
        <Notice tone="danger" role="alert">
          {chat.error.message}
        </Notice>
      ) : null}

      <ConfirmDialog
        confirm={confirm}
        plan={plan}
        busy={busy}
        error={mutation.error?.message}
        onClose={close}
        onConfirm={(action) => mutation.mutate(action)}
      />
      <LockReviewDialog
        open={confirm === 'review'}
        plan={plan}
        preview={preview}
        validating={validate.isPending}
        validateError={validate.error?.message}
        briefConfirmed={briefConfirmed}
        acknowledged={acknowledged}
        onBriefConfirmed={setBriefConfirmed}
        onAcknowledged={setAcknowledged}
        busy={busy}
        error={mutation.error?.message}
        lockedVersion={locked}
        onRetry={() => {
          mutation.reset();
          validate.mutate();
        }}
        onLock={() => mutation.mutate('lock')}
        onClose={close}
      />
      {confirm === 'details' ? (
        <EditDetailsDialog
          plan={plan}
          onClose={close}
          onSaved={(updated) => {
            setConfirm(null);
            void settle(updated, 'details');
          }}
        />
      ) : null}
    </>
  );
}

const COPY = {
  archive: {
    title: 'Archive this plan?',
    body: 'This plan will be deactivated and become read-only. All saved draft content and locked versions are retained.',
    action: 'Confirm archive',
    icon: Archive,
  },
  unarchive: {
    title: 'Unarchive this plan?',
    body: 'This restores the saved draft and locked state to your library. The plan will remain inactive until you activate it.',
    action: 'Confirm unarchive',
    icon: ArchiveRestore,
  },
  unlock: {
    title: 'Unlock to edit?',
    body: 'Locking freezes your brief, pace guides and workouts together. Unlocking copies the current version into an editable draft. Your coach can then make changes, and you review and lock again when you are happy. The locked version stays unchanged.',
    action: 'Unlock and edit',
    icon: LockOpen,
  },
  discard: {
    title: 'Discard this draft?',
    body: '',
    action: 'Confirm discard',
    icon: Trash2,
  },
} as const;

function ConfirmDialog({
  confirm,
  plan,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  confirm: Confirm;
  plan: Plan;
  busy: boolean;
  error?: string | undefined;
  onClose: () => void;
  onConfirm: (action: 'archive' | 'unarchive' | 'unlock' | 'discard') => void;
}) {
  if (
    confirm !== 'archive' &&
    confirm !== 'unarchive' &&
    confirm !== 'unlock' &&
    confirm !== 'discard'
  )
    return null;
  const copy = COPY[confirm];
  const danger = confirm === 'archive' || confirm === 'discard';
  return (
    <Dialog
      open
      size="sm"
      busy={busy}
      onClose={onClose}
      title={confirm === 'unlock' ? `Plan v${plan.locked?.versionNumber} is locked` : copy.title}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {confirm === 'unlock' ? 'Keep locked' : 'Cancel'}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            icon={copy.icon}
            busy={busy}
            disabled={busy}
            onClick={() => onConfirm(confirm)}
          >
            {copy.action}
          </Button>
        </>
      }
    >
      <p>
        {confirm === 'discard'
          ? `All draft changes will be permanently removed. Locked version ${plan.locked?.versionNumber} stays unchanged.`
          : copy.body}
      </p>
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}

const CHANGE_LABEL: Record<string, string> = {
  added: 'New',
  new: 'New',
  changed: 'Edited',
  updated: 'Edited',
  moved: 'Moved',
  removed: 'Removed',
  deleted: 'Removed',
};

function LockReviewDialog({
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

function EditDetailsDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan;
  onClose: () => void;
  onSaved: (plan: Plan) => void;
}) {
  const version = plan.draft ?? plan.locked;
  const [name, setName] = useState(plan.displayName);
  const [description, setDescription] = useState(version?.description ?? '');
  const [startDate, setStartDate] = useState(version?.startDate ?? '');
  const [endDate, setEndDate] = useState(version?.endDate ?? '');
  const contentDirty =
    description !== (version?.description ?? '') ||
    startDate !== (version?.startDate ?? '') ||
    endDate !== (version?.endDate ?? '');
  const nameDirty = name.trim() !== plan.displayName;
  const save = useMutation({
    mutationFn: async () => {
      let latest = plan;
      if (contentDirty && plan.draft)
        latest = result(
          await api.PATCH('/api/v1/plans/{planId}/draft', {
            params: { path: { planId: plan.id } },
            body: {
              expectedDraftId: plan.draft.id,
              expectedEditNumber: plan.draft.editNumber,
              description: description || null,
              startDate: startDate || null,
              endDate: endDate || null,
            },
          }),
        );
      if (nameDirty)
        latest = result(
          await api.PATCH('/api/v1/plans/{planId}', {
            params: { path: { planId: plan.id } },
            body: { displayName: name.trim(), expectedStateVersion: latest.stateVersion },
          }),
        );
      return latest;
    },
    onSuccess: onSaved,
  });
  const editableContent = !!plan.draft;
  return (
    <Dialog
      open
      busy={save.isPending}
      onClose={onClose}
      title="Plan details"
      description="The name is not versioned. Dates and description belong to the draft."
      footer={
        <>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="plan-details-form"
            busy={save.isPending}
            disabled={save.isPending || !name.trim() || (!nameDirty && !contentDirty)}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form
        id="plan-details-form"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="field">
          <span>Plan name</span>
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset disabled={!editableContent} className="form-stack">
          <label className="field">
            <span>Description</span>
            <textarea
              maxLength={20000}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="field">
              <span>End date</span>
              <input
                type="date"
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
        </fieldset>
        {!editableContent ? (
          <p className="muted">Unlock the plan to change its dates or description.</p>
        ) : null}
        {save.error ? (
          <Notice tone="danger" role="alert">
            {save.error.message}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}
