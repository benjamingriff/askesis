import type { WorkoutSummary } from '@askesis/api-client';
import { ArrowRight, CalendarDays, Library, MessageSquare, Moon, Sparkles } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { IntensityChart } from '../components/IntensityChart';
import { useOpenPlanChat, PlanChatError } from '../components/PlanLifecycle';
import { planProgress } from '../components/PlanView';
import { PlanZones, Stat, zonesTitle } from '../components/PlanWidgets';
import { WorkoutDialog, workoutStats } from '../components/Workout';
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
  greeting,
  startOfWeek,
  WEEKDAYS_SHORT,
} from '../lib/format';
import { planSports, systemsForSports } from '../lib/sports';
import { inferKind, isCovered, KIND_META, volumeMeasure, workoutsOn } from '../lib/workouts';
import {
  currentEntry,
  knownCoverage,
  usePerformance,
  planVersion,
  useBriefState,
  useWorkoutDetail,
  useWorkouts,
  type Plan,
  type PlanVersion,
} from '../plan-data';
import { usePlanPreferences } from '../plan-selection';
import { useSportUnits, useUnits, type Units } from '../settings';
import { useActivePlans } from './active-plans';
import { useFollowingState } from '../lib/use-following-state';
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
  const [selected, setSelected] = useFollowingState(today);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(today), i)),
    [today],
  );
  const all = workouts.data ?? [];
  const dialog = useWorkoutSelection(all, version?.id);
  const week = all.filter((w) => w.scheduledDate >= days[0]! && w.scheduledDate <= days[6]!);
  // Distance for running-only plans; time once other sports join, as their distances don't add.
  const measure = volumeMeasure(all);
  const amount = (w: WorkoutSummary) =>
    (measure === 'time' ? w.estimatedDurationSeconds : w.estimatedDistanceMetres) ?? 0;
  const formatAmount = (value: number, withUnit = true) =>
    measure === 'time' ? formatDuration(value) : formatDistance(value, units, withUnit);
  const weekAmount = week.reduce((sum, w) => sum + amount(w), 0);
  const plannedSoFar = week
    .filter((w) => w.scheduledDate < today)
    .reduce((sum, w) => sum + amount(w), 0);
  const maxDay = Math.max(
    ...days.map((d) => workoutsOn(week, d).reduce((sum, w) => sum + amount(w), 0)),
    1,
  );
  const selectedWorkouts = workoutsOn(all, selected);
  const end = version?.endDate;
  const progress = planProgress(version?.startDate ?? null, end ?? null, today);
  const daysToEnd = end ? daysBetween(today, end) : null;
  const performance = usePerformance().data;
  const sports = planSports(brief.data?.brief, all);
  const calibrated = systemsForSports(sports).some((system) => currentEntry(performance, system));
  const outsidePlan =
    (!!version?.startDate && selected < version.startDate) ||
    (!!version?.endDate && selected > version.endDate);
  // Legacy plans have no recorded coverage; only flag gaps when coverage is known.
  const coverage = brief.data ? knownCoverage(brief.data) : null;
  const unplanned = !outsidePlan && !!coverage && !isCovered(selected, coverage);

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
              onClick={() => setSelected(date)}
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
                label={measure === 'time' ? 'Planned time' : 'Planned distance'}
                value={formatAmount(weekAmount, false)}
                unit={measure === 'time' ? undefined : units}
                sub={`${formatAmount(weekAmount - plannedSoFar)} to go from today`}
                large
              />
              <Stat label="Sessions" value={String(week.length)} large />
            </div>
            <div className="day-bars" aria-hidden="true">
              {days.map((date, index) => {
                const items = workoutsOn(week, date);
                const metres = items.reduce((sum, w) => sum + amount(w), 0);
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
          {calibrated ? (
            <Card>
              <SectionHeader
                title={`Your ${zonesTitle(sports).toLowerCase()}`}
                action={
                  <Link className="text-link" to="/performance">
                    Details
                  </Link>
                }
              />
              <PlanZones sports={sports} units={units} compact showSource={false} />
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
  const { pool } = useSportUnits();
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
        {workoutStats(workout, units, pool).map((stat) => (
          <Stat key={stat.label} label={stat.label} value={stat.value} unit={stat.unit} large />
        ))}
      </span>
      {detail.data ? <IntensityChart prescription={detail.data.prescription} height={56} /> : null}
      <span className="hero-cta">
        View workout <ArrowRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}
