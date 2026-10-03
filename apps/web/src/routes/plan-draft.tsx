import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, TriangleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { CoverageSummary } from '../components/PlanningReview';
import { Schedule } from '../components/Schedule';
import { Card, ErrorState, LoadingState, Pill } from '../components/ui';
import { formatRange } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import { result } from '../lib/result';
import { knownCoverage, useBriefState, useWorkouts } from '../plan-data';
import { useUnits } from '../settings';

/** Read-only inspection of saved draft content, including the raw aggregate for debugging. */
export function PlanDraftPage() {
  const today = useLocalToday();
  const { planId = '' } = useParams();
  const draft = useQuery({
    queryKey: ['plans', planId, 'draft-content'],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/draft', { params: { path: { planId } } })),
  });
  const version = draft.data?.version ?? null;
  const brief = useBriefState(planId, version ? { ...version, state: 'draft' } : null);
  const workouts = useWorkouts(version);
  const units = useUnits(brief.data?.brief.unit);
  return (
    <div className="page">
      <Link to={`/plans/${planId}`} className="back-link">
        <ArrowLeft size={15} aria-hidden="true" /> Plan details
      </Link>
      <header className="page-header">
        <div className="page-heading">
          <span className="label">Draft inspection</span>
          <h1>Saved draft content</h1>
          <p className="muted">
            Read-only view of saved, unpublished content. This is not the locked schedule.
          </p>
        </div>
      </header>
      {draft.isPending ? <LoadingState>Loading draft…</LoadingState> : null}
      {draft.error ? (
        <ErrorState message={draft.error.message} onRetry={() => void draft.refetch()} />
      ) : null}
      {draft.data && version ? (
        <>
          <Card>
            <div className="plan-meta">
              <Pill tone="accent">Draft edit {version.editNumber}</Pill>
              <span className="muted">{formatRange(version.startDate, version.endDate)}</span>
            </div>
            {version.description ? <p>{version.description}</p> : null}
            {brief.data ? <CoverageSummary state={brief.data} /> : null}
          </Card>
          <Card>
            <h2 className="card-title">Current validation findings</h2>
            {draft.data.findings.length === 0 ? (
              <p className="muted">No validation findings.</p>
            ) : (
              <ul className="finding-list">
                {draft.data.findings.map((finding, index) => (
                  <li key={index} className={finding.severity}>
                    {finding.severity === 'error' ? (
                      <CircleAlert size={16} aria-hidden="true" />
                    ) : (
                      <TriangleAlert size={16} aria-hidden="true" />
                    )}
                    <span>{finding.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <details className="card technical">
            <summary>Technical details</summary>
            <pre className="version-content">{JSON.stringify(draft.data.content, null, 2)}</pre>
          </details>
        </>
      ) : null}
      {version && (workouts.isPending || brief.isPending) ? (
        <LoadingState>Loading draft schedule…</LoadingState>
      ) : null}
      {workouts.error ? (
        <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
      ) : null}
      {brief.error ? (
        <ErrorState
          message={`Couldn’t load this draft’s coverage: ${brief.error.message}`}
          onRetry={() => void brief.refetch()}
        />
      ) : null}
      {version && workouts.data && brief.data && !brief.error ? (
        <Schedule
          workouts={workouts.data}
          version={version}
          startDate={version.startDate}
          endDate={version.endDate}
          coverage={knownCoverage(brief.data)}
          units={units}
          today={today}
        />
      ) : null}
    </div>
  );
}
