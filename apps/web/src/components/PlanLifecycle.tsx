import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
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
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { result } from '../lib/result';
import { useRequestKey } from '../lib/use-request-key';
import { usePlanPreferences } from '../plan-selection';
import type { Plan, Preview } from '../plan-data';
import { Button, Dialog, Menu, Notice } from './ui';
import { EditDetailsDialog } from './EditDetailsDialog';
import { LockReviewDialog } from './LockReviewDialog';

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

export function PlanChatError({ chat }: { chat: ReturnType<typeof useOpenPlanChat> }) {
  if (!chat.error) return null;
  return (
    <Notice
      tone="danger"
      role="alert"
      action={
        <Button
          size="sm"
          busy={chat.isPending}
          disabled={chat.isPending}
          onClick={() => chat.mutate(chat.variables)}
        >
          Retry opening coach
        </Button>
      }
    >
      <span>Couldn’t open your coach conversation: {chat.error.message}</span>
      {chat.variables ? <span>{chat.variables}</span> : null}
    </Notice>
  );
}

/**
 * All human-only lifecycle controls for a plan. State is shown separately by the status pill;
 * this toolbar only carries actions, each confirmed in a dialog anchored to the user's focus.
 */
export function PlanToolbar({
  plan,
  onChanged,
  onShowHistory,
  showCoach = true,
}: {
  plan: Plan;
  onChanged?: ((plan: Plan, action: Action | 'details') => void) | undefined;
  onShowHistory?: (() => void) | undefined;
  /** Hidden beside a chat, where opening the plan's chat would leave the current one. */
  showCoach?: boolean | undefined;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const preferences = usePlanPreferences();
  const requestKey = useRequestKey();
  const chat = useOpenPlanChat(plan.id);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reviewedPlan, setReviewedPlan] = useState<Plan | null>(null);
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
    await Promise.all([
      client.invalidateQueries({ queryKey: ['plans'] }),
      client.invalidateQueries({ queryKey: ['plan-workouts'] }),
    ]);
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
      // Confirmations retain the state the user reviewed, including after a failed/uncertain
      // request. Immediate activation commands intentionally use the current desired state.
      const baseline = reviewedPlan ?? plan;
      if (
        action === 'activate' ||
        action === 'deactivate' ||
        action === 'archive' ||
        action === 'unarchive'
      )
        return result(
          await api.POST(`/api/v1/plans/{planId}/${action}`, {
            params,
            body: {
              expectedStateVersion:
                action === 'archive' || action === 'unarchive'
                  ? baseline.stateVersion
                  : plan.stateVersion,
            },
          }),
        );
      // Lock exactly what was reviewed: the preview carries the reviewed concurrency values,
      // which stay correct even if this component's plan prop is stale.
      const body =
        action === 'lock' && preview
          ? {
              expectedStateVersion: preview.stateVersion,
              expectedDraftId: preview.draftId,
              expectedEditNumber: preview.editNumber,
            }
          : {
              expectedStateVersion: baseline.stateVersion,
              ...(baseline.draft
                ? {
                    expectedDraftId: baseline.draft.id,
                    expectedEditNumber: baseline.draft.editNumber,
                  }
                : {}),
            };
      if (action === 'unlock')
        return result(await api.POST('/api/v1/plans/{planId}/unlock', { params, body }));
      const header = {
        'idempotency-key': requestKey(
          action === 'discard'
            ? { action, body }
            : { action, body, preview, acknowledged, briefConfirmed },
        ),
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
      // A conflict means the plan changed elsewhere; fetch it so the next attempt is current.
      void client.invalidateQueries({ queryKey: ['plans'] });
    },
  });

  const open = (next: Confirm) => {
    mutation.reset();
    setLocked(null);
    setReviewedPlan(structuredClone(plan));
    setConfirm(next);
    if (next === 'review') validate.mutate();
  };
  const close = () => {
    if (mutation.isPending) return;
    setConfirm(null);
    setReviewedPlan(null);
    setPreview(null);
    setLocked(null);
    mutation.reset();
  };

  const busy = mutation.isPending;
  const archived = plan.archived;
  return (
    <>
      <div className="plan-toolbar" role="toolbar" aria-label="Plan actions">
        {showCoach ? (
          <Button
            className="collapsible"
            icon={MessageSquare}
            aria-label="Chat about this plan"
            title="Chat about this plan"
            disabled={archived || chat.isPending}
            busy={chat.isPending}
            onClick={() => chat.mutate(undefined)}
          >
            <span className="btn-text">Coach</span>
          </Button>
        ) : null}
        {archived ? (
          <Button icon={ArchiveRestore} disabled={busy} onClick={() => open('unarchive')}>
            Unarchive plan…
          </Button>
        ) : plan.draft ? (
          <Button
            className="collapsible"
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
            className="collapsible"
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
      <PlanChatError chat={chat} />

      <ConfirmDialog
        confirm={confirm}
        plan={reviewedPlan ?? plan}
        changed={
          !!reviewedPlan &&
          (reviewedPlan.stateVersion !== plan.stateVersion ||
            reviewedPlan.draft?.id !== plan.draft?.id ||
            reviewedPlan.draft?.editNumber !== plan.draft?.editNumber)
        }
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
          void client.invalidateQueries({ queryKey: ['plans'] }).then(() => validate.mutate());
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
  changed,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  confirm: Confirm;
  plan: Plan;
  changed: boolean;
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
      {changed ? (
        <Notice tone="warning">
          The plan changed elsewhere. Cancel and reopen this confirmation to review the latest
          changes.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}
