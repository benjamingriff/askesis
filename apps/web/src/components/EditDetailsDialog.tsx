import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { api } from '../api';
import { result } from '../lib/result';
import type { Plan } from '../plan-data';
import { Button, Dialog, Notice } from './ui';

export function EditDetailsDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan;
  onClose: () => void;
  onSaved: (plan: Plan) => void;
}) {
  const client = useQueryClient();
  // The saved plan this form is editing. Saves send its concurrency values, so a background
  // refresh never silently overwrites someone else's change; only Refresh replaces it.
  const [baseline, setBaseline] = useState(plan);
  const version = baseline.draft ?? baseline.locked;
  const [name, setName] = useState(plan.displayName);
  const [description, setDescription] = useState(version?.description ?? '');
  const [startDate, setStartDate] = useState(version?.startDate ?? '');
  const [endDate, setEndDate] = useState(version?.endDate ?? '');
  const contentDirty =
    description !== (version?.description ?? '') ||
    startDate !== (version?.startDate ?? '') ||
    endDate !== (version?.endDate ?? '');
  const nameDirty = name.trim() !== baseline.displayName;
  const adopt = (latest: Plan) => {
    setBaseline(latest);
    client.setQueryData(['plans', plan.id], latest);
  };
  const save = useMutation({
    mutationFn: async () => {
      let latest = baseline;
      if (contentDirty && latest.draft) {
        latest = result(
          await api.PATCH('/api/v1/plans/{planId}/draft', {
            params: { path: { planId: plan.id } },
            body: {
              expectedDraftId: latest.draft.id,
              expectedEditNumber: latest.draft.editNumber,
              description: description || null,
              startDate: startDate || null,
              endDate: endDate || null,
            },
          }),
        );
        // If the rename below fails, a retry continues from the saved content.
        adopt(latest);
      }
      // Only rename when the user changed the name; never undo a rename made elsewhere.
      if (nameDirty && name.trim() !== latest.displayName)
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
  const refresh = useMutation({
    mutationFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}', { params: { path: { planId: plan.id } } })),
    onSuccess: (latest) => {
      adopt(latest);
      save.reset();
    },
  });
  const busy = save.isPending || refresh.isPending;
  const unsavable =
    plan.archived || baseline.archived
      ? 'This plan is archived. Copy your edits, then unarchive it to save them.'
      : !baseline.draft && contentDirty
        ? 'There is no editable draft any more. Copy your edits, then unlock the plan to save them.'
        : null;
  const canSave = !busy && !unsavable && !!name.trim() && (nameDirty || contentDirty);
  // Unsaved details survive accidental navigation, as the earlier inline editor did.
  const dirty = (nameDirty || contentDirty) && !save.isSuccess;
  const blocker = useBlocker(dirty);
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (dirty) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty],
    ),
  );
  return (
    <Dialog
      open
      busy={busy}
      onClose={onClose}
      title="Plan details"
      description="The name is not versioned. Dates and description belong to the draft."
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="plan-details-form"
            busy={save.isPending}
            disabled={!canSave}
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
          if (canSave) save.mutate();
        }}
      >
        <label className="field">
          <span>Plan name</span>
          <input
            required
            disabled={busy}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset disabled={!baseline.draft || busy} className="form-stack">
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
        {unsavable ? (
          <Notice tone="warning" role="alert">
            {unsavable}
          </Notice>
        ) : !baseline.draft ? (
          <p className="muted">Unlock the plan to change its dates or description.</p>
        ) : null}
        {blocker.state === 'blocked' ? (
          <Notice
            tone="warning"
            role="alert"
            action={
              <div className="button-row">
                <Button size="sm" variant="ghost" onClick={() => blocker.reset()}>
                  Keep editing
                </Button>
                <Button size="sm" variant="danger" onClick={() => blocker.proceed()}>
                  Leave without saving
                </Button>
              </div>
            }
          >
            <strong>Leave without saving?</strong>
            <span>Your unsaved plan details will be lost.</span>
          </Notice>
        ) : null}
        {save.error || refresh.error ? (
          <Notice
            tone="danger"
            role="alert"
            action={
              <Button
                size="sm"
                busy={refresh.isPending}
                disabled={busy}
                onClick={() => refresh.mutate()}
              >
                Refresh latest plan
              </Button>
            }
          >
            {refresh.error
              ? `Couldn’t refresh the plan: ${refresh.error.message}`
              : save.error?.message}
          </Notice>
        ) : null}
        {refresh.isSuccess ? (
          <Notice tone="warning">
            <strong>
              Latest plan loaded. Your edits are kept and will replace it when you save.
            </strong>
            <ul className="plain-list">
              <li>Saved name: {baseline.displayName}</li>
              <li>Saved description: {version?.description || 'None'}</li>
              <li>Saved start date: {version?.startDate ?? 'None'}</li>
              <li>Saved end date: {version?.endDate ?? 'None'}</li>
            </ul>
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}
