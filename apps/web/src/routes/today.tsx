import type { WorkoutSummary } from '@askesis/api-client';
import { ArrowRight, CalendarDays, Library, MessageSquare, Moon, Sparkles } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { IntensityChart } from '../components/IntensityChart';
import { useOpenPlanChat, PlanChatError } from '../components/PlanLifecycle';
import { planProgress } from '../components/PlanView';
import { PaceGuides, Stat } from '../components/PlanWidgets';
import { WorkoutDialog } from '../components/Workout';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  SectionHeader,
} from '../components/ui';
import {
  addDays,
  dayNumber,
  daysBetween,
  formatDistance,
  formatDuration,
  formatLong,
  formatPace,
  greeting,
  startOfWeek,
  WEEKDAYS_SHORT,
} from '../lib/format';
import { inferKind, isCovered, KIND_META, workoutsOn } from '../lib/workouts';
import {
  latestCalibration,
  planVersion,
  useBriefState,
  useWorkoutDetail,
  useWorkouts,
  type Plan,
  type PlanVersion,
} from '../plan-data';
import { usePlanPreferences } from '../plan-selection';
import { useUnits, type Units } from '../settings';
import { useActivePlans } from './active-plans';
import { useLocalToday } from '../lib/use-local-today';
import { useWorkoutSelection } from '../lib/use-workout-selection';

export function TodayPage() {
  const preferences = usePlanPreferences();
  const plans = useActivePlans();
  const selection = preferences.read();
  const plan = plans.data?.find((item) => item.id === selection?.planId) ?? plans.data?.[0];
  const today = useLocalToday();
  return (
    <div className="page today">
      <header className="page-header">
        <div className="page-heading">
          <span className="label">{formatLong(today)}</span>
          <h1>{greeting()}</h1>
        </div>
      </header>
      {plans.isPending ? <LoadingState>Loading today…</LoadingState> : null}
      {plans.error ? (
        <ErrorState message={plans.error.message} onRetry={() => void plans.refetch()} />
      ) : null}
      {plans.data && !plan ? (
        <EmptyState
          icon={Sparkles}
          title="Let’s build your plan"
          action={
            <div className="button-row">
              <ButtonLink to="/chat" variant="primary" icon={MessageSquare}>
                Talk to your coach
              </ButtonLink>
              <ButtonLink to="/plans" icon={Library}>
                All plans
              </ButtonLink>
            </div>
          }
        >
          Once a plan is locked and active, today’s session and your week appear here.
        </EmptyState>
      ) : null}
      {plan ? <TodayForPlan key={plan.id} plan={plan} today={today} /> : null}
    </div>
  );
}

