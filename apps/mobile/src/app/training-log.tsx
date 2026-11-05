import { router, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogChip, openLogForm } from '../components/TrainingLog';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  KindIcon,
  LoadingState,
  Screen,
  ScreenHeader,
  Stat,
  Text,
} from '../components/ui';
import { planVersion, useBriefState, usePlan, useWorkouts } from '../data/plan-data';
import { effortFlag, loggedWorkout, useTrainingLog } from '../data/training-log';
import { formatDistance, formatDuration, formatLong, formatSwimDistance } from '../lib/format';
import { KIND_META, workoutLook } from '../lib/workouts';
import { effortTint, useSportUnits, useTheme, useUnits } from '../state/settings';

/** Every recorded session for a plan, including workouts from earlier plan versions. */
export default function TrainingLogScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const plan = usePlan(planId ?? null);
  const version = plan.data ? planVersion(plan.data, 'locked') : null;
  const workouts = useWorkouts(version).data ?? [];
  const brief = useBriefState(planId ?? '', version);
  const units = useUnits(brief.data?.brief.unit);
  const { pool } = useSportUnits();
  const query = useTrainingLog(planId);
  const writable = !!plan.data?.locked && !plan.data.archived;
  const logs = [...(query.data?.logs ?? [])].reverse();
  const summary = query.data?.summary;
  const totalSeconds = (summary?.bySport ?? []).reduce((sum, s) => sum + s.actualSeconds, 0);

  return (
    <Screen>
      <ScreenHeader
        title="Training log"
        subtitle={plan.data?.displayName}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            tintColor={theme.accentText}
            onRefresh={() => void query.refetch()}
          />
        }
      >
        <Text variant="body" color="dim">
          Your recorded sessions, including workouts from earlier plan versions.
        </Text>
        {query.isPending ? <LoadingState label="Loading log…" /> : null}
        {query.error ? (
          <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        ) : null}
        {summary && logs.length ? (
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Stat label="Done" value={String(summary.done + summary.changed)} size={22} />
            <Stat label="Skipped" value={String(summary.skipped)} size={22} />
            <Stat label="Time" value={formatDuration(totalSeconds)} size={22} />
          </Card>
        ) : null}
        {query.data && !logs.length ? (
          <EmptyState icon="checkmark-done-outline" title="No workouts logged yet" dashed>
            Open a due workout or use Today to record one.
          </EmptyState>
        ) : null}
        {logs.map((log) => {
          const found = workouts.find((w) => w.lineageId === log.lineageId);
          const workout = loggedWorkout(log, found);
          const look = workoutLook(workout);
          const color = effortTint(theme, look.effort);
          const flag = effortFlag(log);
          return (
            <Card key={log.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <KindIcon icon={look.icon} color={color} />
                <View style={{ flex: 1 }}>
                  <Text variant="subheading" numberOfLines={2}>
                    {log.title}
                  </Text>
                  <Text variant="caption" color="muted">
                    {formatLong(log.performedOn)}
                  </Text>
                </View>
                <LogChip log={log} />
              </View>
              <Text variant="caption">
                {log.actualDurationSeconds == null
                  ? 'Time not recorded'
                  : formatDuration(log.actualDurationSeconds)}
                {log.actualDistanceMetres == null
                  ? ''
                  : ` · ${
                      log.discipline === 'swim'
                        ? formatSwimDistance(log.actualDistanceMetres, pool)
                        : formatDistance(log.actualDistanceMetres, units)
                    }`}
                {log.actualSessionType
                  ? ` · Was ${KIND_META[log.actualSessionType].label.toLowerCase()}`
                  : ''}
                {flag ? ` · ${flag}` : ''}
                {!found ? ' · From an earlier plan version' : ''}
              </Text>
              {log.note ? (
                <Text variant="body" color="dim" numberOfLines={4}>
                  {log.note}
                </Text>
              ) : null}
              {writable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="pencil"
                  label="Edit log"
                  style={{ alignSelf: 'flex-start' }}
                  onPress={() => openLogForm(workout, { current: !!found })}
                />
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
