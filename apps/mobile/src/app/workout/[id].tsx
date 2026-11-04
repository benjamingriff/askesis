import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IntensityChart } from '../../components/IntensityChart';
import { StepList } from '../../components/StepList';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  IconButton,
  LoadingState,
  Screen,
  Stat,
  Text,
} from '../../components/ui';
import { useCoachWord } from '../../data/account';
import { useOpenPlanChat } from '../../data/plan-actions';
import { useBriefState, usePlan, useWorkoutDetail, planVersion } from '../../data/plan-data';
import { formatLong } from '../../lib/format';
import { workoutStats } from '../../lib/presenters';
import { intensitySegments, RACE_META, workoutLook } from '../../lib/workouts';
import { effortTint, useSportUnits, useTheme, useUnits } from '../../state/settings';
import { alpha, EFFORT_META, EFFORTS } from '../../theme/palette';

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
  const efforts = new Set(intensitySegments(detail.data!.prescription).map((s) => s.effort));
  const archived = plan.data?.archived;

  return (
    <Screen top={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 }}>
            <Ionicons name={look.icon} size={16} color={color} />
            <Text variant="label" style={{ color }}>
              {look.label}
              {workout.racePriority ? ` · ${RACE_META[workout.racePriority].label}` : ''}
            </Text>
            {workout.priority === 'high' && !workout.racePriority ? (
              <Text variant="label" color="dim">
                · Key session
              </Text>
            ) : null}
          </View>
          <Text variant="title" style={{ marginTop: 8, fontSize: 34, lineHeight: 40 }}>
            {workout.title}
          </Text>
          <Text variant="caption" style={{ marginTop: 6 }}>
            {formatLong(workout.scheduledDate)} · Week {workout.weekNumber} · {workout.planTitle}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              columnGap: 32,
              rowGap: 12,
              marginTop: 24,
            }}
          >
            {workoutStats(workout, units, pool).map((stat) => (
              <Stat key={stat.label} {...stat} size={28} />
            ))}
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          {workout.purpose || workout.description ? (
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
                <Ionicons name="chatbubble-ellipses" size={16} color={theme.accentText} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text variant="label">{coach === 'coach' ? 'Coach says' : 'Agent says'}</Text>
                {workout.purpose ? <Text variant="body">{workout.purpose}</Text> : null}
                {workout.description ? (
                  <Text variant="body" color="dim">
                    {workout.description}
                  </Text>
                ) : null}
              </View>
            </Card>
          ) : null}

          <Card>
            <Text variant="label" style={{ marginBottom: 14 }}>
              Effort profile
            </Text>
            <IntensityChart prescription={detail.data!.prescription} height={96} gap={2} animate />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
              {EFFORTS.filter((effort) => efforts.has(effort)).map((effort) => (
                <View key={effort} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      backgroundColor: theme.efforts[effort],
                    }}
                  />
                  <Text variant="caption" style={{ fontSize: 12 }}>
                    {EFFORT_META[effort].label}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          {detail.data!.tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {detail.data!.tags.map((tag) => (
                <Badge
                  key={tag}
                  label={tag.replaceAll('-', ' ')}
                  color={theme.colors.textDim}
                  background={theme.colors.surfaceRaised}
                />
              ))}
            </View>
          ) : null}

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
          {chat.error ? (
            <ErrorState
              message={`Couldn’t open your coach conversation: ${chat.error.message}`}
              onRetry={() => chat.mutate(chat.variables)}
            />
          ) : null}
        </View>
      </ScrollView>

      {archived ? null : (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 14),
            backgroundColor: theme.colors.bg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <Button
            label={`Ask your ${coach} about this`}
            icon="chatbubble-ellipses"
            busy={chat.isPending}
            onPress={() => chat.mutate(`About “${workout.title}” on ${workout.scheduledDate}: `)}
          />
        </View>
      )}
    </Screen>
  );
}
