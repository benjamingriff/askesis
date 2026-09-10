import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router';
import type { paths } from '@askesis/api-client';
import { api } from '../api';
import { usePlanPreferences } from '../plan-selection';
import { PlanHistory } from './plan-history';

type Plan = paths['/api/v1/plans/{planId}']['get']['responses'][200]['content']['application/json'];
type Preview =
  paths['/api/v1/plans/{planId}/validate']['post']['responses'][200]['content']['application/json'];
function result<T>(response: { data?: T; error?: unknown }): T {
  if (response.data !== undefined) return response.data;
  const error = response.error as { error?: { message?: string } } | undefined;
  throw new Error(
    error?.error?.message ?? 'The request failed. Check your connection and try again.',
  );
}

function useRequestKey() {
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

export function PlansPage({ archived = false }: { archived?: boolean }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const requestKey = useRequestKey();
  const plans = useQuery({
    queryKey: ['plans', 'collection', archived ? 'archive' : 'library'],
    queryFn: async () =>
      result(
        await api.GET('/api/v1/plans', {
          params: { query: { collection: archived ? 'archive' : 'library' } },
        }),
      ).plans,
  });
  const create = useMutation({
    mutationFn: async () =>
      result(
        await api.POST('/api/v1/plans', {
          params: { header: { 'idempotency-key': requestKey([name.trim(), startDate, endDate]) } },
          body: { displayName: name.trim(), startDate, endDate },
        }),
      ),
    onSuccess: async (plan) => {
      await client.invalidateQueries({ queryKey: ['plans'] });
      void navigate(`/plans/${plan.id}/brief`);
    },
  });
  return (
    <main className="plan-lifecycle">
      <p className="page-kicker">Your training</p>
      <h1>{archived ? 'Archived plans' : 'Plan library'}</h1>
      <Link to={archived ? '/plans' : '/plans/archive'}>
        {archived ? 'Back to library' : 'View archive'}
      </Link>
      <p>
        Create a plan, edit a draft, then review and lock a version. Plans remain private to your
        account.
      </p>
      {!archived && (
        <form
          className="plan-panel"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            Plan name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <button className="primary-button" disabled={create.isPending || !name.trim()}>
            Create plan
          </button>
          {create.error && <p role="alert">{create.error.message}</p>}
        </form>
      )}
      {plans.isPending && <p role="status">Loading plans…</p>}
      {plans.error && (
        <p role="alert">
          {plans.error.message} <button onClick={() => void plans.refetch()}>Retry</button>
        </p>
      )}
      {plans.data?.length === 0 && (
        <p>{archived ? 'No archived plans.' : 'No plans yet. Create your first draft above.'}</p>
      )}
      <ul className="plan-library-list">
        {plans.data?.map((plan) => (
          <li key={plan.id}>
            <Link to={`/plans/${plan.id}`}>
              <strong>{plan.displayName}</strong>
              <span>
                {plan.active && 'Active · '}
                {plan.archived
                  ? 'Archived'
                  : plan.draft
                    ? plan.locked
                      ? 'Unlocked · draft changes'
                      : 'Draft'
                    : `Locked · version ${plan.locked?.versionNumber}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function PlanPage() {
  const { planId = '' } = useParams();
  const query = useQuery({
    queryKey: ['plans', planId],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}', { params: { path: { planId } } })),
  });
  return (
    <main className="plan-lifecycle">
      <Link to="/plans">← Plan library</Link>
      {query.isPending && <p role="status">Loading plan…</p>}
      {query.error && (
        <p role="alert">
          {query.error.message} <button onClick={() => void query.refetch()}>Refresh</button>
        </p>
      )}
      {query.data && (
        <PlanEditor
          key={`${query.data.id}:${query.data.stateVersion}:${query.data.draft?.editNumber}`}
          plan={query.data}
        />
      )}
    </main>
  );
}

function PlanEditor({ plan }: { plan: Plan }) {
  const client = useQueryClient();
  const preferences = usePlanPreferences();
  const [name, setName] = useState(plan.displayName);
  const version = plan.draft ?? plan.locked;
  const requestKey = useRequestKey();
  const [description, setDescription] = useState(version?.description ?? '');
  const [startDate, setStartDate] = useState(version?.startDate ?? '');
  const [endDate, setEndDate] = useState(version?.endDate ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirm, setConfirm] = useState<'unlock' | 'discard' | 'archive' | 'unarchive' | null>(
    null,
  );
  const params = { path: { planId: plan.id } };
  const contentDirty =
    description !== (version?.description ?? '') ||
    startDate !== (version?.startDate ?? '') ||
    endDate !== (version?.endDate ?? '');
  const dirty = name !== plan.displayName || contentDirty;
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
  const mutation = useMutation({
    mutationFn: async (
      action:
        | 'save'
        | 'validate'
        | 'lock'
        | 'unlock'
        | 'discard'
        | 'rename'
        | 'activate'
        | 'deactivate'
        | 'archive'
        | 'unarchive',
    ) => {
      if (action === 'rename')
        return result(
          await api.PATCH('/api/v1/plans/{planId}', {
            params,
            body: { displayName: name.trim(), expectedStateVersion: plan.stateVersion },
          }),
        );
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
      if (action === 'validate') {
        const next = result(await api.POST('/api/v1/plans/{planId}/validate', { params }));
        setPreview(next);
        setAcknowledged(false);
        return null;
      }
      if (action === 'save' && plan.draft)
        return result(
          await api.PATCH('/api/v1/plans/{planId}/draft', {
            params,
            body: {
              expectedDraftId: plan.draft.id,
              expectedEditNumber: plan.draft.editNumber,
              description: description || null,
              startDate: startDate || null,
              endDate: endDate || null,
            },
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
      const header = { 'idempotency-key': requestKey({ action, body, preview, acknowledged }) };
      if (action === 'discard')
        return result(
          await api.POST('/api/v1/plans/{planId}/discard', { params: { ...params, header }, body }),
        );
      if (action === 'lock' && preview)
        return result(
          await api.POST('/api/v1/plans/{planId}/lock', {
            params: { ...params, header },
            body: {
              ...body,
              expectedContentHash: preview.contentHash,
              expectedValidationDigest: preview.validationDigest,
              acknowledgedWarningCodes: acknowledged
                ? preview.findings
                    .filter((finding) => finding.severity === 'warning')
                    .map((finding) => finding.code)
                : [],
            },
          }),
        );
      throw new Error('Refresh the plan before continuing.');
    },
    onSuccess: async (updated, action) => {
      if (updated === null) return;
      if (action === 'unlock' || action === 'activate')
        preferences.write({ planId: updated.id, view: updated.draft ? 'draft' : 'locked' });
      client.setQueryData(['plans', plan.id], updated);
      await client.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: () => {
      setPreview(null);
      setConfirm(null);
    },
  });
  function change() {
    setPreview(null);
    setAcknowledged(false);
    setConfirm(null);
  }
  const warnings = preview?.findings.some((f) => f.severity === 'warning') ?? false;
  return (
    <>
      <h1>{plan.displayName}</h1>
      <p>
        {plan.archived
          ? 'Archived · read-only'
          : plan.active
            ? 'Active · available in Plan'
            : 'Inactive · library only'}
      </p>
      <form
        className="plan-panel"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate('rename');
        }}
      >
        <label>
          Plan name
          <input
            required
            maxLength={200}
            disabled={plan.archived || mutation.isPending || contentDirty}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              change();
            }}
          />
        </label>
        {!plan.archived && (
          <button
            disabled={
              mutation.isPending ||
              !name.trim() ||
              name === plan.displayName ||
              description !== (version?.description ?? '') ||
              startDate !== (version?.startDate ?? '') ||
              endDate !== (version?.endDate ?? '')
            }
          >
            Rename plan
          </button>
        )}
        <p>The name is not versioned. Save any content edits before renaming.</p>
      </form>
      <div className="plan-actions">
        {plan.archived ? (
          <button disabled={mutation.isPending} onClick={() => setConfirm('unarchive')}>
            Unarchive plan…
          </button>
        ) : (
          <>
            <button
              disabled={dirty || mutation.isPending || !plan.locked}
              onClick={() => mutation.mutate(plan.active ? 'deactivate' : 'activate')}
            >
              {plan.active ? 'Deactivate plan' : 'Activate plan'}
            </button>
            <button disabled={dirty || mutation.isPending} onClick={() => setConfirm('archive')}>
              Archive plan…
            </button>
          </>
        )}
        {plan.active && (
          <Link
            to="/plan"
            onClick={() =>
              preferences.write({ planId: plan.id, view: plan.draft ? 'draft' : 'locked' })
            }
          >
            View schedule
          </Link>
        )}
      </div>
      {!plan.locked && !plan.archived && (
        <p>Lock the first version before activating. You can archive an unfinished draft.</p>
      )}
      {blocker.state === 'blocked' && (
        <section className="plan-panel" aria-label="Unsaved changes">
          <h2>Leave without saving?</h2>
          <p>Your unsaved field changes will be lost.</p>
          <button onClick={() => blocker.reset()}>Keep editing</button>{' '}
          <button onClick={() => blocker.proceed()}>Leave without saving</button>
        </section>
      )}
      <p className="plan-state">
        {plan.draft
          ? plan.locked
            ? `Unlocked · unpublished draft (current locked version ${plan.locked.versionNumber})`
            : 'Initial draft'
          : `Locked · version ${plan.locked?.versionNumber}`}
      </p>
      <p className="plan-id">Plan ID: {plan.id}</p>
      <p>
        {plan.draft ? (
          <Link to={`/plans/${plan.id}/brief`}>Edit brief and pace guides</Link>
        ) : (
          plan.locked && (
            <Link to={`/plans/${plan.id}/versions/${plan.locked.id}/brief`}>
              View brief and pace guides
            </Link>
          )
        )}
      </p>
      {plan.draft && (
        <Link to={`/plans/${plan.id}/draft`}>Inspect saved draft content and schedule</Link>
      )}
      {plan.locked && plan.draft && (
        <details className="plan-panel">
          <summary>Inspect preserved locked version {plan.locked.versionNumber}</summary>
          <p>
            {plan.locked.startDate} – {plan.locked.endDate}
          </p>
          <p>{plan.locked.description ?? 'No description.'}</p>
        </details>
      )}
      {plan.locked && (
        <p>
          Locked version {plan.locked.versionNumber} is preserved.{' '}
          {plan.draft ? 'Draft changes do not alter it.' : 'Unlock to make changes in a new draft.'}
        </p>
      )}
      {mutation.error && (
        <div role="alert" className="plan-panel">
          <p>{mutation.error.message}</p>
          <button onClick={() => void client.invalidateQueries({ queryKey: ['plans', plan.id] })}>
            Refresh latest plan
          </button>
          <p>Refreshing may replace unsaved edits. Copy them first if you need to keep them.</p>
        </div>
      )}
      <form
        className="plan-panel"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate('save');
        }}
      >
        <fieldset
          disabled={mutation.isPending || !plan.draft || plan.archived || name !== plan.displayName}
        >
          <label>
            Description
            <textarea
              maxLength={20000}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                change();
              }}
            />
          </label>
          <div className="plan-date-fields">
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  change();
                }}
              />
            </label>
            <label>
              End date
              <input
                type="date"
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  change();
                }}
              />
            </label>
          </div>
          {plan.draft && (
            <button className="primary-button" disabled={!dirty || name !== plan.displayName}>
              Save draft
            </button>
          )}
        </fieldset>
        {dirty && <p role="status">Unsaved changes. Save before validating.</p>}
      </form>
      {!plan.archived && (
        <div className="plan-actions">
          {plan.draft ? (
            <button
              disabled={dirty || mutation.isPending}
              onClick={() => mutation.mutate('validate')}
            >
              Validate and review lock
            </button>
          ) : (
            <button disabled={mutation.isPending} onClick={() => setConfirm('unlock')}>
              Unlock plan
            </button>
          )}
          {plan.draft && plan.locked && (
            <button disabled={mutation.isPending} onClick={() => setConfirm('discard')}>
              Discard draft…
            </button>
          )}
        </div>
      )}
      {confirm && (
        <section className="plan-panel" aria-label={`${confirm} confirmation`}>
          <h2>
            {confirm === 'archive'
              ? 'Archive this plan?'
              : confirm === 'unarchive'
                ? 'Unarchive this plan?'
                : confirm === 'unlock'
                  ? 'Create an editable draft?'
                  : 'Discard this draft?'}
          </h2>
          <p>
            {confirm === 'archive'
              ? 'This plan will be deactivated and become read-only. All saved draft content and locked versions are retained.'
              : confirm === 'unarchive'
                ? 'This restores the saved draft and locked state to your library. The plan will remain inactive until you activate it.'
                : confirm === 'unlock'
                  ? 'The current locked version and all its content will be copied into a draft. The locked version stays unchanged.'
                  : `All draft changes${dirty ? ', including your unsaved edits,' : ''} will be permanently removed. Locked version ${plan.locked?.versionNumber} stays unchanged.`}
          </p>
          <button disabled={mutation.isPending} onClick={() => mutation.mutate(confirm)}>
            {`Confirm ${confirm}`}
          </button>{' '}
          <button disabled={mutation.isPending} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </section>
      )}
      {preview && (
        <section className="plan-panel" aria-label="Lock review">
          <h2>Review before locking</h2>
          <p>Draft edit {preview.editNumber}. Locking makes this version immutable.</p>
          {plan.draft?.basedOnVersionId &&
            plan.locked &&
            plan.draft.basedOnVersionId !== plan.locked.id && (
              <p>
                Warning: this draft was restored from an older version. Locking it replaces the
                current schedule with the restored content while preserving all previous versions.
              </p>
            )}
          {!preview.hasChanges && (
            <p>
              No content changes since the locked version. Edit the draft or discard it; no new
              version will be created.
            </p>
          )}
          <p>Changed fields: {preview.summary.headerChanges.join(', ') || 'none'}.</p>
          <ul>
            {preview.summary.affectedWorkouts?.map((workout, index) => (
              <li key={index}>
                {workout.change}: {workout.date} · {workout.title}
                {workout.previousDate && workout.previousDate !== workout.date
                  ? ` (was ${workout.previousDate})`
                  : ''}
              </li>
            ))}
          </ul>
          <ul>
            {Object.entries(preview.summary.entities)
              .filter(([, counts]) => counts.added || counts.changed || counts.removed)
              .map(([entity, counts]) => (
                <li key={entity}>
                  {entity.replaceAll('_', ' ')}: {counts.added} added, {counts.changed} changed,{' '}
                  {counts.removed} removed.
                </li>
              ))}
          </ul>
          <ul>
            {preview.findings.map((finding, index) => (
              <li key={`${finding.code}:${index}`}>
                <strong>{finding.severity === 'error' ? 'Error' : 'Warning'}:</strong>{' '}
                {finding.message}
              </li>
            ))}
          </ul>
          {preview.findings.length === 0 && <p>No validation issues.</p>}
          {warnings && (
            <label className="plan-acknowledgement">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I have reviewed and accept all warnings listed above.
            </label>
          )}
          <button
            className="primary-button"
            disabled={
              mutation.isPending ||
              !preview.hasChanges ||
              preview.findings.some((f) => f.severity === 'error') ||
              (warnings && !acknowledged)
            }
            onClick={() => mutation.mutate('lock')}
          >
            Confirm and lock version
          </button>
        </section>
      )}
      {mutation.isPending && <p role="status">Working…</p>}
      <PlanHistory planId={plan.id} basedOnVersionId={plan.draft?.basedOnVersionId ?? null} />
    </>
  );
}
