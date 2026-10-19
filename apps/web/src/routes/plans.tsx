import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ArrowLeft, CalendarDays, ChevronRight, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { PlanStatus } from '../components/PlanWidgets';
import { useRequestKey } from '../lib/use-request-key';
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
import { formatRange, formatShort } from '../lib/format';
import { result } from '../lib/result';
import { usePlan, type Plan, type PlanView as View } from '../plan-data';

type Collection = 'library' | 'archive' | 'deleted';
const COLLECTION_PATHS: Record<Collection, string> = {
  library: '/plans',
  archive: '/plans/archive',
  deleted: '/plans/deleted',
};
const EMPTY: Record<Collection, { title: string; body: string }> = {
  library: {
    title: 'No plans yet',
    body: 'Create a plan and your coach will help you shape it.',
  },
  archive: { title: 'Nothing archived', body: 'Archived plans are kept here and can be restored.' },
  deleted: {
    title: 'Nothing deleted',
    body: 'Deleted plans stay here for 30 days so you can restore them, then they are gone for good.',
  },
};

export function PlansPage({ collection = 'library' }: { collection?: Collection }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const archived = collection !== 'library';
  const plans = useQuery({
    queryKey: ['plans', 'collection', collection],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans', { params: { query: { collection } } })).plans,
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
      <Segmented<Collection>
        label="Plan collection"
        value={collection}
        onChange={(next) => void navigate(COLLECTION_PATHS[next])}
        options={[
          { value: 'library', label: 'Library' },
          { value: 'archive', label: 'Archived' },
          { value: 'deleted', label: 'Recently deleted' },
        ]}
      />
      {plans.isPending ? <LoadingState>Loading plans…</LoadingState> : null}
      {plans.error ? (
        <ErrorState message={plans.error.message} onRetry={() => void plans.refetch()} />
      ) : null}
      {plans.data?.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={EMPTY[collection].title}
          dashed
          action={
            archived ? undefined : (
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                New plan
              </Button>
            )
          }
        >
          {EMPTY[collection].body}
        </EmptyState>
      ) : null}
      <ul className="plan-cards">
        {plans.data?.map((plan) => {
          const version = plan.draft ?? plan.locked;
          if (collection === 'deleted')
            return (
              <li key={plan.id}>
                <DeletedPlanCard plan={plan} />
              </li>
            );
          return (
            <li key={plan.id}>
              <Link to={`/plans/${plan.id}`} className="plan-card">
                <div className="plan-card-top">
                  <PlanStatus plan={plan} />
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

/** A deleted plan can't be opened, only restored to the archive before it is purged. */
function DeletedPlanCard({ plan }: { plan: Plan }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const version = plan.draft ?? plan.locked;
  const restore = useMutation({
    mutationFn: async () =>
      result(
        await api.POST('/api/v1/plans/{planId}/undelete', {
          params: { path: { planId: plan.id } },
        }),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['plans'] });
      void navigate('/plans/archive');
    },
  });
  return (
    <div className="plan-card plan-card-deleted">
      <div className="plan-card-top">
        <Pill tone="danger" icon={Trash}>
          {plan.purgeAfter
            ? `Deleted for good on ${formatShort(plan.purgeAfter.slice(0, 10))}`
            : 'Deleted'}
        </Pill>
      </div>
      <strong>{plan.displayName}</strong>
      <span className="muted">
        {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
      </span>
      <div className="plan-card-actions">
        <Button
          size="sm"
          icon={ArchiveRestore}
          busy={restore.isPending}
          disabled={restore.isPending}
          onClick={() => restore.mutate()}
        >
          Restore to archive
        </Button>
      </div>
      {restore.error ? (
        <Notice tone="danger" role="alert">
          {restore.error.message}
        </Notice>
      ) : null}
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
  const query = usePlan(planId);
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
        schedulePresentation="week-list"
      />
    </>
  );
}
