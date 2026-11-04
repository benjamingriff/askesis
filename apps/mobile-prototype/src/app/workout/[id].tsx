import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '../../components/BottomSheet';
import { IntensityChart } from '../../components/IntensityChart';
import { StepList } from '../../components/StepList';
import {
  Button,
  Card,
  IconButton,
  PressableScale,
  Screen,
  Text,
  useHaptics,
} from '../../components/ui';
import {
  dayNumber,
  formatLong,
  WEEKDAYS_LONG,
  weekDates,
  startOfWeek,
  weekdayIndex,
} from '../../data/dates';
import { weekNumberFor } from '../../data/seed';
import { KIND_META } from '../../lib/kinds';
import {
  flattenSegments,
  formatDistance,
  formatDuration,
  formatPace,
  PACE_GUIDES,
  workoutTotals,
  ZONE_ORDER,
} from '../../lib/metrics';
import { workoutOn } from '../../lib/plan-selectors';
import { usePlan } from '../../state/plan';
import { useSettings, useTheme } from '../../state/settings';
import { alpha, ZONE_COLORS } from '../../theme/palette';

export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const buzz = useHaptics();
  const { getWorkout, workouts, today, status, moveWorkout, unlock, meta, version } = usePlan();
  const workout = getWorkout(String(id));
  const [moveOpen, setMoveOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [toast, toastAnim]);

  if (!workout) {
    return (
      <Screen>
        <View style={{ padding: 20 }}>
          <IconButton
            icon="chevron-back"
            tone="filled"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          />
          <Text variant="heading" style={{ marginTop: 24 }}>
            Workout not found
          </Text>
        </View>
      </Screen>
    );
  }

  const kind = KIND_META[workout.kind];
  const totals = workoutTotals(workout);
  const isRest = workout.kind === 'rest';
  const isStrength = workout.kind === 'strength';
  const past = workout.date < today;
  const zonesUsed = ZONE_ORDER.filter((z) =>
    flattenSegments(workout.steps).some((s) => s.zone === z),
  );
  const weekNo = weekNumberFor(meta, workout.date);
  const weekStart = startOfWeek(workout.date);

  const askCoach = () =>
    router.push(
      `/chat/c-extend?prefill=${encodeURIComponent(`About ${workout.title} on ${WEEKDAYS_LONG[weekdayIndex(workout.date)]}: `)}`,
    );

  const move = (toDate: string) => {
    const result = moveWorkout(workout.id, toDate);
    if (result.ok) {
      buzz('success');
      setMoveOpen(false);
      setToast(`Moved to ${WEEKDAYS_LONG[weekdayIndex(toDate)]}`);
    }
  };

  return (
    <Screen top={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: 20,
            paddingBottom: 24,
            overflow: 'hidden',
          }}
        >
          <LinearGradient
            colors={[alpha(kind.color, theme.isDark ? 0.4 : 0.28), alpha(kind.color, 0)]}
            style={{ position: 'absolute', inset: 0 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <IconButton
              icon="chevron-back"
              tone="filled"
              accessibilityLabel="Back"
              onPress={() => router.back()}
            />
            {!isRest && !past ? (
              <IconButton
                icon="swap-horizontal"
                tone="filled"
                accessibilityLabel="Move workout"
                onPress={() => setMoveOpen(true)}
              />
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 }}>
            <Ionicons name={kind.icon} size={16} color={kind.color} />
            <Text variant="label" style={{ color: kind.color }}>
              {kind.label}
            </Text>
            {past ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="checkmark-circle" size={14} color={KIND_META.easy.color} />
                <Text variant="label" style={{ color: KIND_META.easy.color }}>
                  Done
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="title" style={{ marginTop: 8, fontSize: 34, lineHeight: 40 }}>
            {workout.title}
          </Text>
          <Text variant="caption" style={{ marginTop: 6 }}>
            {formatLong(workout.date)} · Week {weekNo}
          </Text>

          {!isRest ? (
            <View style={{ flexDirection: 'row', gap: 32, marginTop: 24 }}>
              {!isStrength ? (
                <Stat
                  label="Distance"
                  value={formatDistance(totals.meters, settings.units, false)}
                  unit={settings.units}
                />
              ) : null}
              <Stat label="Time" value={formatDuration(totals.seconds)} />
              {!isStrength ? (
                <Stat
                  label="Avg pace"
                  value={formatPace((totals.seconds / totals.meters) * 1000, settings.units, false)}
                  unit={`/${settings.units}`}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          {workout.change ? (
            <View
              style={{
                flexDirection: 'row',
                gap: 12,
                padding: 14,
                borderRadius: 20,
                backgroundColor: theme.accentSoft,
                borderWidth: 1,
                borderColor: theme.accentBorder,
              }}
            >
              <Ionicons
                name="sparkles"
                size={18}
                color={theme.accentText}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1 }}>
                <Text variant="subheading">
                  {workout.change === 'new' ? 'New in draft' : 'Edited in draft'}
                </Text>
                <Text variant="caption" style={{ marginTop: 2 }}>
                  {workout.changeNote ?? 'Added by your coach in this draft.'}
                </Text>
              </View>
            </View>
          ) : null}

          {!isRest ? (
            <Card>
              <Text variant="label" style={{ marginBottom: 14 }}>
                Effort profile
              </Text>
              <IntensityChart steps={workout.steps} height={96} gap={2} animate />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
                {isStrength ? (
                  <Legend color={KIND_META.strength.color} label="Strength work" />
                ) : (
                  zonesUsed.map((z) => (
                    <Legend key={z} color={ZONE_COLORS[z]} label={PACE_GUIDES[z].label} />
                  ))
                )}
              </View>
            </Card>
          ) : null}

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
            <View style={{ flex: 1 }}>
              <Text variant="label">Coach says</Text>
              <Text variant="body" style={{ marginTop: 4 }}>
                {workout.coachNote ?? workout.blurb}
              </Text>
            </View>
          </Card>

          {!isRest ? (
            <View>
              <Text variant="heading" style={{ marginBottom: 14 }}>
                {isStrength ? 'Exercises' : 'Workout steps'}
              </Text>
              <StepList steps={workout.steps} />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Action bar */}
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
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Button
          label="Ask coach to adjust"
          icon="chatbubble-ellipses"
          onPress={askCoach}
          style={{ flex: 1 }}
        />
      </View>

      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top + 8,
            alignSelf: 'center',
            paddingHorizontal: 16,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.colors.text,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            opacity: toastAnim,
            transform: [
              { translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) },
            ],
          }}
        >
          <Ionicons name="checkmark-circle" size={16} color={theme.colors.bg} />
          <Text variant="caption" style={{ color: theme.colors.bg, fontWeight: '800' }}>
            {toast}
          </Text>
        </Animated.View>
      ) : null}

      <BottomSheet
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={status === 'locked' ? `Plan v${version} is locked` : 'Move to another day'}
      >
        {status === 'locked' ? (
          <>
            <Text variant="body" color="dim">
              Unlock the plan to start an editable draft. Moves are recorded as draft changes you
              review before locking again.
            </Text>
            <View style={{ marginTop: 20 }}>
              <Button
                label="Unlock and edit"
                icon="lock-open"
                onPress={() => {
                  unlock();
                }}
              />
            </View>
          </>
        ) : (
          <View style={{ gap: 6 }}>
            {weekDates(weekStart).map((d) => {
              const there = workoutOn(workouts, d);
              const isCurrent = d === workout.date;
              const disabled = d < today;
              return (
                <PressableScale
                  key={d}
                  onPress={disabled || isCurrent ? undefined : () => move(d)}
                  accessibilityRole="button"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    padding: 12,
                    borderRadius: 16,
                    backgroundColor: isCurrent ? theme.accentSoft : theme.colors.surfaceRaised,
                    opacity: disabled ? 0.35 : 1,
                  }}
                >
                  <View style={{ width: 40, alignItems: 'center' }}>
                    <Text variant="label" style={{ fontSize: 10 }}>
                      {WEEKDAYS_LONG[weekdayIndex(d)].slice(0, 3)}
                    </Text>
                    <Text variant="subheading" numeric style={{ fontWeight: '800' }}>
                      {dayNumber(d)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="subheading">
                      {isCurrent ? 'Current day' : there ? there.title : 'Free day'}
                    </Text>
                    {!isCurrent && there ? (
                      <Text variant="caption">
                        Swaps with this {KIND_META[there.kind].label.toLowerCase()}
                      </Text>
                    ) : null}
                  </View>
                  {isCurrent ? (
                    <Ionicons name="checkmark" size={18} color={theme.accentText} />
                  ) : null}
                </PressableScale>
              );
            })}
          </View>
        )}
      </BottomSheet>
    </Screen>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View>
      <Text variant="label">{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 3 }}>
        <Text
          variant="heading"
          numeric
          style={{ fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -0.8 }}
        >
          {value}
        </Text>
        {unit ? (
          <Text variant="caption" numeric>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text variant="caption" style={{ fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}
