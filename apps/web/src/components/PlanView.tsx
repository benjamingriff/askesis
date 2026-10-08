import { ClipboardList, Flag, Lock, PencilLine, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { daysBetween, formatRange, startOfWeek } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import { useWorkoutSelection } from '../lib/use-workout-selection';
import {
  knownCoverage,
  planVersion,
  useBlocks,
  useBriefState,
  useDraftChanges,
  useWorkouts,
  type Plan,
  type PlanView as View,
} from '../plan-data';
import { PlanHistory } from '../routes/plan-history';
import { useUnits } from '../settings';
import { useOpenPlanChat, PlanChatError, PlanToolbar } from './PlanLifecycle';
import { PlanChanges, WorkoutChangesContext } from './PlanChanges';
import { BlockTimeline, CoverageNote, PlanStatus, PlanZones, zonesTitle } from './PlanWidgets';
import { planSports } from '../lib/sports';
import { Schedule, type SchedulePresentation } from './Schedule';
import {
  Card,
  cx,
  ErrorState,
  LoadingState,
  Notice,
  ProgressBar,
  SectionHeader,
  Segmented,
} from './ui';

/** Progress in Monday-start calendar weeks, matching the schedule's week numbers. */
export function planProgress(start: string | null, end: string | null, today: string) {
  if (!start || !end) return null;
  const first = startOfWeek(start);
  const weeks = Math.floor(daysBetween(first, end) / 7) + 1;
  const total = Math.max(1, daysBetween(start, end) + 1);
  const elapsed = daysBetween(start, today);
  if (elapsed < 0)
    return {
      value: 0,
      text: `Starts in ${-elapsed} ${elapsed === -1 ? 'day' : 'days'}`,
      weeks,
      week: null,
    };
  if (elapsed >= total) return { value: 1, text: 'Plan complete', weeks, week: null };
  const week = Math.floor(daysBetween(first, today) / 7) + 1;
  return { value: elapsed / total, text: `Week ${week} of ${weeks}`, weeks, week };
}

/**
 * One plan, end to end: state, actions, schedule, paces and history. Embedded beside a chat it
 * uses a compact header, keeps lifecycle actions in a footer and asks that chat's coach.
 */
export function PlanView({
  plan,
  view: requestedView,
  onViewChange,
  eyebrow,
  switcher,
  embedded = false,
  onAskCoach,
  schedulePresentation,
}: {
  plan: Plan;
  view: View;
  onViewChange: (view: View) => void;
  eyebrow?: ReactNode | undefined;
  switcher?: ReactNode | undefined;
  embedded?: boolean | undefined;
  /** Replaces opening the plan's chat, for example to prefill the chat already beside it. */
  onAskCoach?: ((prompt: string) => void) | undefined;
  schedulePresentation: SchedulePresentation;
}) {
  const today = useLocalToday();
  const view: View =
    requestedView === 'draft' && plan.draft ? 'draft' : plan.locked ? 'locked' : 'draft';
  const version = planVersion(plan, view);
  const brief = useBriefState(plan.id, version);
  const workouts = useWorkouts(version);
  const blockQuery = useBlocks(version);
  const blocks = blockQuery.data?.blocks ?? [];
  const weeks = blockQuery.data?.weeks ?? [];
  const changes = useDraftChanges(plan.id, view === 'draft' ? plan.draft : null);
  const selection = useWorkoutSelection(workouts.data ?? [], version?.id);
  const units = useUnits(brief.data?.brief.unit);
  const chat = useOpenPlanChat(plan.id);
  const askCoach = onAskCoach ?? ((prompt: string) => chat.mutate(prompt));
  const [historyOpen, setHistoryOpen] = useState(false);
  const progress = planProgress(version?.startDate ?? null, version?.endDate ?? null, today);
  const sports = planSports(brief.data?.brief, workouts.data);
  const goal = brief.data?.brief.goal;

  const toolbar = (
    <PlanToolbar
      plan={plan}
      showCoach={!embedded}
      onChanged={(updated, action) => {
        if (action === 'unlock') onViewChange('draft');
        if (action === 'lock' || action === 'discard') onViewChange('locked');
        void updated;
      }}
      onShowHistory={() => {
        setHistoryOpen(true);
        window.setTimeout(
          () =>
            document
              .getElementById('version-history')
              ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
          30,
        );
      }}
    />
  );

  return (
    <div className={cx('page plan-view', embedded && 'embedded-plan')}>
      {embedded ? null : (
        <header className="page-header plan-header">
          <div className="page-heading">
            {eyebrow}
            <span className="label">Training plan</span>
            <h1>{plan.displayName}</h1>
            <div className="plan-meta">
              <PlanStatus plan={plan} view={view} />
              <span className="muted">
                {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
              </span>
            </div>
          </div>
          <div className="plan-header-actions">
            {switcher}
            {toolbar}
          </div>
        </header>
      )}

      {plan.draft && plan.locked ? (
        <Segmented<View>
          label="Content source"
          className="source-toggle"
          value={view}
          onChange={onViewChange}
          options={[
            { value: 'locked', label: `Locked v${plan.locked.versionNumber}`, icon: Lock },
            { value: 'draft', label: 'Draft', icon: PencilLine },
          ]}
        />
      ) : null}

      <div className="plan-layout">
        <div className="plan-main">
          <Card className="plan-hero">
            {embedded ? (
              <div className="embedded-plan-heading">
                <div>
                  <span className="label">Plan</span>
                  <h2>{plan.displayName}</h2>
                  <span className="muted">
                    {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
                  </span>
                </div>
                <div className="plan-meta">
                  <PlanStatus plan={plan} view={view} />
                </div>
              </div>
            ) : null}
            {goal ? (
              <p className="plan-goal">
                <Flag size={14} aria-hidden="true" /> {goal}
              </p>
            ) : null}
            {blocks.length ? (
              <BlockTimeline
                blocks={blocks}
                startDate={version?.startDate ?? null}
                endDate={version?.endDate ?? null}
                today={today}
                races={workouts.data?.filter((workout) => workout.racePriority)}
              />
            ) : null}
            {blockQuery.error ? (
              <ErrorState
                message="Couldn’t load this plan’s training blocks."
                onRetry={() => void blockQuery.refetch()}
              />
            ) : null}
            {progress ? (
              <div className="plan-progress">
                <ProgressBar value={progress.value} label="Plan progress" />
                <strong>{progress.text}</strong>
              </div>
            ) : null}
            {version?.description ? (
              <p className="plan-description">{version.description}</p>
            ) : null}
            {brief.data ? <CoverageNote state={brief.data} /> : null}
            {brief.error ? (
              <ErrorState message={brief.error.message} onRetry={() => void brief.refetch()} />
            ) : null}
          </Card>

          {view === 'draft' && embedded ? null : view === 'draft' ? (
            <Notice tone="accent" icon={Sparkles} className="draft-banner">
              <strong>
                {plan.locked ? 'Unpublished draft' : 'Initial draft'} · your coach can edit this
              </strong>
              <span>
                {plan.locked
                  ? `Locked version ${plan.locked.versionNumber} stays unchanged until you review and lock.`
                  : 'Review and lock it to start following the plan.'}
              </span>
            </Notice>
          ) : plan.draft ? (
            <Notice
              tone="neutral"
              icon={PencilLine}
              action={
                <button className="link-button" type="button" onClick={() => onViewChange('draft')}>
                  View draft
                </button>
              }
            >
              You have unpublished draft changes. This is the stable locked version.
            </Notice>
          ) : null}

          {changes.data ? (
            <PlanChanges
              summary={changes.data}
              firstDraft={!changes.data.baselineId}
              onOpen={(id) => {
                const workout = workouts.data?.find((workout) => workout.id === id);
                if (workout) selection.open(workout);
              }}
            />
          ) : null}
          {changes.error ? (
            <ErrorState
              message="Could not load saved changes."
              onRetry={() => void changes.refetch()}
            />
          ) : null}
          {workouts.isPlaceholderData || brief.isPlaceholderData ? (
            <p className="muted" role="status">
              Refreshing saved schedule…
            </p>
          ) : null}
          {onAskCoach ? null : <PlanChatError chat={chat} />}
          {(workouts.isPending || brief.isPending) && version ? (
            <LoadingState>Loading schedule…</LoadingState>
          ) : null}
          {workouts.error ? (
            <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
          ) : null}
          {workouts.data && version && brief.data && !brief.error ? (
            <WorkoutChangesContext.Provider value={changes.data?.workouts ?? []}>
              <Schedule
                key={version.id}
                presentation={schedulePresentation}
                workouts={workouts.data}
                version={version}
                startDate={version.startDate}
                endDate={version.endDate}
                coverage={knownCoverage(brief.data)}
                units={units}
                today={today}
                selection={selection}
                blocks={blocks}
                storedWeeks={weeks}
                onAskCoach={
                  plan.archived
                    ? undefined
                    : (workout) =>
                        askCoach(`About “${workout.title}” on ${workout.scheduledDate}: `)
                }
                onPlanRest={plan.archived ? undefined : () => askCoach('Plan the remaining weeks')}
              />
            </WorkoutChangesContext.Provider>
          ) : null}
        </div>

        <aside className="plan-side">
          <Card>
            <SectionHeader
              title={zonesTitle(sports)}
              action={
                <Link className="text-link" to="/performance">
                  Update
                </Link>
              }
            />
            <PlanZones sports={sports} units={units} compact />
          </Card>
          <Card>
            <SectionHeader
              title="Brief"
              action={
                <Link
                  className="text-link"
                  to={
                    view === 'draft'
                      ? `/plans/${plan.id}/brief`
                      : `/plans/${plan.id}/versions/${version?.id}/brief`
                  }
                >
                  {view === 'draft' ? 'Edit brief' : 'View brief'}
                </Link>
              }
            />
            {brief.data ? (
              <div className="brief-summary">
                {goal ? null : (
                  <p>
                    <Flag size={15} aria-hidden="true" /> No goal recorded yet.
                  </p>
                )}
                <p>
                  <ClipboardList size={15} aria-hidden="true" />{' '}
                  {brief.data.confirmed
                    ? 'Assumptions confirmed'
                    : 'Assumptions need your confirmation'}
                </p>
              </div>
            ) : (
              <LoadingState>Loading brief…</LoadingState>
            )}
          </Card>
          <details
            className="card history-card"
            id="version-history"
            open={historyOpen}
            onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
          >
            <summary>
              <h2>Version history</h2>
            </summary>
            {historyOpen ? (
              <PlanHistory
                planId={plan.id}
                basedOnVersionId={plan.draft?.basedOnVersionId ?? null}
              />
            ) : null}
          </details>
        </aside>
      </div>
      {embedded ? <footer className="embedded-plan-actions">{toolbar}</footer> : null}
    </div>
  );
}