/** Today always shows the locked schedule; unpublished drafts are only signposted. */
function TodayForPlan({ plan, today }: { plan: Plan; today: string }) {
  const navigate = useNavigate();
  const prefs = usePlanPreferences();
  const version = planVersion(plan, 'locked');
  const workouts = useWorkouts(version);
  const brief = useBriefState(plan.id, version);
  const units = useUnits(brief.data?.brief.unit);
  const chat = useOpenPlanChat(plan.id);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected = selectedDate ?? today;
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(today), i)),
    [today],
  );
  const all = workouts.data ?? [];
  const dialog = useWorkoutSelection(all, version?.id);
  const week = all.filter((w) => w.scheduledDate >= days[0]! && w.scheduledDate <= days[6]!);
  const weekMetres = week.reduce((sum, w) => sum + (w.estimatedDistanceMetres ?? 0), 0);
  const plannedSoFar = week
    .filter((w) => w.scheduledDate < today)
    .reduce((sum, w) => sum + (w.estimatedDistanceMetres ?? 0), 0);
  const maxDay = Math.max(
    ...days.map((d) =>
      workoutsOn(week, d).reduce((sum, w) => sum + (w.estimatedDistanceMetres ?? 0), 0),
    ),
    1,
  );
  const selectedWorkouts = workoutsOn(all, selected);
  const end = version?.endDate;
  const progress = planProgress(version?.startDate ?? null, end ?? null, today);
  const daysToEnd = end ? daysBetween(today, end) : null;
  const calibration = latestCalibration(brief.data);
  const outsidePlan =
    (!!version?.startDate && selected < version.startDate) ||
    (!!version?.endDate && selected > version.endDate);
  // Legacy plans have no recorded coverage; only flag gaps when coverage is known.
  const coverage = brief.data?.coverage ?? [];
  const unplanned = !outsidePlan && coverage.length > 0 && !isCovered(selected, coverage);

  return (
    <>
      <Link className="today-chip" to="/plan">
        <Pill tone="accent" icon={CalendarDays}>
          {progress?.text ?? plan.displayName}
        </Pill>
        <span className="muted">
          {daysToEnd !== null && daysToEnd >= 0
            ? `${daysToEnd} days to go · ${plan.displayName}`
            : plan.displayName}
        </span>
      </Link>

      <div className="week-strip" role="group" aria-label="This week">
        {days.map((date, index) => {
          const items = workoutsOn(all, date);
          const kind = items[0] ? KIND_META[inferKind(items[0])] : null;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={date === selected}
              aria-label={formatLong(date)}
              className={`strip-day${date === selected ? ' selected' : ''}${date === today ? ' today' : ''}`}
              onClick={() => setSelectedDate(date === today ? null : date)}
            >
              <span className="label">{WEEKDAYS_SHORT[index]!.slice(0, 1)}</span>
              <strong>{dayNumber(date)}</strong>
              <i style={{ '--kind': kind?.color ?? 'var(--border)' } as CSSProperties} />
            </button>
          );
        })}
      </div>

      <div className="today-grid">
        <div className="today-main">
          <span className="label">
            {selected === today ? 'Today’s workout' : formatLong(selected)}
          </span>
          <PlanChatError chat={chat} />
          {workouts.isPending ? <LoadingState>Loading schedule…</LoadingState> : null}
          {workouts.error ? (
            <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
          ) : null}
          {brief.error ? (
            <ErrorState
              message={`Couldn’t load this plan’s coverage: ${brief.error.message}`}
              onRetry={() => void brief.refetch()}
            />
          ) : null}
          {workouts.data &&
          brief.data &&
          selectedWorkouts.length === 0 &&
          (unplanned || outsidePlan) ? (
            <EmptyState
              icon={Sparkles}
              title={outsidePlan ? 'Outside your plan dates' : 'Not planned yet'}
              dashed
              action={
                unplanned && !plan.archived ? (
                  <Button
                    variant="primary"
                    icon={MessageSquare}
                    busy={chat.isPending}
                    onClick={() => chat.mutate('Plan the remaining weeks')}
                  >
                    Plan it with your coach
                  </Button>
                ) : undefined
              }
            >
              {outsidePlan
                ? 'This date falls outside the plan.'
                : 'This date is inside your plan but hasn’t been prescribed yet.'}
            </EmptyState>
          ) : null}
          {workouts.data &&
          brief.data &&
          selectedWorkouts.length === 0 &&
          !unplanned &&
          !outsidePlan ? (
            <Card className="rest-hero">
              <span className="empty-icon">
                <Moon size={22} aria-hidden="true" />
              </span>
              <h2>Rest day</h2>
              <p className="muted">
                Nothing is scheduled. Easy walking, mobility work and good sleep.
              </p>
            </Card>
          ) : null}
          {selectedWorkouts.map((workout) => (
            <HeroWorkout
              key={workout.id}
              workout={workout}
              version={version}
              units={units}
              onOpen={dialog.open}
            />
          ))}

          {plan.draft ? (
            <button
              type="button"
              className="draft-callout"
              onClick={() => {
                prefs.write({ planId: plan.id, view: 'draft' });
                void navigate('/plan');
              }}
            >
              <span className="callout-icon">
                <Sparkles size={18} aria-hidden="true" />
              </span>
              <span>
                <strong>Your plan has an unpublished draft</strong>
                <small>Review the changes, then lock to make them your schedule.</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="today-side">
          <Card>
            <SectionHeader
              title="This week"
              action={
                <Link className="text-link" to="/plan">
                  See plan
                </Link>
              }
            />
            <div className="week-summary">
              <Stat
                label="Planned distance"
                value={formatDistance(weekMetres, units, false)}
                unit={units}
                sub={`${formatDistance(weekMetres - plannedSoFar, units)} to go from today`}
                large
              />
              <Stat label="Sessions" value={String(week.length)} large />
            </div>
            <div className="day-bars" aria-hidden="true">
              {days.map((date, index) => {
                const items = workoutsOn(week, date);
                const metres = items.reduce((sum, w) => sum + (w.estimatedDistanceMetres ?? 0), 0);
                const kind = items[0] ? KIND_META[inferKind(items[0])] : null;
                return (
                  <span
                    key={date}
                    className={date < today ? 'past' : date === today ? 'today' : ''}
                  >
                    <i
                      style={
                        {
                          height: metres ? `${Math.max(14, (metres / maxDay) * 100)}%` : '6%',
                          '--kind': kind?.color ?? 'var(--border)',
                        } as CSSProperties
                      }
                    />
                    <small>{WEEKDAYS_SHORT[index]!.slice(0, 1)}</small>
                  </span>
                );
              })}
            </div>
          </Card>
          {calibration ? (
            <Card>
              <SectionHeader
                title="Your pace guides"
                action={
                  <Link
                    className="text-link"
                    to={
                      version?.state === 'locked'
                        ? `/plans/${plan.id}/versions/${version.id}/brief`
                        : `/plans/${plan.id}/brief`
                    }
                  >
                    Details
                  </Link>
                }
              />
              <PaceGuides calibration={calibration} units={units} compact />
            </Card>
          ) : null}
        </div>
      </div>
      <WorkoutDialog
        workout={dialog.workout}
        version={version}
        units={units}
        onClose={dialog.close}
        onAskCoach={(workout) => {
          dialog.close();
          chat.mutate(`About “${workout.title}” on ${workout.scheduledDate}: `);
        }}
      />
    </>
  );
}

