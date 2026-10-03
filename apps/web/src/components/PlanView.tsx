import { ClipboardList, Flag, Lock, PencilLine, Power, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { daysBetween, formatRange, startOfWeek } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import {
  knownCoverage,
  latestCalibration,
  planVersion,
  useBriefState,
  useWorkouts,
  type Plan,
  type PlanView as View,
} from '../plan-data';
import { PlanHistory } from '../routes/plan-history';
import { useUnits } from '../settings';
import { useOpenPlanChat, PlanChatError, PlanToolbar } from './PlanLifecycle';
import { CalibrationSource, CoverageNote, PaceGuides, StatusPill } from './PlanWidgets';
import { Schedule } from './Schedule';
import {
  Card,
  ErrorState,
  LoadingState,
  Notice,
  Pill,
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

/** One plan, end to end: state, actions, schedule, paces and history. */
export function PlanView({
  plan,
  view: requestedView,
  onViewChange,
  eyebrow,
  switcher,
}: {
  plan: Plan;
  view: View;
  onViewChange: (view: View) => void;
  eyebrow?: ReactNode | undefined;
  switcher?: ReactNode | undefined;
}) {
  const today = useLocalToday();
  const view: View =
    requestedView === 'draft' && plan.draft ? 'draft' : plan.locked ? 'locked' : 'draft';
  const version = planVersion(plan, view);
  const brief = useBriefState(plan.id, version);
  const workouts = useWorkouts(version);
  const units = useUnits(brief.data?.brief.unit);
  const chat = useOpenPlanChat(plan.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const progress = planProgress(version?.startDate ?? null, version?.endDate ?? null, today);
  const calibration = latestCalibration(brief.data);
  const goal = brief.data?.brief.goal;

  return (
    <div className="page plan-view">
      <header className="page-header plan-header">
        <div className="page-heading">
          {eyebrow}
          <span className="label">Training plan</span>
          <h1>{plan.displayName}</h1>
          <div className="plan-meta">
            <StatusPill plan={plan} view={view} />
            {plan.active ? (
              <Pill tone="neutral" icon={Power}>
                Active
              </Pill>
            ) : null}
            <span className="muted">
              {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
            </span>
          </div>
        </div>
        <div className="plan-header-actions">
          {switcher}
          <PlanToolbar
            plan={plan}
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
        </div>
      </header>

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
            {goal ? (
              <p className="plan-goal">
                <Flag size={14} aria-hidden="true" /> {goal}
              </p>
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

          {view === 'draft' ? (
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

          <PlanChatError chat={chat} />
          {(workouts.isPending || brief.isPending) && version ? (
            <LoadingState>Loading schedule…</LoadingState>
          ) : null}
          {workouts.error ? (
            <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
          ) : null}
          {workouts.data && version && brief.data && !brief.error ? (
            <Schedule
              key={version.id}
              workouts={workouts.data}
              version={version}
              startDate={version.startDate}
              endDate={version.endDate}
              coverage={knownCoverage(brief.data)}
              units={units}
              today={today}
              onAskCoach={
                plan.archived
                  ? undefined
                  : (workout) =>
                      chat.mutate(`About “${workout.title}” on ${workout.scheduledDate}: `)
              }
              onPlanRest={plan.archived ? undefined : () => chat.mutate('Plan the remaining weeks')}
            />
          ) : null}
        </div>

        <aside className="plan-side">
          <Card>
            <SectionHeader
              title="Pace guides"
              action={
                <Link
                  className="text-link"
                  to={
                    view === 'draft'
                      ? `/plans/${plan.id}/brief`
                      : `/plans/${plan.id}/versions/${version?.id}/brief`
                  }
                >
                  {view === 'draft' ? 'Edit' : 'Details'}
                </Link>
              }
            />
            {calibration ? (
              <>
                <PaceGuides calibration={calibration} units={units} compact />
                <CalibrationSource calibration={calibration} units={units} />
              </>
            ) : (
              <p className="muted">
                No pace guides yet. Share a recent race or an estimate with your coach.
              </p>
            )}
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
    </div>
  );
}
