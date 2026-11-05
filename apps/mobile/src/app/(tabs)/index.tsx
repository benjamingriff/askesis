import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTabBarInset } from '../../components/FloatingTabBar';
import { IntensityChart } from '../../components/IntensityChart';
import { ZoneCards, zonesTitle } from '../../components/PlanWidgets';
import { openWorkout, planProgress } from '../../components/PlanView';
import {
  CheckInButton,
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
import { useCoachWord } from '../../data/account';
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
  formatDistance,
  formatDuration,
  formatLong,
  greeting,
  startOfWeek,
  WEEKDAYS_SHORT,
  type Units,
} from '../../lib/format';
import { useTrainingLog } from '../../data/training-log';
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
  // The last few days' sessions still waiting for a log, above today's.
  const recent = all.filter(
    (w) => w.scheduledDate < today && w.scheduledDate >= addDays(today, -3) && !logged(w),
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
              ? `${daysToEnd} days to go · ${plan.displayName}`
              : plan.displayName}
        </Text>
      </PressableScale>

      {/* Week strip */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 22, gap: 6 }}>
        {days.map((d, i) => {
          const items = workoutsOn(all, d);
          const active = d === selected;
          const isToday = d === today;
          const dot = items[0]
            ? effortTint(theme, workoutLook(items[0]).effort)
            : theme.colors.border;
          const mark =
            items.length && d <= today && logContext?.ready
              ? logStatusFor(logs.filter((l) => items.some((w) => w.lineageId === l.lineageId)))
              : null;
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
                    backgroundColor: active ? theme.onAccent : dot,
                  }}
                />
              )}
            </PressableScale>
          );
        })}
      </View>

      {/* Selected day's workouts */}
      <View style={{ paddingHorizontal: 20, marginTop: 20, gap: 12 }}>
        <Text variant="caption" style={{ fontWeight: '700' }}>
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
                  icon="chatbubble-ellipses"
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
          <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: theme.colors.surfaceRaised,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="moon" size={24} color={theme.colors.textDim} />
            </View>
            <Text variant="heading" style={{ marginTop: 14 }}>
              Rest day
            </Text>
            <Text
              variant="body"
              color="dim"
              style={{ textAlign: 'center', marginTop: 6, maxWidth: 280 }}
            >
              Nothing is scheduled. Easy walking, mobility work and good sleep.
            </Text>
          </Card>
        ) : null}
        {selectedWorkouts.map((workout) => (
          <HeroWorkout key={workout.id} workout={workout} version={version} units={units} />
        ))}
        {recent.length && logContext?.ready && logContext.writable ? (
          <Card style={{ gap: 4, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Ionicons name="time-outline" size={14} color={theme.colors.textMuted} />
              <Text variant="label">Still to log</Text>
            </View>
            {recent.map((workout) => {
              const look = workoutLook(workout);
              return (
                <View
                  key={workout.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 6,
                  }}
                >
                  <PressableScale
                    onPress={() => openWorkout(workout)}
                    scaleTo={0.99}
                    accessibilityRole="button"
                    accessibilityLabel={`${workout.title}, ${formatLong(workout.scheduledDate)}`}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <KindIcon icon={look.icon} color={effortTint(theme, look.effort)} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
                        {formatLong(workout.scheduledDate)}
                      </Text>
                      <Text
                        variant="caption"
                        color="text"
                        numberOfLines={1}
                        style={{ fontWeight: '700' }}
                      >
                        {workout.title}
                      </Text>
                    </View>
                  </PressableScale>
                  <WorkoutLogActions workout={workout} variant="inline" />
                </View>
              );
            })}
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
            }}
          >
            <View>
              <Text variant="label">{measure === 'time' ? 'Done time' : 'Done distance'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
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
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="label">Sessions</Text>
              <Text variant="heading" numeric style={{ marginTop: 4 }}>
                {sessionsDone} / {week.length}
              </Text>
              <Text variant="caption" color="muted">
                {weekLog.data?.summary.unlogged ?? 0} to log
              </Text>
            </View>
          </View>
          <View style={{ marginTop: 14 }}>
            <ProgressBar value={weekAmount ? Math.min(1, completedAmount / weekAmount) : 0} />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 8,
              height: 64,
              marginTop: 18,
            }}
          >
            {days.map((d, i) => {
              const items = workoutsOn(week, d);
              const value = items.reduce((sum, w) => sum + amount(w), 0);
              const color = items[0]
                ? effortTint(theme, workoutLook(items[0]).effort)
                : theme.colors.border;
              // Logged days stay bright; past days without a log fade.
              const done = items.some((w) => {
                const log = logged(w);
                return !!log && log.status !== 'skipped';
              });
              return (
                <View key={d} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                  <View style={{ flex: 1, justifyContent: 'flex-end', width: '100%' }}>
                    <View
                      style={{
                        width: '100%',
                        height: value ? Math.max(8, (value / maxDay) * 40) : 4,
                        borderRadius: 6,
                        backgroundColor: color,
                        opacity: d < today && !done ? 0.35 : 1,
                        borderWidth: d === today ? 2 : 0,
                        borderColor: theme.colors.text,
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
              marginTop: 18,
            }}
          >
            {workoutStats(workout, units, pool).map((stat) => (
              <Stat key={stat.label} {...stat} />
            ))}
          </View>
          {workout.placeholder ? (
            <View style={{ marginTop: 20 }}>
              <PlaceholderBand workout={workout} />
            </View>
          ) : detail.data ? (
            <View style={{ marginTop: 20 }}>
              <IntensityChart prescription={detail.data.prescription} height={56} animate />
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
