import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTabBarInset } from '../../components/FloatingTabBar';
import { IntensityChart } from '../../components/IntensityChart';
import { ZoneCards, zonesTitle } from '../../components/PlanWidgets';
import { openWorkout, planProgress } from '../../components/PlanView';
import {
  CheckInButton,
  LogChip,
  LogMark,
  TrainingLogProvider,
  WorkoutLogActions,
  logStatusFor,
  useLogContext,
} from '../../components/TrainingLog';
import { PlaceholderBand } from '../../components/WorkoutRow';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  KindIcon,
  LoadingState,
  PressableScale,
  ProgressBar,
  Screen,
  SectionHeader,
  Stat,
  Text,
} from '../../components/ui';
import { StartPlanButton } from '../../components/StartPlanButton';
import { useAskIcon, useCoachWord } from '../../data/account';
import { useOpenPlanChat } from '../../data/plan-actions';
import {
  currentEntry,
  knownCoverage,
  planVersion,
  useActivePlans,
  useBriefState,
  usePerformance,
  useWorkoutDetail,
  useWorkouts,
  type Plan,
  type PlanVersion,
} from '../../data/plan-data';
import type { WorkoutSummary } from '../../lib/api-types';
import {
  addDays,
  dayNumber,
  daysBetween,
  formatDay,
  formatDistance,
  formatDuration,
  formatLong,
  greeting,
  startOfWeek,
  WEEKDAYS_SHORT,
  type Units,
} from '../../lib/format';
import { useClearLog, useTrainingLog, type WorkoutLog } from '../../data/training-log';
import { countdown, workoutStats } from '../../lib/presenters';
import { planSports, systemsForSports } from '../../lib/sports';
import { useLocalToday } from '../../lib/use-local-today';
import { isCovered, volumeMeasure, workoutLook, workoutsOn } from '../../lib/workouts';
import { usePlanSelection } from '../../state/plan-selection';
import { effortTint, useSportUnits, useTheme, useUnits } from '../../state/settings';
import { alpha } from '../../theme/palette';

