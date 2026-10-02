import { CurrentCoverage } from '../components/PlanningReview';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { WorkoutsPage } from './workouts';

export function PlanDraftPage() {
  const { planId = '' } = useParams();
  const draft = useQuery({
    queryKey: ['plans', planId, 'draft-content'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/plans/{planId}/draft', {
        params: { path: { planId } },
      });
      if (!data) throw new Error(error?.error.message ?? 'Could not load the draft.');
      return data;
    },
  });
  const version = draft.data?.version;
  const workouts = useQuery({
    queryKey: ['plan-workouts', version?.id, version?.editNumber],
    enabled: !!version,
    queryFn: async () => {
      if (!version) throw new Error('Draft unavailable.');
      const { data, error } = await api.GET('/api/v1/workouts', {
        params: { query: { planVersionId: version.id } },
      });
      if (!data) throw new Error(error?.error.message ?? 'Could not load the draft schedule.');
      return data.workouts;
    },
  });
  return (
    <>
      <main className="plan-lifecycle">
        <Link to={`/plans/${planId}`}>← Plan details</Link>
        <h1>Saved draft inspection</h1>
        <p>Read-only view of saved, unpublished content. This is not the locked schedule.</p>
        {draft.isPending && <p role="status">Loading draft…</p>}
        {draft.error && (
          <p role="alert">
            {draft.error.message} <button onClick={() => void draft.refetch()}>Retry</button>
          </p>
        )}
        {draft.data && (
          <>
            <p>
              Draft edit {version?.editNumber} · {version?.startDate ?? 'No start date'} –{' '}
              {version?.endDate ?? 'No end date'}
            </p>
            <p>{version?.description}</p>
            {version && <CurrentCoverage planId={planId} versionId={version.id} draft />}
            <h2>Current validation findings</h2>
            <ul>
              {draft.data.findings.map((finding, index) => (
                <li key={index}>
                  {finding.severity}: {finding.message}
                </li>
              ))}
            </ul>
            <details className="plan-panel">
              <summary>Complete saved content (JSON)</summary>
              <pre className="version-content">{JSON.stringify(draft.data.content, null, 2)}</pre>
            </details>
          </>
        )}
        {version && workouts.isPending && <p role="status">Loading draft schedule…</p>}
        {version && workouts.error && (
          <p role="alert">
            {workouts.error.message}{' '}
            <button onClick={() => void workouts.refetch()}>Retry schedule</button>
          </p>
        )}
      </main>
      {version && workouts.data && (
        <WorkoutsPage key={version.id} workouts={workouts.data} title="Saved draft schedule" />
      )}
    </>
  );
}
