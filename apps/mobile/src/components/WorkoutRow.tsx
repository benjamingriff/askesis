import { Ionicons } from '@expo/vector-icons';
import { createContext, useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import type { WorkoutChange } from '../data/chat';
import { useCoachWord } from '../data/account';
import { useWorkoutDetail, type PlanVersion } from '../data/plan-data';
import { effortFlag } from '../data/training-log';
import type { WorkoutSummary } from '../lib/api-types';
import { dayNumber, WEEKDAYS_SHORT, weekdayIndex, type Units } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import { changeLabel, workoutMeta } from '../lib/presenters';
import { KIND_META, RACE_META, expectedEffort, workoutLook } from '../lib/workouts';
import { effortTint, useSportUnits, useTheme } from '../state/settings';
import { alpha } from '../theme/palette';
import { IntensityChart } from './IntensityChart';
import { LogChip, WorkoutLogActions, useLogContext } from './TrainingLog';
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
              borderColor: isToday
                ? theme.accentBorder
                : theme.isDark
                  ? theme.colors.border
                  : theme.colors.textMuted,
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
  onOpen,
}: {
  workout: WorkoutSummary;
  units: Units;
  version?: Pick<PlanVersion, 'id' | 'editNumber'> | null;
  highlight?: boolean;
  onOpen: (workout: WorkoutSummary) => void;
}) {
  const theme = useTheme();
  const coach = useCoachWord();
  const { pool } = useSportUnits();
  const look = workoutLook(workout);
  const color = effortTint(theme, look.effort);
  const change = useWorkoutChange(workout.id);
  const detail = useWorkoutDetail(workout.placeholder ? undefined : workout.id, version);
  const logContext = useLogContext();
  const today = useLocalToday();
  const log = logContext?.logs.find((l) => l.lineageId === workout.lineageId);
  const skipped = log?.status === 'skipped';
  const flag = log ? effortFlag(log) : null;
  const quickLog =
    !log &&
    !!logContext?.ready &&
    logContext.writable &&
    workout.planVersionId === logContext.lockedVersionId &&
    workout.scheduledDate <= today;
  // The quick log sits beside the card's pressable, not inside it: buttons don't nest.
  return (
    <View
      style={{
        borderRadius: 20,
        backgroundColor: theme.colors.surface,
        borderWidth: change || workout.placeholder ? 1 : StyleSheet.hairlineWidth,
        borderStyle: workout.placeholder ? 'dashed' : 'solid',
        borderColor: change
          ? theme.accentBorder
          : highlight
            ? theme.accentBorder
            : workout.placeholder
              ? alpha(color, 0.45)
              : theme.colors.border,
      }}
    >
      <PressableScale
        onPress={() => onOpen(workout)}
        accessibilityRole="button"
        accessibilityLabel={`${workout.title}, ${look.label}`}
        style={{ padding: 14 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ opacity: skipped ? 0.5 : 1 }}>
            <KindIcon icon={look.icon} color={skipped ? theme.colors.textMuted : color} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text variant="label" style={{ color }}>
                {look.label}
              </Text>
              {workout.racePriority ? (
                <>
                  <Text variant="label" color="muted">
                    ·
                  </Text>
                  <Text variant="label" style={{ color: theme.accentText }}>
                    {RACE_META[workout.racePriority].label}
                  </Text>
                </>
              ) : workout.priority === 'high' ? (
                <>
                  <Text variant="label" color="muted">
                    ·
                  </Text>
                  <Text variant="label" color="dim">
                    Key session
                  </Text>
                </>
              ) : null}
              {workout.placeholder ? (
                <Badge
                  label="Placeholder"
                  size="sm"
                  caps
                  color={theme.colors.textDim}
                  background="transparent"
                  border={theme.colors.textMuted}
                  style={{ borderStyle: 'dashed', borderWidth: 1 }}
                />
              ) : null}
              {change ? <ChangeBadge change={change} /> : null}
            </View>
            <Text
              variant="subheading"
              numberOfLines={2}
              style={[
                { marginTop: 1 },
                skipped && {
                  textDecorationLine: 'line-through',
                  textDecorationColor: alpha(theme.colors.text, 0.4),
                },
              ]}
            >
              {workout.title}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </View>
        {quickLog ? null : (
          <View
            style={{
              flexDirection: 'row',
              // A result chip centres on the duration; an effort profile sits on its baseline.
              alignItems: log ? 'center' : 'flex-end',
              gap: 14,
              marginTop: 12,
            }}
          >
            <Text variant="caption" numeric style={{ width: 124 }}>
              {log ? 'Planned ' : ''}
              {workoutMeta(workout, units, pool)}
            </Text>
            <View style={{ flex: 1 }}>
              {/* A logged session shows its result here, so every card keeps two rows. */}
              {log ? (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <LogChip log={log} />
                </View>
              ) : workout.placeholder ? (
                <PlaceholderBand workout={workout} compact />
              ) : detail.data ? (
                <IntensityChart prescription={detail.data.prescription} height={26} gap={1.5} />
              ) : null}
            </View>
          </View>
        )}
        {log && (log.actualSessionType || flag) ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
            }}
          >
            {log.actualSessionType ? (
              <Text variant="caption" color="muted">
                Was {KIND_META[log.actualSessionType].label.toLowerCase()}
              </Text>
            ) : null}
            {flag ? (
              <Text variant="caption" color="muted">
                {flag}
              </Text>
            ) : null}
          </View>
        ) : null}
        {workout.placeholder && !log && !quickLog ? (
          <Text variant="caption" color="muted" style={{ marginTop: 10, fontSize: 12 }}>
            {placeholderHint(coach)}
          </Text>
        ) : null}
      </PressableScale>
      {quickLog ? (
        // Beside the card's pressable, not inside it: buttons don't nest. The details take the
        // room the actions leave and wrap, in place of the effort profile.
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 14,
            paddingBottom: 14,
            marginTop: -2,
          }}
        >
          <Text variant="caption" numeric style={{ flex: 1 }}>
            {workoutMeta(workout, units, pool)}
          </Text>
          <WorkoutLogActions workout={workout} variant="compact" />
        </View>
      ) : null}
    </View>
  );
}