export default function TodayScreen() {
  const tabInset = useTabBarInset();
  const client = useQueryClient();
  const { selection } = usePlanSelection();
  const plans = useActivePlans();
  const plan = plans.data?.find((item) => item.id === selection?.planId) ?? plans.data?.[0];
  const today = useLocalToday();
  const [refreshing, setRefreshing] = useState(false);
  const theme = useTheme();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.accentText}
            onRefresh={() => {
              setRefreshing(true);
              void client.invalidateQueries().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <Text variant="label">{formatLong(today)}</Text>
          <Text variant="title" style={{ marginTop: 4 }}>
            {greeting()}
          </Text>
        </View>
        {plans.isPending ? (
          <LoadingState label="Loading today…" style={{ paddingHorizontal: 20 }} />
        ) : null}
        {plans.error ? (
          <ErrorState
            style={{ margin: 20 }}
            message={plans.error.message}
            onRetry={() => void plans.refetch()}
          />
        ) : null}
        {plans.data && !plan ? (
          <EmptyState
            style={{ margin: 20 }}
            icon="sparkles"
            title="Let’s build your plan"
            action={
              <>
                <StartPlanButton coachLabel="Talk to your coach" />
                <Button
                  label="All plans"
                  icon="library-outline"
                  variant="ghost"
                  onPress={() => router.push('/plans')}
                />
              </>
            }
          >
            Once a plan is locked and active, today’s session and your week appear here.
          </EmptyState>
        ) : null}
        {plan ? (
          <TrainingLogProvider key={plan.id} plan={plan}>
            <TodayForPlan plan={plan} today={today} />
          </TrainingLogProvider>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Today always shows the locked schedule; unpublished drafts are only signposted. */
function TodayForPlan({ plan, today }: { plan: Plan; today: string }) {
  const theme = useTheme();
  const { select } = usePlanSelection();
  const version = planVersion(plan, 'locked');
  const workouts = useWorkouts(version);
  const brief = useBriefState(plan.id, version);
  const units = useUnits(brief.data?.brief.unit);
  const coach = useCoachWord();
  const askIcon = useAskIcon();
  const chat = useOpenPlanChat(plan);
  const [selected, setSelected] = useState(today);
  useEffect(() => setSelected(today), [today]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(today), i)),
    [today],
  );
  const all = workouts.data ?? [];
  const logContext = useLogContext();
  const logs = logContext?.logs ?? [];
  const logged = (w: WorkoutSummary) => logs.find((l) => l.lineageId === w.lineageId);
  // Sessions still waiting for a log: this week's so far, and always the last three days. Ones
  // logged from this list stay on it (with Undo) until Today is next opened.
  const since = addDays(today, -3) < days[0]! ? addDays(today, -3) : days[0]!;
  const [quickLogged, setQuickLogged] = useState<string[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const recent = all.filter(
    (w) =>
      w.scheduledDate < today &&
      w.scheduledDate >= since &&
      (!logged(w) || quickLogged.includes(w.lineageId)),
  );
  const weekLog = useTrainingLog(plan.id, days[0], days[6]);
  const week = all.filter((w) => w.scheduledDate >= days[0]! && w.scheduledDate <= days[6]!);
  // Distance for running-only plans; time once other sports join, as their distances don't add.
  const measure = volumeMeasure(all);
  const amount = (w: WorkoutSummary) =>
    (measure === 'time' ? w.estimatedDurationSeconds : w.estimatedDistanceMetres) ?? 0;
  const formatAmount = (value: number, withUnit = true) =>
    measure === 'time' ? formatDuration(value) : formatDistance(value, units, withUnit);
  const weekAmount = week.reduce((sum, w) => sum + amount(w), 0);
  const completedAmount = (weekLog.data?.summary.bySport ?? []).reduce(
    (sum, sport) => sum + (measure === 'time' ? sport.actualSeconds : sport.actualMetres),
    0,
  );
  const sessionsDone = (weekLog.data?.summary.done ?? 0) + (weekLog.data?.summary.changed ?? 0);
  const maxDay = Math.max(
    ...days.map((d) => workoutsOn(week, d).reduce((sum, w) => sum + amount(w), 0)),
    1,
  );
  const selectedWorkouts = workoutsOn(all, selected);
  const nextWorkout = all.find((w) => w.scheduledDate > selected);
  // Where the week's unlogged sessions sit, so its count matches "Still to log" without sums.
  const pastUnlogged = week.filter((w) => w.scheduledDate < today && !logged(w)).length;
  const todayUnlogged = week.filter((w) => w.scheduledDate === today && !logged(w)).length;
  const upcoming = week.filter((w) => w.scheduledDate > today).length;
  const weekBreakdown =
    [
      pastUnlogged ? `${pastUnlogged} to log` : null,
      todayUnlogged ? 'today pending' : null,
      upcoming ? `${upcoming} upcoming` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'All logged';
  // Logged sessions without a recorded amount (time, or distance for running) must not read as
  // zero training.
  const untimed = sessionsDone > 0 && completedAmount === 0;
  const end = version?.endDate;
  const progress = planProgress(version?.startDate ?? null, end ?? null, today);
  const daysToEnd = end ? daysBetween(today, end) : null;
  // Count down to the next goal race when the coach marked one, else to the plan's end.
  const goal = all.find((w) => w.racePriority === 'A' && w.scheduledDate >= today);
  const performance = usePerformance().data;
  const sports = planSports(brief.data?.brief, all);
  const calibrated = systemsForSports(sports).some((system) => currentEntry(performance, system));
  const outsidePlan =
    (!!version?.startDate && selected < version.startDate) ||
    (!!version?.endDate && selected > version.endDate);
  const coverage = brief.data ? knownCoverage(brief.data) : null;
  const unplanned = !outsidePlan && !!coverage && !isCovered(selected, coverage);

  return (
    <>
      <PressableScale
        onPress={() => router.push('/plan')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 20,
          marginTop: 10,
        }}
      >
        <Badge
          label={progress?.text ?? plan.displayName}
          icon="calendar"
          color={theme.accentText}
          background={theme.accentSoft}
          style={{ flexShrink: 0 }}
        />
        <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
          {goal
            ? `${countdown(daysBetween(today, goal.scheduledDate))} · ${goal.title}`
            : daysToEnd !== null && daysToEnd >= 0
              ? `${daysToEnd} days to go`
              : plan.displayName}
        </Text>
      </PressableScale>

      {/* Week strip */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 22, gap: 6 }}>
        {days.map((d, i) => {
          const items = workoutsOn(all, d);
          const active = d === selected;
          const isToday = d === today;
          const dot = items[0] ? effortTint(theme, workoutLook(items[0]).effort) : 'transparent';
          // Past days show their log mark; today keeps its solid session dot until it is logged,
          // so hollow means only "past and still to log", as in the calendar and the week card.
          const status =
            items.length && d <= today && logContext?.ready
              ? logStatusFor(logs.filter((l) => items.some((w) => w.lineageId === l.lineageId)))
              : null;
          const mark = status === 'unlogged' && d === today ? null : status;
          return (
            <PressableScale
              key={d}
              haptic="select"
              onPress={() => setSelected(d)}
              accessibilityRole="button"
              accessibilityLabel={formatLong(d)}
              accessibilityState={{ selected: active }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 10,
                borderRadius: 18,
                backgroundColor: active ? theme.accent : theme.colors.surface,
                borderWidth: 1,
                borderColor: active
                  ? theme.accent
                  : isToday
                    ? theme.accentBorder
                    : theme.colors.border,
              }}
            >
              <Text
                variant="label"
                style={{
                  color: active ? theme.onAccent : theme.colors.textMuted,
                  opacity: active ? 0.7 : 1,
                }}
              >
                {WEEKDAYS_SHORT[i]!.slice(0, 1)}
              </Text>
              <Text
                variant="subheading"
                numeric
                style={{
                  marginTop: 4,
                  fontWeight: '800',
                  color: active ? theme.onAccent : theme.colors.text,
                }}
              >
                {dayNumber(d)}
              </Text>
              {mark ? (
                <View style={{ marginTop: 3 }}>
                  <LogMark status={mark} onAccent={active} />
                </View>
              ) : (
                <View
                  style={{
                    marginTop: 8,
                    marginBottom: 5,
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    // A rest day keeps the space but shows no dot.
                    backgroundColor: !items.length
                      ? 'transparent'
                      : active
                        ? theme.onAccent
                        : d > today
                          ? alpha(dot, theme.isDark ? 0.6 : 0.65)
                          : dot,
                  }}
                />
              )}
            </PressableScale>
          );
        })}
      </View>

      {/* Selected day's workouts */}
      <View style={{ paddingHorizontal: 20, marginTop: 20, gap: 12 }}>
        <Text variant="heading">
          {selected === today ? 'Today’s workout' : formatLong(selected)}
        </Text>
        {chat.error ? (
          <ErrorState
            message={`Couldn’t open your coach conversation: ${chat.error.message}`}
            onRetry={() => chat.mutate(chat.variables)}
          />
        ) : null}
        {workouts.isPending ? <LoadingState label="Loading schedule…" /> : null}
        {workouts.error ? (
          <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
        ) : null}
        {brief.error ? (
          <ErrorState
            message={`Couldn’t load this plan’s coverage: ${brief.error.message}`}
            onRetry={() => void brief.refetch()}
          />
        ) : null}
        {workouts.data && brief.data && !selectedWorkouts.length && (unplanned || outsidePlan) ? (
          <EmptyState
            icon="sparkles"
            dashed
            title={outsidePlan ? 'Outside your plan dates' : 'Not planned yet'}
            action={
              unplanned && !plan.archived ? (
                <Button
                  label={`Plan it with your ${coach}`}
                  icon={askIcon}
                  size="md"
                  busy={chat.isPending}
                  onPress={() => chat.mutate('Plan the remaining weeks')}
                />
              ) : undefined
            }
          >
            {outsidePlan
              ? 'This date falls outside the plan.'
              : 'This date is inside your plan but hasn’t been prescribed yet.'}
          </EmptyState>
        ) : null}
        {workouts.data && brief.data && !selectedWorkouts.length && !unplanned && !outsidePlan ? (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: theme.colors.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="moon" size={18} color={theme.colors.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="subheading" style={{ fontWeight: '800' }}>
                  Rest day
                </Text>
                <Text variant="caption">Easy walking, mobility work and good sleep.</Text>
              </View>
            </View>
            {nextWorkout ? (
              <PressableScale
                onPress={() => openWorkout(nextWorkout)}
                scaleTo={0.99}
                accessibilityRole="button"
                accessibilityLabel={`Next: ${nextWorkout.title}, ${formatLong(nextWorkout.scheduledDate)}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingTop: 12,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}
              >
                <KindIcon
                  icon={workoutLook(nextWorkout).icon}
                  color={effortTint(theme, workoutLook(nextWorkout).effort)}
                  size={32}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
                    Next ·{' '}
                    {nextWorkout.scheduledDate === addDays(selected, 1)
                      ? 'Tomorrow'
                      : formatLong(nextWorkout.scheduledDate)}
                  </Text>
                  <Text
                    variant="caption"
                    color="text"
                    numberOfLines={1}
                    style={{ fontWeight: '700' }}
                  >
                    {nextWorkout.title}
                    {nextWorkout.estimatedDurationSeconds ? (
                      <Text variant="caption" color="muted" numeric>
                        {` · ${formatDuration(nextWorkout.estimatedDurationSeconds)}`}
                      </Text>
                    ) : null}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
              </PressableScale>
            ) : null}
          </Card>
        ) : null}
        {selectedWorkouts.map((workout) => (
          <HeroWorkout key={workout.id} workout={workout} version={version} units={units} />
        ))}
        {recent.length && logContext?.ready && logContext.writable ? (
          <Card style={{ gap: 4, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Ionicons name="time-outline" size={14} color={theme.colors.textMuted} />
              <Text variant="label" style={{ flex: 1 }}>
                Still to log
              </Text>
              <Text variant="caption" color="muted" numeric>
                {recent.filter((w) => !logged(w)).length || ''}
              </Text>
            </View>
            {(showAllRecent ? recent : recent.slice(0, 2)).map((workout) => (
              <CatchUpRow
                key={workout.id}
                workout={workout}
                log={logged(workout)}
                onLogged={() => setQuickLogged((ids) => [...ids, workout.lineageId])}
              />
            ))}
            {recent.length > 2 && !showAllRecent ? (
              <Pressable
                onPress={() => setShowAllRecent(true)}
                accessibilityRole="button"
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 6 }}
              >
                <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
                  {`${recent.length - 2} more to log`}
                </Text>
                <Ionicons name="chevron-down" size={14} color={theme.accentText} />
              </Pressable>
            ) : null}
          </Card>
        ) : null}
        <CheckInButton plan={plan} />
      </View>

      {/* Draft banner */}
      {plan.draft ? (
        <PressableScale
          onPress={() => {
            select({ planId: plan.id, view: 'draft' });
            router.push('/plan');
          }}
          style={{
            marginHorizontal: 20,
            marginTop: 16,
            padding: 14,
            borderRadius: 20,
            backgroundColor: theme.accentSoft,
            borderWidth: 1,
            borderColor: theme.accentBorder,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: theme.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="sparkles" size={18} color={theme.onAccent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="subheading">Your plan has an unpublished draft</Text>
            <Text variant="caption">Review the changes, then lock to make them your schedule.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.accentText} />
        </PressableScale>
      ) : null}

      {/* Week overview */}
      <SectionHeader title="This week" action="See plan" onAction={() => router.push('/plan')} />
      <View style={{ paddingHorizontal: 20 }}>
        <Card>
          {/* Labels share a top line. Without recorded time, sessions lead and time is a note. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            {untimed ? (
              <View>
                <Text variant="label">Sessions logged</Text>
                <Text variant="title" numeric style={{ marginTop: 4 }}>
                  {sessionsDone} of {week.length}
                </Text>
                <Text variant="caption" color="muted">
                  {formatAmount(weekAmount)} planned · no {measure === 'time' ? 'time' : 'distance'}{' '}
                  logged yet
                </Text>
              </View>
            ) : (
              <View>
                <Text variant="label">{measure === 'time' ? 'Done time' : 'Done distance'}</Text>
                <View
                  style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}
                >
                  <Text variant="title" numeric>
                    {formatAmount(completedAmount, false)}
                  </Text>
                  {measure === 'distance' ? (
                    <Text variant="body" color="dim" numeric>
                      {units}
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" color="muted">
                  of {formatAmount(weekAmount)} planned
                </Text>
              </View>
            )}
            {untimed ? null : (
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="label">Sessions</Text>
                <Text variant="heading" numeric style={{ marginTop: 4 }}>
                  {`${sessionsDone} / ${week.length}`}
                </Text>
              </View>
            )}
          </View>
          {/* Full width under the headline, so the breakdown can wrap rather than overflow. */}
          <Text variant="caption" color="text" numeric style={{ marginTop: 6 }}>
            {weekBreakdown}
          </Text>
          <View style={{ marginTop: 14 }}>
            {/* Without recorded time, progress follows sessions logged. */}
            <ProgressBar
              value={
                untimed
                  ? sessionsDone / Math.max(1, week.length)
                  : weekAmount
                    ? Math.min(1, completedAmount / weekAmount)
                    : 0
              }
            />
          </View>
          <Text variant="label" style={{ marginTop: 18, fontSize: 9.5 }}>
            {measure === 'time' ? 'Planned minutes per day' : `Planned ${units} per day`}
          </Text>
          <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
            Faded: upcoming · Ring: to log · Outlined: today
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 8,
              height: 64,
              marginTop: 6,
            }}
          >
            {days.map((d, i) => {
              const items = workoutsOn(week, d);
              const value = items.reduce((sum, w) => sum + amount(w), 0);
              const color = items[0]
                ? effortTint(theme, workoutLook(items[0]).effort)
                : theme.colors.border;
              // As the calendar: logged and today solid, upcoming faded, past unlogged hollow.
              // "To log" means no log at all; a skipped session is logged.
              const hollow = items.length > 0 && d < today && !items.some((w) => logged(w));
              return (
                <View key={d} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                  <View style={{ flex: 1, justifyContent: 'flex-end', width: '100%' }}>
                    <View
                      style={{
                        width: items.length ? '100%' : 6,
                        alignSelf: 'center',
                        height: items.length ? Math.max(8, (value / maxDay) * 40) : 6,
                        borderRadius: 6,
                        // A rest day is a short visible stub, not an empty gap.
                        backgroundColor: hollow
                          ? 'transparent'
                          : items.length
                            ? color
                            : theme.colors.textMuted,
                        opacity: items.length && d > today ? (theme.isDark ? 0.6 : 0.65) : 1,
                        borderWidth: d === today ? 2 : hollow ? 1.5 : 0,
                        borderColor: d === today ? theme.colors.text : color,
                      }}
                    />
                  </View>
                  <Text variant="label" style={{ fontSize: 9.5 }}>
                    {WEEKDAYS_SHORT[i]!.slice(0, 1)}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>
      </View>

      {calibrated ? (
        <>
          <SectionHeader
            title={`Your ${zonesTitle(sports).toLowerCase()}`}
            action="Details"
            onAction={() => router.push('/performance')}
          />
          <ZoneCards sports={sports} units={units} />
        </>
      ) : null}
    </>
  );
}

function HeroWorkout({
  workout,
  version,
  units,
}: {
  workout: WorkoutSummary;
  version: PlanVersion | null;
  units: Units;
}) {
  const theme = useTheme();
  const { pool } = useSportUnits();
  const look = workoutLook(workout);
  const color = effortTint(theme, look.effort);
  const detail = useWorkoutDetail(workout.placeholder ? undefined : workout.id, version);
  const logContext = useLogContext();
  const today = useLocalToday();
  // The log sits inside the card once the workout is due (or already logged).
  const showLog =
    !!logContext?.ready &&
    (workout.scheduledDate <= today ||
      logContext.logs.some((l) => l.lineageId === workout.lineageId));
  return (
    <View
      style={{
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: alpha(color, 0.35),
        backgroundColor: theme.colors.surface,
      }}
    >
      <PressableScale
        onPress={() => openWorkout(workout)}
        scaleTo={0.985}
        accessibilityRole="button"
        accessibilityLabel={`${workout.title}, ${look.label}. Open workout`}
      >
        <LinearGradient
          colors={[alpha(color, theme.isDark ? 0.32 : 0.22), alpha(color, 0)]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{ position: 'absolute', inset: 0 }}
        />
        <View style={{ padding: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name={look.icon} size={16} color={color} />
            <Text variant="label" style={{ color, flex: 1 }}>
              {look.label}
              {workout.placeholder ? ' · Placeholder' : ''}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </View>
          <Text variant="title" style={{ marginTop: 8 }}>
            {workout.title}
          </Text>
          {workout.purpose ? (
            <Text variant="body" color="dim" style={{ marginTop: 6 }} numberOfLines={2}>
              {workout.purpose}
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              columnGap: 28,
              rowGap: 12,
              marginTop: 14,
            }}
          >
            {workoutStats(workout, units, pool).map((stat) => (
              <Stat key={stat.label} {...stat} />
            ))}
          </View>
          {workout.placeholder ? (
            <View style={{ marginTop: 12 }}>
              <PlaceholderBand workout={workout} />
            </View>
          ) : detail.data ? (
            <View style={{ marginTop: 12 }}>
              <IntensityChart prescription={detail.data.prescription} height={32} animate />
            </View>
          ) : null}
        </View>
      </PressableScale>
      {showLog ? (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: alpha(color, 0.35),
            backgroundColor: alpha(theme.colors.surfaceRaised, 0.5),
          }}
        >
          <WorkoutLogActions workout={workout} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A recent session in "Still to log": its name across the row, then its date and length beside
 * Done or Skip. Once logged it shows the result with Undo, so a mistaken tap is easy to take back.
 */
function CatchUpRow({
  workout,
  log,
  onLogged,
}: {
  workout: WorkoutSummary;
  log: WorkoutLog | undefined;
  onLogged: () => void;
}) {
  const theme = useTheme();
  const look = workoutLook(workout);
  const clear = useClearLog(workout.planId, workout.lineageId);
  return (
    <View style={{ gap: 8, paddingVertical: 6 }}>
      <PressableScale
        onPress={() => openWorkout(workout)}
        scaleTo={0.99}
        accessibilityRole="button"
        accessibilityLabel={`${workout.title}, ${formatLong(workout.scheduledDate)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <KindIcon icon={look.icon} color={effortTint(theme, look.effort)} size={32} />
        <Text
          variant="caption"
          color="text"
          numberOfLines={2}
          style={{ flex: 1, fontWeight: '700' }}
        >
          {workout.title}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
      </PressableScale>
      {/* When and how long on the left, the log on the right: one line, as on the Plan tab. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 42 }}>
        <Text variant="caption" color="muted" numeric style={{ flex: 1, fontSize: 12 }}>
          {formatDay(workout.scheduledDate)}
          {workout.estimatedDurationSeconds
            ? ` · ${formatDuration(workout.estimatedDurationSeconds)}`
            : ''}
        </Text>
        {log ? (
          <>
            <LogChip log={log} />
            <IconButton
              icon="arrow-undo"
              size={16}
              tone="filled"
              accessibilityLabel={`Undo log for ${workout.title}`}
              onPress={clear.isPending ? undefined : () => clear.mutate()}
            />
          </>
        ) : (
          <WorkoutLogActions workout={workout} variant="row" onLogged={onLogged} />
        )}
      </View>
      {clear.error ? <ErrorState message={clear.error.message} /> : null}
    </View>
  );
}
