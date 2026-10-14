import type { WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import {
  ArrowRight,
  Compass,
  Gauge,
  Library,
  MessageSquare,
  Moon,
  Newspaper,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useOpenPlanChat, PlanChatError } from '../components/PlanLifecycle';
import { planProgress } from '../components/PlanView';
import { PlanZones, zonesTitle } from '../components/PlanWidgets';
import { WorkoutDialog } from '../components/Workout';
import { SessionBriefing, SessionTile, dayTotal } from '../components/today/SessionBriefing';
import {
  ComingUp,
  CountdownHero,
  FormCard,
  MilestoneTimeline,
  PlanSoFar,
  StatusChips,
  WeeklyLoad,
  relativeDay,
} from '../components/today/TodayPanels';
import { WeekRibbon } from '../components/today/WeekRibbon';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
  Segmented,
} from '../components/ui';
import { coveringRange } from '../lib/blocks';
import { addDays, formatDuration, formatLong, greeting, startOfWeek } from '../lib/format';
import { loadSeries, loadSnapshot, weeklyLoads } from '../lib/load';
import { readStorage, writeStorage } from '../lib/storage';
import { planSports, systemsForSports } from '../lib/sports';
import { countdownTarget, planToDate, upcomingMilestones, type Milestone } from '../lib/today';
import { isCovered, summarizeWeeks, workoutsOn } from '../lib/workouts';
import {
  currentEntry,
  knownCoverage,
  usePerformance,
  planVersion,
  useBlocks,
  useBriefState,
  useWorkoutDetail,
  useWorkouts,
  type Plan,
  type PlanVersion,
} from '../plan-data';
import { usePlanPreferences } from '../plan-selection';
import { useUnits, type Units } from '../settings';
import { useActivePlans } from './active-plans';
import { useFollowingState } from '../lib/use-following-state';
import { useLocalToday } from '../lib/use-local-today';
import { useWorkoutSelection } from '../lib/use-workout-selection';

/**
 * Prototype layouts for Today, compared side by side: a session briefing, a training-load view
 * and a plan journey. `?layout=` picks one for a shared link; the choice is remembered.
 */
type Layout = 'briefing' | 'load' | 'journey';
const LAYOUTS: Layout[] = ['briefing', 'load', 'journey'];
const LAYOUT_KEY = 'askesis-today-layout';

function useLayout(): [Layout, (layout: Layout) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get('layout');
  const stored = readStorage(LAYOUT_KEY);
  const layout = LAYOUTS.find((item) => item === requested || (!requested && item === stored));
  return [
    layout ?? 'briefing',
    (next) => {
      writeStorage(LAYOUT_KEY, next);
      setParams(
        (current) => {
          current.set('layout', next);
          return current;
        },
        { replace: true },
      );
    },
  ];
}

export function TodayPage() {
  const preferences = usePlanPreferences();
  const plans = useActivePlans();
  const selection = preferences.read();
  const plan = plans.data?.find((item) => item.id === selection?.planId) ?? plans.data?.[0];
  const today = useLocalToday();
  const [layout, setLayout] = useLayout();
  return (
    <div className={`page today layout-${layout}`}>
      <header className="page-header">
        <div className="page-heading">
          <span className="label">{formatLong(today)}</span>
          <h1>{greeting()}</h1>
        </div>
        {plan ? (
          <Segmented<Layout>
            label="Today layout (prototype)"
            className="layout-switch"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'briefing', label: 'Briefing', icon: Newspaper },
              { value: 'load', label: 'Load', icon: Gauge },
              { value: 'journey', label: 'Journey', icon: Compass },
            ]}
          />
        ) : null}
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
      {plan ? <TodayForPlan key={plan.id} plan={plan} today={today} layout={layout} /> : null}
    </div>
  );
}

