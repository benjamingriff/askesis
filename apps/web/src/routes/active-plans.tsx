import { CurrentCoverage } from '../components/PlanningReview';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { usePlanPreferences, type PlanSelection } from '../plan-selection';
import { WorkoutsPage } from './workouts';

export function ActivePlansPage() {
  const preferences = usePlanPreferences();
  const [selection, setSelection] = useState<PlanSelection | null>(() => preferences.read());
  const plans = useQuery({
    queryKey: ['plans', 'collection', 'active'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/plans', {
        params: { query: { collection: 'active' } },
      });
      if (!data) throw new Error(error?.error.message ?? 'Could not load active plans.');
      return data.plans;
    },
  });
  const plan = plans.data?.find((item) => item.id === selection?.planId) ?? plans.data?.[0];
  const view =
    selection?.planId === plan?.id && selection?.view === 'draft' && plan?.draft
      ? 'draft'
      : 'locked';
  const version = view === 'draft' ? plan?.draft : plan?.locked;
  const workouts = useQuery({
    queryKey: ['plan-workouts', version?.id, version?.editNumber],
    enabled: !!version,
    queryFn: async () => {
      if (!version) throw new Error('Select a version first.');
      const { data, error } = await api.GET('/api/v1/workouts', {
        params: { query: { planVersionId: version.id } },
      });
      if (!data) throw new Error(error?.error.message ?? 'Could not load this schedule.');
      return data.workouts;
    },
  });
  function select(next: PlanSelection) {
    setSelection(next);
    preferences.write(next);
  }
  return (
    <>
      <section className="plan-selector plan-panel" aria-label="Plan selection">
        <Link to="/plans">Manage plans</Link>
        {plans.isPending && <p role="status">Loading active plans…</p>}
        {plans.error && (
          <p role="alert">
            {plans.error.message} <button onClick={() => void plans.refetch()}>Retry</button>
          </p>
        )}
        {plans.data?.length === 0 && (
          <>
            <h1>No active plans</h1>
            <p>Lock and activate a plan from the library to see its schedule here.</p>
          </>
        )}
        {plan && (
          <>
            <label>
              Active plan
              <select
                value={plan.id}
                onChange={(event) => select({ planId: event.target.value, view: 'locked' })}
              >
                {plans.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Content source
              <select
                value={view}
                onChange={(event) =>
                  select({
                    planId: plan.id,
                    view: event.target.value === 'draft' ? 'draft' : 'locked',
                  })
                }
              >
                <option value="locked">Locked · version {plan.locked?.versionNumber}</option>
                {plan.draft && <option value="draft">Unpublished draft</option>}
              </select>
            </label>
            <p>
              {view === 'draft'
                ? 'Viewing unpublished draft content. The locked schedule is unchanged.'
                : `Viewing the stable locked version ${plan.locked?.versionNumber}.`}
            </p>
            <p>
              {version?.startDate} – {version?.endDate}
            </p>
            {version?.description && <p>{version.description}</p>}
            {version && (
              <CurrentCoverage planId={plan.id} versionId={version.id} draft={view === 'draft'} />
            )}
            <Link to={`/plans/${plan.id}`}>Plan details</Link>
          </>
        )}
      </section>
      {version && workouts.isPending && (
        <p role="status" className="plan-selector">
          Loading schedule…
        </p>
      )}
      {version && workouts.error && (
        <p role="alert" className="plan-selector">
          {workouts.error.message} <button onClick={() => void workouts.refetch()}>Retry</button>
        </p>
      )}
      {plan && version && workouts.data && (
        <WorkoutsPage key={version.id} workouts={workouts.data} title={plan.displayName} />
      )}
    </>
  );
}