export const placeholderHint = (coach: string) =>
  `Booked, not prescribed: your ${coach} plans around it, and you log what it turned out to be.`;

/** Where a placeholder's expected effort sits on the 1–10 RPE scale. */
export function PlaceholderBand({
  workout,
  compact = false,
}: {
  workout: WorkoutSummary;
  compact?: boolean;
}) {
  const theme = useTheme();
  const range = workout.expectedRpe;
  if (!range) return null;
  const color = effortTint(theme, workoutLook(workout).effort);
  const left = ((range.minimum - 1) / 9) * 100;
  const width = Math.max(((range.maximum - range.minimum) / 9) * 100, 4);
  return (
    <View accessibilityLabel={`Expected effort ${expectedEffort(workout)}`} style={{ gap: 6 }}>
      <View
        style={{
          height: compact ? 8 : 12,
          borderRadius: 999,
          backgroundColor: alpha(theme.colors.textMuted, 0.22),
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${left}%`,
            width: `${width}%`,
            borderRadius: 999,
            backgroundColor: color,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: alpha('#FFFFFF', 0.5),
          }}
        />
      </View>
      {compact ? null : (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" style={{ fontSize: 11 }}>
            Easy
          </Text>
          <Text variant="caption" numeric style={{ fontSize: 11, color, fontWeight: '700' }}>
            {expectedEffort(workout)}
          </Text>
          <Text variant="caption" style={{ fontSize: 11 }}>
            Max
          </Text>
        </View>
      )}
    </View>
  );
}

/** What a placeholder is, and what the coach assumed when planning around it. */
export function PlaceholderSummary({ workout }: { workout: WorkoutSummary }) {
  const theme = useTheme();
  const coach = useCoachWord();
  const color = effortTint(theme, workoutLook(workout).effort);
  const assumed = workout.sessionType ? KIND_META[workout.sessionType].label.toLowerCase() : null;
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: alpha(color, 0.45),
      }}
    >
      <Text variant="label">Placeholder session</Text>
      <PlaceholderBand workout={workout} />
      <Text variant="body" color="dim">
        There’s no prescription for this one. Your {coach} has planned the rest of your training
        around it{assumed ? `, assuming ${assumed}` : ''}
        {workout.expectedRpe ? ` at ${expectedEffort(workout)}` : ''}. Do the session as it comes,
        then log what it turned out to be.
      </Text>
    </View>
  );
}
