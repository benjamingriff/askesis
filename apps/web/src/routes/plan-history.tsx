import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { paths } from '@askesis/api-client';
import { api } from '../api';
import { usePlanPreferences } from '../plan-selection';
import { WorkoutsPage } from './workouts';

type Preview =
  paths['/api/v1/plans/{planId}/revisions/{revisionId}/restore-preview']['post']['responses'][200]['content']['application/json'];
function result<T>({ data, error }: { data?: T; error?: unknown }): T {
  if (data !== undefined) return data;
  throw new Error(
    (error as { error?: { message?: string } })?.error?.message ??
      'Request failed. Check your connection and retry.',
  );
}

export function PlanHistory({
  planId,
  basedOnVersionId,
}: {
  planId: string;
  basedOnVersionId?: string | null;
}) {
  const history = useQuery({
    queryKey: ['plans', planId, 'history'],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/revisions', { params: { path: { planId } } })),
  });
  const revisions = history.data?.revisions ?? [];
  const basis = revisions.find((revision) => revision.id === basedOnVersionId);
  return (
    <section className="plan-panel" aria-label="Version history">
      <h2>Version history</h2>
      {basis && <p>The editable draft is based on version {basis.versionNumber}.</p>}
      {history.isPending && <p role="status">Loading history…</p>}
      {history.error && (
        <p role="alert">
          {history.error.message}{' '}
          <button onClick={() => void history.refetch()}>Retry history</button>
        </p>
      )}
      {!history.isPending && !history.error && revisions.length === 0 && (
        <p>No locked versions yet.</p>
      )}
      <ol>
        {revisions.map((revision) => (
          <li key={revision.id}>
            <Link to={`/plans/${planId}/versions/${revision.id}`}>
              Version {revision.versionNumber}
            </Link>
            {' · '}
            {revision.startDate} – {revision.endDate}
            <p>{revision.description ?? 'No description.'}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PlanRevisionPage() {
  const { planId = '', revisionId = '' } = useParams();
  return <RevisionView key={`${planId}:${revisionId}`} planId={planId} revisionId={revisionId} />;
}
function RevisionView({ planId, revisionId }: { planId: string; revisionId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const preferences = usePlanPreferences();
  const params = { path: { planId, revisionId } };
  const plan = useQuery({
    queryKey: ['plans', planId],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}', { params: { path: { planId } } })),
  });
  const detail = useQuery({
    queryKey: ['plans', planId, 'revision', revisionId],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/revisions/{revisionId}', { params })),
  });
  const workouts = useQuery({
    queryKey: ['plan-workouts', revisionId],
    enabled: !!detail.data,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/workouts', { params: { query: { planVersionId: revisionId } } }),
      ).workouts,
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const keys = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationFn: async (action: 'preview' | 'restore') => {
      if (action === 'preview') {
        setPreview(
          result(
            await api.POST('/api/v1/plans/{planId}/revisions/{revisionId}/restore-preview', {
              params,
            }),
          ),
        );
        return null;
      }
      if (!preview) throw new Error('Review the restore preview first.');
      const body = {
        expectedStateVersion: preview.stateVersion,
        expectedCurrentVersionId: preview.currentVersionId,
        expectedSourceHash: preview.sourceHash,
      };
      const signature = JSON.stringify(body);
      const key = keys.current.get(signature) ?? crypto.randomUUID();
      keys.current.set(signature, key);
      return result(
        await api.POST('/api/v1/plans/{planId}/revisions/{revisionId}/restore', {
          params: { ...params, header: { 'idempotency-key': key } },
          body,
        }),
      );
    },
    onSuccess: async (updated) => {
      if (!updated) return;
      preferences.write({ planId, view: 'draft' });
      client.setQueryData(['plans', planId], updated);
      await client.invalidateQueries({ queryKey: ['plans'] });
      void navigate(`/plans/${planId}`);
    },
    onError: () => setPreview(null),
  });
  const revision = detail.data?.revision;
  const history = useQuery({
    queryKey: ['plans', planId, 'history'],
    enabled: !!revision,
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/revisions', { params: { path: { planId } } })),
  });
  const basedOn = history.data?.revisions?.find((item) => item.id === revision?.basedOnVersionId);
  const supersedes = history.data?.revisions?.find(
    (item) => item.id === revision?.supersedesVersionId,
  );
  const blocked = plan.data?.archived
    ? 'Unarchive this plan before restoring.'
    : plan.data?.draft
      ? 'Lock or discard the existing draft before restoring.'
      : plan.data?.locked?.id === revisionId
        ? 'This is already the current locked version.'
        : null;
  const freshPreview =
    preview &&
    plan.data?.stateVersion === preview.stateVersion &&
    plan.data.locked?.id === preview.currentVersionId;
  return (
    <>
      <main className="plan-lifecycle">
        <Link to={`/plans/${planId}`}>← Plan details</Link>
        {(plan.isPending || detail.isPending) && <p role="status">Loading version…</p>}
        {(plan.error || detail.error) && (
          <p role="alert">
            {plan.error?.message ?? detail.error?.message}{' '}
            <button
              onClick={() => {
                void plan.refetch();
                void detail.refetch();
              }}
            >
              Retry
            </button>
          </p>
        )}
        {revision && (
          <>
            <h1>
              {plan.data?.displayName} · Version {revision.versionNumber}
            </h1>
            <p>Immutable historical content{plan.data?.archived ? ' · archived plan' : ''}.</p>
            <Link to={`/plans/${planId}/versions/${revisionId}/brief`}>
              View this version’s brief and pace guides
            </Link>
            {basedOn && <p>Based on version {basedOn.versionNumber}.</p>}
            {supersedes && <p>Replaced version {supersedes.versionNumber} when locked.</p>}
            <p>
              {revision.startDate} – {revision.endDate}
            </p>
            <p>{revision.description ?? 'No description.'}</p>
            <p>
              Locked {revision.lockedAt ? new Date(revision.lockedAt).toLocaleString() : ''}.
              Validator version {revision.validatorVersion}.
            </p>
            <section className="plan-panel">
              <h2>Saved change summary</h2>
              <ChangeSummary summary={revision.summary} />
            </section>
            <section className="plan-panel">
              <h2>Validation at lock time</h2>
              <ul>
                {revision.findings.map((finding, index) => (
                  <li key={index}>
                    {finding.severity}: {finding.message}
                    {revision.acknowledgedWarningCodes.includes(finding.code)
                      ? ' (acknowledged)'
                      : ''}
                  </li>
                ))}
              </ul>
              {revision.findings.length === 0 && <p>No validation findings.</p>}
            </section>
            <details className="plan-panel">
              <summary>Inspect complete version content (JSON)</summary>
              <pre className="version-content">{JSON.stringify(detail.data?.content, null, 2)}</pre>
            </details>
            {blocked && <p>{blocked}</p>}
            <button
              disabled={!plan.data || !!blocked || mutation.isPending}
              onClick={() => mutation.mutate('preview')}
            >
              Review restore as draft
            </button>
            {preview && !freshPreview && (
              <p role="alert">The plan changed. Review the restore again before confirming.</p>
            )}
            {freshPreview && !blocked && (
              <section className="plan-panel" aria-label="Restore confirmation">
                <h2>Restore version {revision.versionNumber} as a draft?</h2>
                <p>
                  This creates an editable draft from version {revision.versionNumber}. Current
                  locked version {plan.data?.locked?.versionNumber} and all history remain
                  unchanged.
                </p>
                <p>
                  Warning: locking this restored draft later will replace the current schedule with
                  this older content. It creates a new version, not a rollback of history.
                </p>
                <ChangeSummary summary={preview.summary} />
                <button disabled={mutation.isPending} onClick={() => mutation.mutate('restore')}>
                  Confirm restore as draft
                </button>{' '}
                <button disabled={mutation.isPending} onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </section>
            )}
          </>
        )}
        {mutation.error && (
          <p role="alert">
            {mutation.error.message}{' '}
            <button onClick={() => void plan.refetch()}>Refresh plan</button>
          </p>
        )}
        {mutation.isPending && <p role="status">Working…</p>}
      </main>
      {detail.data && workouts.isPending && (
        <p className="plan-selector" role="status">
          Loading historical schedule…
        </p>
      )}
      {detail.data && workouts.error && (
        <p className="plan-selector" role="alert">
          {workouts.error.message}{' '}
          <button onClick={() => void workouts.refetch()}>Retry schedule</button>
        </p>
      )}
      {detail.data && workouts.data && (
        <WorkoutsPage
          workouts={workouts.data}
          title={`Version ${revision?.versionNumber} schedule`}
        />
      )}
    </>
  );
}

function ChangeSummary({ summary }: { summary: Preview['summary'] }) {
  return (
    <>
      <p>Changed fields: {summary.headerChanges.join(', ') || 'none'}.</p>
      <ul>
        {summary.affectedWorkouts?.map((workout, index) => (
          <li key={index}>
            {workout.change}: {workout.date} · {workout.title}
            {workout.previousDate && workout.previousDate !== workout.date
              ? ` (was ${workout.previousDate})`
              : ''}
          </li>
        ))}
      </ul>
      <ul>
        {Object.entries(summary.entities)
          .filter(([, counts]) => counts.added || counts.changed || counts.removed)
          .map(([name, counts]) => (
            <li key={name}>
              {name.replaceAll('_', ' ')}: {counts.added} added, {counts.changed} changed,{' '}
              {counts.removed} removed.
            </li>
          ))}
      </ul>
    </>
  );
}
