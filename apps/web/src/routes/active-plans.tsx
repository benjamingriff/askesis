import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Library, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { PlanView } from '../components/PlanView';
import { ButtonLink, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { result } from '../lib/result';
import { usePlanPreferences, type PlanSelection } from '../plan-selection';
import type { Plan } from '../plan-data';

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
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const plans = useActivePlans();
  // Collection membership can change without navigation. Keep the open editor's plan
  // mounted, and read its current metadata even if it has been deactivated or archived.
  const editing = useQuery({
    queryKey: ['plans', editingPlan?.id],
    enabled: !!editingPlan,
    queryFn: async () =>
      result(
        await api.GET('/api/v1/plans/{planId}', {
          params: { path: { planId: editingPlan!.id } },
        }),
      ),
  });
  const activePlans = plans.data ?? [];
  const plan = editingPlan
    ? (editing.data ?? activePlans.find((item) => item.id === editingPlan.id) ?? editingPlan)
    : (activePlans.find((item) => item.id === selection?.planId) ?? activePlans[0]);
  const selectablePlans =
    plan && !activePlans.some((item) => item.id === plan.id) ? [plan, ...activePlans] : activePlans;
  const error = plans.error ?? editing.error;
  const retry = () => {
    void plans.refetch();
    if (editingPlan) void editing.refetch();
  };
  const view =
    selection?.planId === plan?.id && selection?.view === 'draft' && plan?.draft
      ? 'draft'
      : 'locked';

  function select(next: PlanSelection) {
    if (editingPlan && next.planId !== editingPlan.id) return;
    setSelection(next);
    preferences.write(next);
  }

  if (plans.isPending && !editingPlan)
    return (
      <div className="page">
        <LoadingState>Loading your plan…</LoadingState>
      </div>
    );
  if (plans.error && !plans.data && !editingPlan)
    return (
      <div className="page">
        <ErrorState message={plans.error.message} onRetry={() => void plans.refetch()} />
      </div>
    );
  if (!plan)
    return (
      <div className="page">
        {plans.error ? (
          <ErrorState message={plans.error.message} onRetry={() => void plans.refetch()} />
        ) : null}
        <header className="page-header">
          <div className="page-heading">
            <h1>Plan</h1>
          </div>
        </header>
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
      </div>
    );

  return (
    <>
      {error ? <ErrorState message={error.message} onRetry={retry} /> : null}
      <PlanView
        key={plan.id}
        plan={plan}
        view={view}
        onViewChange={(next) => select({ planId: plan.id, view: next })}
        onDetailsOpenChange={setEditingPlan}
        switcher={
          selectablePlans.length > 1 ? (
            <label className="plan-switcher">
              <span className="sr-only">Active plan</span>
              <select
                value={plan.id}
                disabled={!!editingPlan}
                onChange={(event) => select({ planId: event.target.value, view: 'locked' })}
              >
                {selectablePlans.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                    {!activePlans.some((active) => active.id === item.id)
                      ? ' · No longer active'
                      : ''}
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
