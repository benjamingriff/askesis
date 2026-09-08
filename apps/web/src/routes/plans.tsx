import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router';
import type { paths } from '@askesis/api-client';
import { api } from '../api';

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

export function PlansPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const requestKey = useRequestKey();
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: async () => result(await api.GET('/api/v1/plans')).plans,
  });
  const create = useMutation({
    mutationFn: async () =>
      result(
        await api.POST('/api/v1/plans', {
          params: { header: { 'idempotency-key': requestKey(name.trim()) } },
          body: { displayName: name.trim() },
        }),
      ),
    onSuccess: async (plan) => {
      await client.invalidateQueries({ queryKey: ['plans'] });
      void navigate(`/plans/${plan.id}`);
    },
  });
  return (
    <main className="plan-lifecycle">
      <p className="page-kicker">Your training</p>
      <h1>Plan library</h1>
      <p>
        Create a plan, edit a draft, then review and lock a version. Plans remain private to your
        account.
      </p>
      <form
        className="plan-panel"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label>
          Plan name
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="primary-button" disabled={create.isPending || !name.trim()}>
          Create plan
        </button>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>
      {plans.isPending && <p role="status">Loading plans…</p>}
      {plans.error && (
        <p role="alert">
          {plans.error.message} <button onClick={() => void plans.refetch()}>Retry</button>
        </p>
      )}
      {plans.data?.length === 0 && <p>No plans yet. Create your first draft above.</p>}
      <ul className="plan-library-list">
        {plans.data?.map((plan) => (
          <li key={plan.id}>
            <Link to={`/plans/${plan.id}`}>
              <strong>{plan.displayName}</strong>
              <span>
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
  const version = plan.draft ?? plan.locked;
  const requestKey = useRequestKey();
  const [description, setDescription] = useState(version?.description ?? '');
  const [startDate, setStartDate] = useState(version?.startDate ?? '');
  const [endDate, setEndDate] = useState(version?.endDate ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirm, setConfirm] = useState<'unlock' | 'discard' | null>(null);
  const params = { path: { planId: plan.id } };
  const dirty =
    description !== (version?.description ?? '') ||
    startDate !== (version?.startDate ?? '') ||
    endDate !== (version?.endDate ?? '');
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
    mutationFn: async (action: 'save' | 'validate' | 'lock' | 'unlock' | 'discard') => {
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
    onSuccess: async (updated) => {
      if (updated === null) return;
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
  }
  const warnings = preview?.findings.some((f) => f.severity === 'warning') ?? false;
  return (
    <>
      <h1>{plan.displayName}</h1>
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
            ? `Unlocked · editing a draft based on version ${plan.locked.versionNumber}`
            : 'Initial draft'
          : `Locked · version ${plan.locked?.versionNumber}`}
      </p>
      <p className="plan-id">Plan ID: {plan.id}</p>
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
        <fieldset disabled={mutation.isPending || !plan.draft || plan.archived}>
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
            <button className="primary-button" disabled={!dirty}>
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
          <h2>{confirm === 'unlock' ? 'Create an editable draft?' : 'Discard this draft?'}</h2>
          <p>
            {confirm === 'unlock'
              ? 'The current locked version and all its content will be copied into a draft. The locked version stays unchanged.'
              : `All draft changes${dirty ? ', including your unsaved edits,' : ''} will be permanently removed. Locked version ${plan.locked?.versionNumber} stays unchanged.`}
          </p>
          <button disabled={mutation.isPending} onClick={() => mutation.mutate(confirm)}>
            {confirm === 'unlock' ? 'Confirm unlock' : 'Confirm discard'}
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
          {!preview.hasChanges && (
            <p>
              No content changes since the locked version. Edit the draft or discard it; no new
              version will be created.
            </p>
          )}
          <p>Changed fields: {preview.summary.headerChanges.join(', ') || 'none'}.</p>
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
    </>
  );
}
