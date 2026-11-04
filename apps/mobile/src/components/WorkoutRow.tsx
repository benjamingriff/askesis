import { Ionicons } from '@expo/vector-icons';
import { createContext, useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import type { WorkoutChange } from '../data/chat';
import { useWorkoutDetail, type PlanVersion } from '../data/plan-data';
import type { WorkoutSummary } from '../lib/api-types';
import { dayNumber, WEEKDAYS_SHORT, weekdayIndex, type Units } from '../lib/format';
import { changeLabel, workoutMeta } from '../lib/presenters';
import { RACE_META, workoutLook } from '../lib/workouts';
import { effortTint, useSportUnits, useTheme } from '../state/settings';
import { IntensityChart } from './IntensityChart';
import { Badge, KindIcon, PressableScale, Text } from './ui';

/** Net draft differences for the schedule being shown; empty outside a draft. */
export const WorkoutChangesContext = createContext<WorkoutChange[]>([]);
export const useWorkoutChange = (id: string) =>
  useContext(WorkoutChangesContext).find((change) => change.workoutId === id);

export function ChangeBadge({ change }: { change: WorkoutChange }) {
  const theme = useTheme();
  return (
    <Badge
      label={changeLabel(change)}
      size="sm"
      caps
      color={theme.accentText}
      background={theme.accentSoft}
      border={theme.accentBorder}
    />
  );
}

export type DayStatus = 'planned' | 'unplanned' | 'outside';

/** One day in the plan: date gutter on the left, workout cards (or rest) on the right. */
export function DayRow({
  date,
  today,
  workouts,
  units,
  version,
  status = 'planned',
  onOpen,
  showDate = true,
  compact = false,
}: {
  date: string;
  today: string;
  workouts: WorkoutSummary[];
  units: Units;
  version?: Pick<PlanVersion, 'id' | 'editNumber'> | null;
  /** Empty planned days are rest; unplanned or out-of-plan days are not. */
  status?: DayStatus;
  onOpen: (workout: WorkoutSummary) => void;
  showDate?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const isToday = date === today;
  const past = date < today;
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
            {WEEKDAYS_SHORT[weekdayIndex(date)]}
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
                color: isToday ? theme.onAccent : past ? theme.colors.textMuted : theme.colors.text,
                fontWeight: '800',
              }}
            >
              {dayNumber(date)}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 8 }}>
        {workouts.length === 0 ? (
          <View
            style={{
              borderRadius: 20,
              padding: 14,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: isToday ? theme.accentBorder : theme.colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Ionicons
              name={status === 'planned' ? 'moon-outline' : 'calendar-clear-outline'}
              size={16}
              color={theme.colors.textMuted}
            />
            <Text variant="caption" color="muted" style={{ fontWeight: '600' }}>
              {status === 'outside'
                ? 'Outside plan dates'
                : status === 'unplanned'
                  ? 'Not planned yet'
                  : 'Rest day'}
            </Text>
          </View>
        ) : (
          workouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              workout={workout}
              units={units}
              version={version}
              highlight={isToday}
              past={past}
              onOpen={onOpen}
            />
          ))
        )}
      </View>
    </View>
  );
}

export function WorkoutCard({
  workout,
  units,
  version,
  highlight,
  past,
  onOpen,
}: {
  workout: WorkoutSummary;
  units: Units;
  version?: Pick<PlanVersion, 'id' | 'editNumber'> | null;
  highlight?: boolean;
  past?: boolean;
  onOpen: (workout: WorkoutSummary) => void;
}) {
  const theme = useTheme();
  const { pool } = useSportUnits();
  const look = workoutLook(workout);
  const color = effortTint(theme, look.effort);
  const change = useWorkoutChange(workout.id);
  const detail = useWorkoutDetail(workout.id, version);
  return (
    <PressableScale
      onPress={() => onOpen(workout)}
      accessibilityRole="button"
      accessibilityLabel={`${workout.title}, ${look.label}`}
      style={{
        borderRadius: 20,
        padding: 14,
        backgroundColor: theme.colors.surface,
        borderWidth: change ? 1 : StyleSheet.hairlineWidth,
        borderColor: change
          ? theme.accentBorder
          : highlight
            ? theme.accentBorder
            : theme.colors.border,
        opacity: past ? 0.78 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <KindIcon icon={look.icon} color={color} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="label" style={{ color }}>
              {look.label}
            </Text>
            {workout.racePriority ? (
              <Text variant="label" style={{ color: theme.accentText }}>
                {RACE_META[workout.racePriority].label}
              </Text>
            ) : workout.priority === 'high' ? (
              <Text variant="label" color="dim">
                Key session
              </Text>
            ) : null}
            {change ? <ChangeBadge change={change} /> : null}
          </View>
          <Text variant="subheading" numberOfLines={2} style={{ marginTop: 1 }}>
            {workout.title}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 12 }}>
        <Text variant="caption" numeric style={{ width: 124 }}>
          {workoutMeta(workout, units, pool)}
        </Text>
        <View style={{ flex: 1 }}>
          {detail.data ? (
            <IntensityChart
              prescription={detail.data.prescription}
              height={26}
              gap={1.5}
              dimmed={past}
            />
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}
