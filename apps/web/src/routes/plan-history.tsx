import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, ClipboardList, History, Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { paths } from '@askesis/api-client';
import { api } from '../api';
import { Schedule } from '../components/Schedule';
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  ErrorState,
  LoadingState,
  Notice,
  Pill,
} from '../components/ui';
import { formatDateTime, formatRange, formatShort } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import { result } from '../lib/result';
import { useRequestKey } from '../lib/use-request-key';
import { knownCoverage, useBriefState, usePlan, useWorkouts } from '../plan-data';
import { usePlanPreferences } from '../plan-selection';
import { useUnits } from '../settings';

type Preview =
  paths['/api/v1/plans/{planId}/revisions/{revisionId}/restore-preview']['post']['responses'][200]['content']['application/json'];

export function PlanHistory({
  planId,
  basedOnVersionId,
}: {
  planId: string;
  basedOnVersionId?: string | null | undefined;
}) {
  const history = useQuery({
    queryKey: ['plans', planId, 'history'],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/revisions', { params: { path: { planId } } })),
  });
  const revisions = [...(history.data?.revisions ?? [])].sort(
    (a, b) => b.versionNumber - a.versionNumber,
  );
  const basis = revisions.find((revision) => revision.id === basedOnVersionId);
  return (
    <section className="history" aria-label="Version history">
      {basis ? (
        <p className="muted">The editable draft is based on version {basis.versionNumber}.</p>
      ) : null}
      {history.isPending ? <LoadingState>Loading history…</LoadingState> : null}
      {history.error ? (
        <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />
      ) : null}
      {!history.isPending && !history.error && revisions.length === 0 ? (
        <p className="muted">No locked versions yet.</p>
      ) : null}
      <ol className="timeline">
        {revisions.map((revision) => (
          <li key={revision.id}>
            <span className="timeline-dot" aria-hidden="true">
              <Lock size={11} />
            </span>
            <div>
              <Link to={`/plans/${planId}/versions/${revision.id}`}>
                Version {revision.versionNumber}
              </Link>
              <small>
                {revision.lockedAt ? `Locked ${formatDateTime(revision.lockedAt)} · ` : ''}
                {formatRange(revision.startDate, revision.endDate)}
              </small>
              {revision.description ? <p>{revision.description}</p> : null}
            </div>
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
  const today = useLocalToday();
  const client = useQueryClient();
  const navigate = useNavigate();
  const preferences = usePlanPreferences();
  const params = { path: { planId, revisionId } };
  const plan = usePlan(planId);
  const detail = useQuery({
    queryKey: ['plans', planId, 'revision', revisionId],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/revisions/{revisionId}', { params })),
  });
  const revision = detail.data?.revision;
  const workouts = useWorkouts(
    revision ? { id: revisionId, editNumber: revision.editNumber } : null,
  );
  // The revision brief carries the coverage saved with this version.
  const brief = useBriefState(
    planId,
    revision ? { ...revision, id: revisionId, state: 'locked' } : null,
  );
  const units = useUnits(brief.data?.brief.unit);
  const [preview, setPreview] = useState<Preview | null>(null);
  const requestKey = useRequestKey();
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
      return result(
        await api.POST('/api/v1/plans/{planId}/revisions/{revisionId}/restore', {
          params: { ...params, header: { 'idempotency-key': requestKey(body) } },
          body,
        }),
      );
    },
    onSuccess: async (updated) => {
      if (!updated) return;
      preferences.write({ planId, view: 'draft' });
      client.setQueryData(['plans', planId], updated);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['plan-workouts'] }),
      ]);
      void navigate(`/plans/${planId}`);
    },
    onError: () => setPreview(null),
  });
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
  const current = plan.data?.locked?.id === revisionId;
  const blocked = plan.data?.archived
    ? 'Unarchive this plan before restoring.'
    : plan.data?.draft
      ? 'Lock or discard the existing draft before restoring.'
      : current
        ? 'This is already the current locked version.'
        : null;
  const freshPreview =
    preview &&
    plan.data?.stateVersion === preview.stateVersion &&
    plan.data.locked?.id === preview.currentVersionId;
  return (
    <div className="page">
      <Link to={`/plans/${planId}`} className="back-link">
        <ArrowLeft size={15} aria-hidden="true" /> {plan.data?.displayName ?? 'Plan details'}
      </Link>
      {plan.isPending || detail.isPending ? <LoadingState>Loading version…</LoadingState> : null}
      {plan.error || detail.error ? (
        <ErrorState
          message={plan.error?.message ?? detail.error?.message ?? ''}
          onRetry={() => {
            void plan.refetch();
            void detail.refetch();
          }}
        />
      ) : null}
      {revision ? (
        <>
          <header className="page-header">
            <div className="page-heading">
              <span className="label">Version history</span>
              <h1>Version {revision.versionNumber}</h1>
              <div className="plan-meta">
                <Pill tone="locked" icon={Lock}>
                  {current ? 'Current locked version' : 'Historical version'}
                </Pill>
                {plan.data?.archived ? <Pill>Archived plan</Pill> : null}
                <span className="muted">{formatRange(revision.startDate, revision.endDate)}</span>
              </div>
            </div>
            <div className="plan-toolbar">
              <ButtonLink to={`/plans/${planId}/versions/${revisionId}/brief`} icon={ClipboardList}>
                Brief &amp; pace guides
              </ButtonLink>
              <Button
                variant="primary"
                icon={History}
                disabled={!plan.data || !!blocked || mutation.isPending}
                busy={mutation.isPending && !preview}
                onClick={() => mutation.mutate('preview')}
              >
                Review restore as draft
              </Button>
            </div>
          </header>
          {blocked ? <Notice icon={CircleAlert}>{blocked}</Notice> : null}
          {mutation.error ? (
            <ErrorState message={mutation.error.message} onRetry={() => void plan.refetch()} />
          ) : null}
          <div className="revision-grid">
            <Card>
              <h2 className="card-title">About this version</h2>
              <p>{revision.description ?? 'No description.'}</p>
              <ul className="plain-list muted">
                {revision.lockedAt ? <li>Locked {formatDateTime(revision.lockedAt)}</li> : null}
                {basedOn ? <li>Based on version {basedOn.versionNumber}.</li> : null}
                {supersedes ? (
                  <li>Replaced version {supersedes.versionNumber} when locked.</li>
                ) : null}
              </ul>
            </Card>
            <Card>
              <h2 className="card-title">Changes saved with this version</h2>
              <ChangeSummary summary={revision.summary} />
            </Card>
            <Card>
              <h2 className="card-title">Validation at lock time</h2>
              {revision.findings.length === 0 ? (
                <p className="muted">No validation findings.</p>
              ) : (
                <ul className="finding-list">
                  {revision.findings.map((finding, index) => (
                    <li key={index} className={finding.severity}>
                      <TriangleAlert size={16} aria-hidden="true" />
                      <span>
                        {finding.message}
                        {revision.acknowledgedWarningCodes.includes(finding.code)
                          ? ' (acknowledged)'
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <details className="card technical">
            <summary>Technical details</summary>
            <p className="muted">
              Validator version {revision.validatorVersion} · content hash{' '}
              <code>{revision.contentHash?.slice(0, 12)}</code>
            </p>
            <pre className="version-content">{JSON.stringify(detail.data?.content, null, 2)}</pre>
          </details>
          {preview && !freshPreview ? (
            <Notice tone="warning" role="alert">
              The plan changed. Review the restore again before confirming.
            </Notice>
          ) : null}
          <Dialog
            open={!!freshPreview && !blocked}
            busy={mutation.isPending}
            onClose={() => setPreview(null)}
            title={`Restore version ${revision.versionNumber} as a draft?`}
            footer={
              <>
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  icon={History}
                  busy={mutation.isPending}
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate('restore')}
                >
                  Confirm restore as draft
                </Button>
              </>
            }
          >
            <p>
              This creates an editable draft from version {revision.versionNumber}. Current locked
              version {plan.data?.locked?.versionNumber} and all history remain unchanged.
            </p>
            <Notice tone="warning" icon={TriangleAlert}>
              Locking this restored draft later will replace the current schedule with this older
              content. It creates a new version, not a rollback of history.
            </Notice>
            {preview ? <ChangeSummary summary={preview.summary} /> : null}
          </Dialog>
          {workouts.isPending || brief.isPending ? (
            <LoadingState>Loading historical schedule…</LoadingState>
          ) : null}
          {workouts.error ? (
            <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
          ) : null}
          {brief.error ? (
            <ErrorState
              message={`Couldn’t load this version’s coverage: ${brief.error.message}`}
              onRetry={() => void brief.refetch()}
            />
          ) : null}
          {workouts.data && brief.data && !brief.error ? (
            <Schedule
              presentation="week-list"
              workouts={workouts.data}
              version={revision}
              startDate={revision.startDate}
              endDate={revision.endDate}
              coverage={knownCoverage(brief.data)}
              units={units}
              today={today}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ChangeSummary({ summary }: { summary: Preview['summary'] }) {
  const entities = Object.entries(summary.entities).filter(
    ([, counts]) => counts.added || counts.changed || counts.removed,
  );
  return (
    <div className="change-summary">
      <p className="muted">Changed fields: {summary.headerChanges.join(', ') || 'none'}.</p>
      {summary.affectedWorkouts?.length ? (
        <ul className="change-list">
          {summary.affectedWorkouts.map((workout, index) => (
            <li key={index}>
              <Pill tone="accent">{workout.change}</Pill>
              <span>
                {formatShort(workout.date)} · {workout.title}
                {workout.previousDate && workout.previousDate !== workout.date
                  ? ` (was ${formatShort(workout.previousDate)})`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {entities.length ? (
        <ul className="plain-list">
          {entities.map(([name, counts]) => (
            <li key={name}>
              {name.replaceAll('_', ' ')}: {counts.added} added, {counts.changed} changed,{' '}
              {counts.removed} removed.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
