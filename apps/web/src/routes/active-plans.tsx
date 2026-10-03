import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Library, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { PlanView } from '../components/PlanView';
import { ButtonLink, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { result } from '../lib/result';
import { usePlanPreferences, type PlanSelection } from '../plan-selection';

export function useActivePlans() {
  return useQuery({
    queryKey: ['plans', 'collection', 'active'],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans', { params: { query: { collection: 'active' } } })).plans,
  });
}

/** The Plan tab: the active plan the athlete is following, with any others one switch away. */
export function ActivePlansPage() {
  const preferences = usePlanPreferences();
  const [selection, setSelection] = useState<PlanSelection | null>(() => preferences.read());
  const plans = useActivePlans();
  const activePlans = plans.data ?? [];
  const plan = activePlans.find((item) => item.id === selection?.planId) ?? activePlans[0];
  const view =
    selection?.planId === plan?.id && selection?.view === 'draft' && plan?.draft
      ? 'draft'
      : 'locked';
  // A failed background refresh keeps the cached collection on screen with a retry.
  const refreshError = plans.error ? (
    <ErrorState message={plans.error.message} onRetry={() => void plans.refetch()} />
  ) : null;

  function select(next: PlanSelection) {
    setSelection(next);
    preferences.write(next);
  }

  if (plans.isPending)
    return (
      <div className="page">
        <LoadingState>Loading your plan…</LoadingState>
      </div>
    );
  if (!plan)
    return (
      <div className="page">
        {refreshError}
        <header className="page-header">
          <div className="page-heading">
            <h1>Plan</h1>
          </div>
        </header>
        {plans.data ? (
          <EmptyState
            icon={CalendarDays}
            title="No active plans"
            action={
              <div className="button-row">
                <ButtonLink to="/chat" variant="primary" icon={MessageSquare}>
                  Plan with your coach
                </ButtonLink>
                <ButtonLink to="/plans" icon={Library}>
                  All plans
                </ButtonLink>
              </div>
            }
          >
            Lock and activate a plan from your library to see its schedule here, or start one with
            your coach.
          </EmptyState>
        ) : null}
      </div>
    );

  return (
    <>
      {refreshError}
      <PlanView
        key={plan.id}
        plan={plan}
        view={view}
        onViewChange={(next) => select({ planId: plan.id, view: next })}
        switcher={
          activePlans.length > 1 ? (
            <label className="plan-switcher">
              <span className="sr-only">Active plan</span>
              <select
                value={plan.id}
                onChange={(event) => select({ planId: event.target.value, view: 'locked' })}
              >
                {activePlans.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      />
    </>
  );
}