/** Today always shows the locked schedule; unpublished drafts are only signposted. */
function TodayForPlan({ plan, today, layout }: { plan: Plan; today: string; layout: Layout }) {
  const navigate = useNavigate();
  const prefs = usePlanPreferences();
  const version = planVersion(plan, 'locked');
  const workouts = useWorkouts(version);
  const blockQuery = useBlocks(version);
  const brief = useBriefState(plan.id, version);
  const units = useUnits(brief.data?.brief.unit);
  const chat = useOpenPlanChat(plan.id);
  const [selected, setSelected] = useFollowingState(today);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(today), i)),
    [today],
  );
  const all = useMemo(() => workouts.data ?? [], [workouts.data]);
  const blocks = useMemo(() => blockQuery.data?.blocks ?? [], [blockQuery.data]);
  const storedWeeks = useMemo(() => blockQuery.data?.weeks ?? [], [blockQuery.data]);
  const dialog = useWorkoutSelection(all, version?.id);
  const start = version?.startDate ?? null;
  const end = version?.endDate ?? null;

  const series = useMemo(() => loadSeries(all, start, end), [all, start, end]);
  const countdown = countdownTarget(all, end, today);
  const snapshot = loadSnapshot(series, today, countdown?.race?.scheduledDate);
  const weekLoads = useMemo(() => weeklyLoads(series, all), [series, all]);
  const progress = planProgress(start, end, today);
  const block = coveringRange(blocks, { startDate: today, endDate: today });
  const toDate = useMemo(() => planToDate(all, today), [all, today]);
  // The next four weeks for Coming up; the whole plan for the Journey timeline.
  const [soon, allAhead] = useMemo(() => {
    const args = {
      workouts: all,
      blocks,
      weeks: storedWeeks,
      startDate: start,
      endDate: end,
      today,
    };
    return [upcomingMilestones(args), upcomingMilestones({ ...args, horizon: Infinity })];
  }, [all, blocks, storedWeeks, start, end, today]);
  const planWeeks = useMemo(
    () => summarizeWeeks(all, start, end, null).map((week) => ({ startDate: week.startDate })),
    [all, start, end],
  );
  const cutbacks = useMemo(
    () =>
      new Set(
        storedWeeks.filter((week) => week.cutback).map((week) => startOfWeek(week.startDate)),
      ),
    [storedWeeks],
  );

  const performance = usePerformance().data;
  const sports = planSports(brief.data?.brief, all);
  const calibrated = systemsForSports(sports).some((system) => currentEntry(performance, system));
  const selectedWorkouts = workoutsOn(all, selected);
  const outsidePlan = (!!start && selected < start) || (!!end && selected > end);
  // Legacy plans have no recorded coverage; only flag gaps when coverage is known.
  const coverage = brief.data ? knownCoverage(brief.data) : null;
  const unplanned = !outsidePlan && !!coverage && !isCovered(selected, coverage);
  const askCoach = plan.archived
    ? undefined
    : (workout: WorkoutSummary) =>
        chat.mutate(`About “${workout.title}” on ${workout.scheduledDate}: `);
  const ready = !!workouts.data && !!brief.data;

  const dayHeading = (
    <div className="day-heading">
      <span className="label">
        {selected === today
          ? selectedWorkouts.length > 1
            ? 'Today’s workouts'
            : 'Today’s workout'
          : relativeDay(selected, today)}
        {selectedWorkouts.length > 1 ? ` · ${dayTotal(selectedWorkouts)}` : ''}
      </span>
      {selected !== today ? (
        <button type="button" className="link-button" onClick={() => setSelected(today)}>
          <Undo2 size={13} aria-hidden="true" /> Back to today
        </button>
      ) : null}
    </div>
  );

  const states = (
    <>
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
      {ready && selectedWorkouts.length === 0 && (unplanned || outsidePlan) ? (
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
      {ready && selectedWorkouts.length === 0 && !unplanned && !outsidePlan ? (
        <RestDay next={all.find((w) => w.scheduledDate > selected)} today={today} />
      ) : null}
    </>
  );

  const draftCallout = plan.draft ? (
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
  ) : null;

  const ribbon = ready ? (
    <section className="ribbon-section" aria-label="This week">
      <WeekRibbon
        days={days}
        workouts={all}
        today={today}
        selected={selected}
        onSelect={setSelected}
      />
      <WeekLine days={days} workouts={all} today={today} />
    </section>
  ) : null;

  const tiles = selectedWorkouts.map((workout) => (
    <SessionTile
      key={workout.id}
      workout={workout}
      version={version}
      units={units}
      onOpen={dialog.open}
    />
  ));

  const status = (
    <StatusChips
      week={progress?.week ?? null}
      weeks={progress?.weeks ?? null}
      block={block}
      countdown={countdown}
    />
  );

  const zones =
    calibrated && ready ? (
      <TodayZones
        sports={sports}
        units={units}
        workouts={workoutsOn(all, today)}
        version={version}
      />
    ) : null;

  const formCard = (full: boolean) =>
    snapshot && ready ? (
      <FormCard
        snapshot={snapshot}
        series={series}
        today={today}
        workouts={all}
        weeks={weekLoads}
        full={full}
      />
    ) : null;

  let content: ReactNode;
  if (layout === 'load')
    content = (
      <div className="today-grid">
        <div className="today-main">
          {formCard(true)}
          {ready ? <WeeklyLoad weeks={weekLoads} today={today} /> : null}
        </div>
        <div className="today-side">
          {ribbon}
          {dayHeading}
          {states}
          {tiles}
          {draftCallout}
          {ready ? (
            <ComingUp
              workouts={all}
              milestones={soon}
              today={today}
              units={units}
              onOpen={dialog.open}
              limit={2}
            />
          ) : null}
        </div>
      </div>
    );
  else if (layout === 'journey')
    content = (
      <div className="today-grid">
        <div className="today-main">
          {countdown && ready ? (
            <CountdownHero
              countdown={countdown}
              weeks={planWeeks}
              currentWeek={progress?.week ?? null}
              blocks={blocks}
              cutbacks={cutbacks}
              today={today}
            />
          ) : null}
          {ready ? <PlanSoFar progress={toDate} units={units} /> : null}
          {ready ? (
            <MilestoneTimeline milestones={endingWithGoal(allAhead, 8)} today={today} />
          ) : null}
        </div>
        <div className="today-side">
          {dayHeading}
          {states}
          {tiles}
          {draftCallout}
          {ribbon}
          {zones}
        </div>
      </div>
    );
  else
    content = (
      <>
        {ribbon}
        <div className="today-grid">
          <div className="today-main">
            {dayHeading}
            {states}
            {selectedWorkouts.map((workout) => (
              <SessionBriefing
                key={workout.id}
                workout={workout}
                workouts={all}
                version={version}
                units={units}
                onOpen={dialog.open}
                onAskCoach={askCoach}
              />
            ))}
            {draftCallout}
          </div>
          <div className="today-side">
            {formCard(false)}
            {ready ? (
              <ComingUp
                workouts={all}
                milestones={soon}
                today={today}
                units={units}
                onOpen={dialog.open}
              />
            ) : null}
            {zones}
            {ready ? <PlanSoFar progress={toDate} units={units} compact /> : null}
          </div>
        </div>
      </>
    );

  return (
    <>
      {status}
      {content}
      <WorkoutDialog
        workout={dialog.workout}
        version={version}
        units={units}
        onClose={dialog.close}
        onAskCoach={
          askCoach
            ? (workout) => {
                dialog.close();
                askCoach(workout);
              }
            : undefined
        }
      />
    </>
  );
}

/** The first milestones, keeping the list's end point (the goal race or plan finish) in view. */
function endingWithGoal(milestones: Milestone[], limit: number) {
  if (milestones.length <= limit) return milestones;
  const last = milestones.at(-1)!;
  const ending = last.kind === 'race' || last.kind === 'finish';
  return ending ? [...milestones.slice(0, limit - 1), last] : milestones.slice(0, limit);
}

/** "6 sessions · 5h 07 · 3h 02 to go" for the week. */
function WeekLine({
  days,
  workouts,
  today,
}: {
  days: string[];
  workouts: WorkoutSummary[];
  today: string;
}) {
  const week = workouts.filter((w) => w.scheduledDate >= days[0]! && w.scheduledDate <= days[6]!);
  const seconds = week.reduce((sum, w) => sum + (w.estimatedDurationSeconds ?? 0), 0);
  const ahead = week
    .filter((w) => w.scheduledDate >= today)
    .reduce((sum, w) => sum + (w.estimatedDurationSeconds ?? 0), 0);
  const behind = week.filter((w) => w.scheduledDate < today).length;
  return (
    <p className="week-line">
      <strong>This week</strong>
      <span>
        {week.length} sessions · {formatDuration(seconds)}
      </span>
      <span className="muted">
        {behind ? `${behind} behind you · ` : ''}
        {ahead ? `${formatDuration(ahead)} to go` : 'all done'}
      </span>
    </p>
  );
}

function RestDay({ next, today }: { next: WorkoutSummary | undefined; today: string }) {
  return (
    <Card className="rest-hero">
      <span className="empty-icon">
        <Moon size={22} aria-hidden="true" />
      </span>
      <h2>Rest day</h2>
      <p className="muted">Nothing is scheduled. Easy walking, mobility work and good sleep.</p>
      {next ? (
        <p className="rest-next">
          Next up: <strong>{next.title}</strong> · {relativeDay(next.scheduledDate, today, true)}
        </p>
      ) : null}
    </Card>
  );
}

function collectZones(step: WorkoutStep, into: Map<string, Set<string>>) {
  for (const target of step.targets)
    if (target.type === 'zone' && target.zoneKey && target.zoneSystem) {
      const keys = into.get(target.zoneSystem) ?? new Set<string>();
      keys.add(target.zoneKey);
      into.set(target.zoneSystem, keys);
    }
  for (const child of step.steps) collectZones(child, into);
}

/**
 * The zones today's sessions use, so the numbers that matter today are all there is to read. On
 * days without zoned work, every zone the plan's sports use.
 */
function TodayZones({
  sports,
  units,
  workouts,
  version,
}: {
  sports: string[];
  units: Units;
  workouts: WorkoutSummary[];
  version: PlanVersion | null;
}) {
  // A day holds at most a couple of sessions; their details are already cached by the briefing.
  const first = useWorkoutDetail(workouts[0]?.id, version);
  const second = useWorkoutDetail(workouts[1]?.id, version);
  const highlight = useMemo(() => {
    const zones = new Map<string, Set<string>>();
    for (const detail of [first.data, second.data])
      if (detail) collectZones(detail.prescription, zones);
    return zones;
  }, [first.data, second.data]);
  const targeted = highlight.size > 0;
  return (
    <Card>
      <SectionHeader
        title={targeted ? 'Today’s targets' : `Your ${zonesTitle(sports).toLowerCase()}`}
        action={
          <Link className="text-link" to="/performance">
            {targeted ? 'All zones' : 'Details'}
          </Link>
        }
      />
      <PlanZones
        sports={sports}
        units={units}
        compact
        showSource={false}
        highlight={targeted ? highlight : undefined}
        only={targeted}
      />
    </Card>
  );
}
