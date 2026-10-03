import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, ChevronRight, Plus, Power } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useRequestKey } from '../components/PlanLifecycle';
import { StatusPill } from '../components/PlanWidgets';
import { PlanView } from '../components/PlanView';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Pill,
  Segmented,
} from '../components/ui';
import { formatRange } from '../lib/format';
import { result } from '../lib/result';
import type { PlanView as View } from '../plan-data';

export function PlansPage({ archived = false }: { archived?: boolean }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const plans = useQuery({
    queryKey: ['plans', 'collection', archived ? 'archive' : 'library'],
    queryFn: async () =>
      result(
        await api.GET('/api/v1/plans', {
          params: { query: { collection: archived ? 'archive' : 'library' } },
        }),
      ).plans,
  });
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-heading">
          <span className="label">Your training</span>
          <h1>Plans</h1>
          <p className="muted">
            Plan with your coach, then review and lock a version. Plans stay private to your
            account.
          </p>
        </div>
        {!archived ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New plan
          </Button>
        ) : null}
      </header>
      <Segmented<'library' | 'archive'>
        label="Plan collection"
        value={archived ? 'archive' : 'library'}
        onChange={(next) => void navigate(next === 'archive' ? '/plans/archive' : '/plans')}
        options={[
          { value: 'library', label: 'Library' },
          { value: 'archive', label: 'Archived' },
        ]}
      />
      {plans.isPending ? <LoadingState>Loading plans…</LoadingState> : null}
      {plans.error ? (
        <ErrorState message={plans.error.message} onRetry={() => void plans.refetch()} />
      ) : null}
      {plans.data?.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={archived ? 'Nothing archived' : 'No plans yet'}
          dashed
          action={
            archived ? undefined : (
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                New plan
              </Button>
            )
          }
        >
          {archived
            ? 'Archived plans are kept here and can be restored.'
            : 'Create a plan and your coach will help you shape it.'}
        </EmptyState>
      ) : null}
      <ul className="plan-cards">
        {plans.data?.map((plan) => {
          const version = plan.draft ?? plan.locked;
          return (
            <li key={plan.id}>
              <Link to={`/plans/${plan.id}`} className="plan-card">
                <div className="plan-card-top">
                  <StatusPill plan={plan} />
                  {plan.active ? (
                    <Pill icon={Power} tone="neutral">
                      Active
                    </Pill>
                  ) : null}
                </div>
                <strong>{plan.displayName}</strong>
                <span className="muted">
                  {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
                </span>
                {version?.description ? <p>{version.description}</p> : null}
                <ChevronRight className="chevron" size={18} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      <NewPlanDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewPlanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const requestKey = useRequestKey();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const create = useMutation({
    mutationFn: async () =>
      result(
        await api.POST('/api/v1/plans', {
          params: { header: { 'idempotency-key': requestKey([name.trim(), startDate, endDate]) } },
          body: { displayName: name.trim(), startDate, endDate, createConversation: true },
        }),
      ),
    onSuccess: async (plan) => {
      await client.invalidateQueries({ queryKey: ['plans'] });
      void navigate(plan.conversationId ? `/chat/${plan.conversationId}` : `/plans/${plan.id}`);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={create.isPending}
      title="New plan"
      description="Name it and set the dates. Your coach will talk it through with you before writing any workouts."
      footer={
        <>
          <Button variant="ghost" disabled={create.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="new-plan-form"
            busy={create.isPending}
            disabled={create.isPending || !name.trim()}
          >
            Create plan
          </Button>
        </>
      }
    >
      <form
        id="new-plan-form"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="field">
          <span>Plan name</span>
          <input
            required
            maxLength={200}
            value={name}
            placeholder="Spring half marathon"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>End date</span>
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
        {create.error ? (
          <Notice tone="danger" role="alert">
            {create.error.message}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}

export function PlanPage() {
  const { planId = '' } = useParams();
  const [view, setView] = useState<View>('draft');
  const query = useQuery({
    queryKey: ['plans', planId],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}', { params: { path: { planId } } })),
  });
  const back = (
    <Link to="/plans" className="back-link">
      <ArrowLeft size={15} aria-hidden="true" /> All plans
    </Link>
  );
  if (query.isPending)
    return (
      <div className="page">
        {back}
        <LoadingState>Loading plan…</LoadingState>
      </div>
    );
  if (!query.data)
    return (
      <div className="page">
        {back}
        <ErrorState
          message={query.error?.message ?? 'Couldn’t load the plan.'}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  return (
    <>
      {query.error ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      <PlanView
        key={query.data.id}
        plan={query.data}
        view={view}
        onViewChange={setView}
        eyebrow={back}
      />
    </>
  );
}
