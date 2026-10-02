import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { dayNumber } from '../data/dates';
import type { Workout } from '../data/types';
import { KIND_META } from '../lib/kinds';
import { formatDistance, formatDuration, workoutTotals } from '../lib/metrics';
import { dayLabel } from '../lib/plan-selectors';
import { useSettings, useTheme } from '../state/settings';
import { IntensityChart } from './IntensityChart';
import { KindIcon, PressableScale, Text } from './ui';

export function workoutMeta(workout: Workout, units: 'km' | 'mi'): string {
  if (workout.kind === 'rest') return 'Recovery';
  const t = workoutTotals(workout);
  if (workout.kind === 'strength') return formatDuration(t.seconds);
  return `${formatDistance(t.meters, units)} · ${formatDuration(t.seconds)}`;
}

export function ChangeBadge({ change }: { change: NonNullable<Workout['change']> }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 7,
        height: 20,
        borderRadius: 10,
        justifyContent: 'center',
        backgroundColor: theme.accentSoft,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.accentBorder,
      }}
    >
      <Text variant="label" color="accent" style={{ fontSize: 9.5 }}>
        {change === 'new' ? 'New' : 'Edited'}
      </Text>
    </View>
  );
}

/** One day in the plan: date gutter on the left, workout card on the right. */
export function WorkoutRow({
  workout,
  date,
  today,
  onPress,
  showDate = true,
  compact = false,
}: {
  workout?: Workout;
  date: string;
  today: string;
  onPress?: () => void;
  showDate?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const { settings } = useSettings();
  const isToday = date === today;
  const isPastDay = date < today;
  const meta = workout ? KIND_META[workout.kind] : null;
  const isRest = !workout || workout.kind === 'rest';

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: compact ? 0 : 20,
        marginBottom: 10,
      }}
    >
      {showDate ? (
        <View style={{ width: 40, alignItems: 'center', paddingTop: 12 }}>
          <Text variant="label" color={isToday ? 'accent' : 'muted'}>
            {dayLabel(date)}
          </Text>
          <View
            style={{
              marginTop: 4,
              minWidth: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isToday ? theme.accent : 'transparent',
            }}
          >
            <Text
              variant="subheading"
              numeric
              style={{
                color: isToday
                  ? theme.onAccent
                  : isPastDay
                    ? theme.colors.textMuted
                    : theme.colors.text,
                fontWeight: '800',
              }}
            >
              {dayNumber(date)}
            </Text>
          </View>
        </View>
      ) : null}

      <PressableScale
        onPress={onPress}
        disabled={!workout || !onPress}
        accessibilityRole="button"
        accessibilityLabel={workout ? `${workout.title}, ${meta?.label}` : 'Empty day'}
        style={{
          flex: 1,
          borderRadius: 20,
          padding: 14,
          backgroundColor: isRest ? 'transparent' : theme.colors.surface,
          borderWidth: isRest ? 1 : StyleSheet.hairlineWidth,
          borderStyle: isRest ? 'dashed' : 'solid',
          borderColor: isToday ? theme.accentBorder : theme.colors.border,
          opacity: isPastDay && !isRest ? 0.78 : 1,
        }}
      >
        {isRest ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="moon-outline" size={16} color={theme.colors.textMuted} />
            <Text variant="caption" color="muted" style={{ fontWeight: '600' }}>
              Rest day
            </Text>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <KindIcon icon={meta!.icon} color={meta!.color} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="label" style={{ color: meta!.color }}>
                    {meta!.label}
                  </Text>
                  {workout!.change ? <ChangeBadge change={workout!.change} /> : null}
                </View>
                <Text variant="subheading" numberOfLines={1} style={{ marginTop: 1 }}>
                  {workout!.title}
                </Text>
              </View>
              {isPastDay ? (
                <Ionicons name="checkmark-circle" size={22} color={KIND_META.easy.color} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 12 }}>
              <Text variant="caption" numeric style={{ width: 124 }}>
                {workoutMeta(workout!, settings.units)}
              </Text>
              <View style={{ flex: 1 }}>
                <IntensityChart steps={workout!.steps} height={26} gap={1.5} dimmed={isPastDay} />
              </View>
            </View>
          </>
        )}
      </PressableScale>
    </View>
  );
}