function HeroWorkout({
  workout,
  version,
  units,
  onOpen,
}: {
  workout: WorkoutSummary;
  version: PlanVersion | null;
  units: Units;
  onOpen: (workout: WorkoutSummary) => void;
}) {
  const kind = KIND_META[inferKind(workout)];
  const detail = useWorkoutDetail(workout.id, version);
  const { estimatedDistanceMetres: metres, estimatedDurationSeconds: seconds } = workout;
  return (
    <button
      type="button"
      className="hero-workout"
      style={{ '--kind': kind.color } as CSSProperties}
      onClick={() => onOpen(workout)}
    >
      <span className="hero-kind">
        <kind.icon size={16} aria-hidden="true" /> {kind.label}
      </span>
      <strong className="hero-title">{workout.title}</strong>
      {workout.purpose ? <span className="hero-purpose">{workout.purpose}</span> : null}
      <span className="hero-stats">
        {metres !== null ? (
          <Stat label="Distance" value={formatDistance(metres, units, false)} unit={units} large />
        ) : null}
        {seconds !== null ? <Stat label="Time" value={formatDuration(seconds)} large /> : null}
        {metres && seconds ? (
          <Stat
            label="Avg pace"
            value={formatPace((seconds / metres) * 1000, units, false)}
            unit={`/${units}`}
            large
          />
        ) : null}
      </span>
      {detail.data ? <IntensityChart prescription={detail.data.prescription} height={56} /> : null}
      <span className="hero-cta">
        View workout <ArrowRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}
