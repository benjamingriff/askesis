import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IntensityChart } from '../../components/IntensityChart';
import { StepList } from '../../components/StepList';
import {
  TrainingLogProvider,
  WorkoutLogActions,
  useLogContext,
} from '../../components/TrainingLog';
import { PlaceholderSummary } from '../../components/WorkoutRow';
import {
  Button,
  Card,
  ErrorState,
  IconButton,
  LoadingState,
  Screen,
  Stat,
  Text,
} from '../../components/ui';
import { useAskAgent, useAskIcon, useCoachWord } from '../../data/account';
import { useOpenPlanChat } from '../../data/plan-actions';
import { useBriefState, usePlan, useWorkoutDetail, planVersion } from '../../data/plan-data';
import type { WorkoutSummary } from '../../lib/api-types';
import { agentPrompt } from '../../lib/coach';
import { formatLong } from '../../lib/format';
import { useLocalToday } from '../../lib/use-local-today';
import { workoutStats } from '../../lib/presenters';
import { RACE_META, workoutLook } from '../../lib/workouts';
import { effortTint, useSportUnits, useTheme, useUnits } from '../../state/settings';
import { alpha } from '../../theme/palette';

/** Workout detail: kind header, key numbers, effort profile and the full prescription. */
export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { pool } = useSportUnits();
  const detail = useWorkoutDetail(id);
  const workout = detail.data?.workout;
  const plan = usePlan(workout?.planId ?? null);
  const version = plan.data
    ? ([plan.data.locked, plan.data.draft].find((v) => v?.id === workout?.planVersionId) ??
      planVersion(plan.data, 'locked'))
    : null;
  const brief = useBriefState(workout?.planId ?? '', version ?? null);
  const units = useUnits(brief.data?.brief.unit);
  const coach = useCoachWord();
  const askIcon = useAskIcon(true);
  const askAgent = useAskAgent();
  const chat = useOpenPlanChat({
    id: workout?.planId ?? '',
    displayName: plan.data?.displayName ?? '',
  });

  if (!workout)
    return (
      <Screen>
        <View style={{ padding: 20, gap: 20 }}>
          <IconButton
            icon="chevron-back"
            tone="filled"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          />
          {detail.error ? (
            <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
          ) : (
            <LoadingState label="Loading workout…" />
          )}
        </View>
      </Screen>
    );

  const look = workoutLook(workout);
  const color = effortTint(theme, look.effort);
  const archived = plan.data?.archived;
  // A description copied from the plan's own says nothing about this session.
  const about =
    workout.description && workout.description !== version?.description
      ? workout.description
      : null;
  const placeholder = workout.placeholder;

  const screen = (
    <Screen top={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 18 }}>
          <LinearGradient
            colors={[alpha(color, theme.isDark ? 0.4 : 0.28), alpha(color, 0)]}
            style={{ position: 'absolute', inset: 0 }}
          />
          <IconButton
            icon="chevron-back"
            tone="filled"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <Ionicons name={look.icon} size={16} color={color} />
            <Text variant="label" style={{ color }}>
              {look.label}
              {workout.racePriority ? ` · ${RACE_META[workout.racePriority].label}` : ''}
              {placeholder ? ' · Placeholder' : ''}
            </Text>
            {workout.priority === 'high' && !workout.racePriority ? (
              <Text variant="label" color="dim">
                · Key session
              </Text>
            ) : null}
          </View>
          <Text variant="title" style={{ marginTop: 6, fontSize: 30, lineHeight: 36 }}>
            {workout.title}
          </Text>
          <Text variant="caption" style={{ marginTop: 6 }}>
            {formatLong(workout.scheduledDate)} · Week {workout.weekNumber}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              columnGap: 32,
              rowGap: 12,
              marginTop: 16,
            }}
          >
            {workoutStats(workout, units, pool).map((stat) => (
              <Stat
                key={stat.label}
                {...stat}
                label={
                  stat.label === 'Time' || stat.label === 'Distance'
                    ? `Planned ${stat.label.toLowerCase()}`
                    : stat.label
                }
                size={28}
              />
            ))}
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          <LogCard workout={workout} />

          {placeholder ? <PlaceholderSummary workout={workout} /> : null}

          {/* The prescription comes before the background: it's what the athlete came for. */}
          {placeholder ? null : (
            <Card style={{ padding: 14 }}>
              <Text variant="label" style={{ marginBottom: 10 }}>
                Effort profile
              </Text>
              <IntensityChart
                prescription={detail.data!.prescription}
                height={48}
                gap={2}
                animate
              />
            </Card>
          )}

          {placeholder ? null : (
            <View>
              <Text variant="heading" style={{ marginBottom: 14 }}>
                {look.kind === 'strength' ? 'Exercises' : 'Workout steps'}
              </Text>
              <StepList
                prescription={detail.data!.prescription}
                units={units}
                mixed={workout.discipline === 'mixed'}
              />
            </View>
          )}

          {workout.purpose || about ? (
            <Card style={{ flexDirection: 'row', gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.colors.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="flag-outline" size={16} color={theme.accentText} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text variant="label">Why this session</Text>
                {workout.purpose ? <Text variant="body">{workout.purpose}</Text> : null}
                {about ? (
                  <Text variant="body" color="dim">
                    {about}
                  </Text>
                ) : null}
              </View>
            </Card>
          ) : null}

          {archived ? null : (
            <Button
              label={`Ask your ${coach} about this`}
              icon={askIcon}
              variant="secondary"
              busy={chat.isPending}
              onPress={() => {
                const request = `About “${workout.title}” on ${workout.scheduledDate}: `;
                // The agent's hand-off names this session, not just the plan.
                if (coach === 'agent')
                  askAgent(
                    agentPrompt(request, { id: workout.planId, name: plan.data?.displayName }),
                    `${workout.title}\n${formatLong(workout.scheduledDate)}`,
                  );
                else chat.mutate(request);
              }}
              style={{ marginTop: 8 }}
            />
          )}
          {chat.error ? (
            <ErrorState
              message={`Couldn’t open your coach conversation: ${chat.error.message}`}
              onRetry={() => chat.mutate(chat.variables)}
            />
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
  return plan.data ? <TrainingLogProvider plan={plan.data}>{screen}</TrainingLogProvider> : screen;
}

/** The workout's log, once it's due: quick log, effort and what was recorded. */
function LogCard({ workout }: { workout: WorkoutSummary }) {
  const context = useLogContext();
  const today = useLocalToday();
  const logged = context?.logs.some((l) => l.lineageId === workout.lineageId);
  if (!context?.ready || (!logged && workout.scheduledDate > today)) return null;
  return (
    <Card style={{ padding: 18 }}>
      <WorkoutLogActions workout={workout} variant="detail" />
    </Card>
  );
}
