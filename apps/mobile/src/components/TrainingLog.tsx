import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useCoachWord } from '../data/account';
import type { Plan } from '../data/plan-data';
import {
  LOG_LABELS,
  REASON_LABELS,
  effortFlag,
  fullFeedback,
  logInput,
  useClearLog,
  useSaveLog,
  useTrainingLog,
  type LogStatus,
  type TrainingLog,
  type WorkoutLog,
} from '../data/training-log';
import type { WorkoutSummary } from '../lib/api-types';
import { formatDistance, formatDuration, formatSwimDistance } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import { KIND_META, inferKind } from '../lib/workouts';
import { useSportUnits, useTheme, useUnits, type Theme } from '../state/settings';
import { alpha, type Effort } from '../theme/palette';
import { StravaLinkRow } from './Strava';
import {
  AccentFill,
  Button,
  ErrorState,
  PressableScale,
  Text,
  useHaptics,
  type IconName,
} from './ui';

// Ported from apps/web/src/components/TrainingLog.tsx. The web's feedback dialog, check-in dialog
// and history dialog are screens here: log-workout, check-in and training-log.

type LogContextValue = {
  logs: WorkoutLog[];
  ready: boolean;
  writable: boolean;
  lockedVersionId: string | undefined;
  /** Opens the feedback form for a workout, its saved log, or both. */
  edit: (workout: WorkoutSummary, log?: WorkoutLog, status?: LogStatus) => void;
};
const LogContext = createContext<LogContextValue | null>(null);
export const useLogContext = () => useContext(LogContext);

/** Opens the feedback form; logs from earlier plan versions open from their saved snapshot. */
export function openLogForm(
  workout: Pick<WorkoutSummary, 'id' | 'planId' | 'lineageId' | 'planVersionId'>,
  options: { status?: LogStatus; current?: boolean } = {},
) {
  router.push({
    pathname: '/log-workout',
    params: {
      planId: workout.planId,
      lineageId: workout.lineageId,
      ...(options.current === false ? {} : { workoutId: workout.id }),
      ...(options.status ? { status: options.status } : {}),
    },
  });
}

/** Puts a saved log into the plan's cached training log, ahead of the refetch. */
function rememberLog(client: QueryClient, planId: string, log: WorkoutLog) {
  client.setQueryData<TrainingLog>(['training-log', planId, undefined, undefined], (data) =>
    data
      ? {
          ...data,
          logs: data.logs.some((l) => l.lineageId === log.lineageId)
            ? data.logs.map((l) => (l.lineageId === log.lineageId ? log : l))
            : [...data.logs, log],
        }
      : data,
  );
}

export function TrainingLogProvider({
  plan,
  children,
  style,
}: {
  plan: Plan;
  children: ReactNode;
  /** Where the load error sits. */
  style?: StyleProp<ViewStyle>;
}) {
  const query = useTrainingLog(plan.id);
  const client = useQueryClient();
  const writable = !!plan.locked && !plan.archived;
  return (
    <LogContext.Provider
      value={{
        logs: query.data?.logs ?? [],
        ready: !!query.data,
        writable,
        lockedVersionId: plan.locked?.id,
        edit: (workout, log, status) => {
          if (plan.archived || (!log && workout.planVersionId !== plan.locked?.id)) return;
          // The form starts from the cached log, so a just-saved one goes in before it opens.
          if (log) rememberLog(client, plan.id, log);
          openLogForm(workout, { status });
        },
      }}
    >
      {children}
      {query.error ? (
        <ErrorState
          style={[{ marginHorizontal: 20, marginTop: 12 }, style]}
          message={`Couldn’t load your training log: ${query.error.message}`}
          onRetry={() => void query.refetch()}
        />
      ) : null}
    </LogContext.Provider>
  );
}

// ---- Status ------------------------------------------------------------------------------------

type Status = LogStatus | 'unlogged';

const STATUS_ICON: Record<Status, IconName> = {
  done: 'checkmark',
  changed: 'pencil',
  skipped: 'close',
  unlogged: 'ellipse-outline',
};

export function statusColor(theme: Theme, status: Status) {
  return status === 'done'
    ? theme.locked
    : status === 'changed'
      ? theme.warning
      : status === 'skipped'
        ? theme.danger
        : theme.colors.textMuted;
}

/** A log's status, with its effort when rated. */
export function LogChip({ log, unlogged = false }: { log?: WorkoutLog; unlogged?: boolean }) {
  const theme = useTheme();
  if (!log && !unlogged) return null;
  const status: Status = log?.status ?? 'unlogged';
  const color = statusColor(theme, status);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 5,
        paddingVertical: 4,
        paddingHorizontal: 9,
        borderRadius: 999,
        backgroundColor: log ? alpha(color, 0.14) : 'transparent',
        borderWidth: 1,
        borderStyle: log ? 'solid' : 'dashed',
        borderColor: alpha(color, 0.4),
      }}
    >
      <Ionicons name={STATUS_ICON[status]} size={12} color={color} />
      <Text variant="caption" style={{ color, fontWeight: '800', fontSize: 12, lineHeight: 15 }}>
        {log ? LOG_LABELS[log.status] : 'Not logged'}
      </Text>
      {log?.rpe != null ? (
        <Text variant="caption" numeric style={{ fontSize: 12, lineHeight: 15 }}>
          · RPE {log.rpe}
        </Text>
      ) : null}
    </View>
  );
}

/** A day's log in the week strip: the most telling status among its workouts. */
export function logStatusFor(logs: WorkoutLog[]): Status {
  return logs.some((l) => l.status === 'changed')
    ? 'changed'
    : logs.some((l) => l.status === 'skipped')
      ? 'skipped'
      : logs.length
        ? 'done'
        : 'unlogged';
}

export function LogMark({ status, onAccent }: { status: Status; onAccent?: boolean }) {
  const theme = useTheme();
  const color = onAccent ? theme.onAccent : statusColor(theme, status);
  return (
    <View
      accessibilityLabel={status === 'unlogged' ? 'Not logged' : LOG_LABELS[status]}
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          status === 'unlogged' ? 'transparent' : alpha(color, onAccent ? 0.2 : 0.16),
        borderWidth: status === 'unlogged' ? 1 : 0,
        borderStyle: 'dashed',
        borderColor: alpha(color, 0.7),
      }}
    >
      {status === 'unlogged' ? null : (
        <Ionicons name={STATUS_ICON[status]} size={10} color={color} />
      )}
    </View>
  );
}

// ---- Effort ------------------------------------------------------------------------------------

export const RPE_WORDS = [
  'Very easy',
  'Easy',
  'Easy · comfortable conversation',
  'Moderate',
  'Somewhat hard',
  'Hard',
  'Hard · short phrases',
  'Very hard',
  'Extremely hard',
  'Maximum',
];

export function rpeEffort(n: number): Effort {
  return n <= 2
    ? 'recovery'
    : n <= 4
      ? 'easy'
      : n <= 5
        ? 'steady'
        : n <= 7
          ? 'threshold'
          : n <= 9
            ? 'hard'
            : 'max';
}

/** Session effort, 1–10, coloured by effort; the planned value is outlined. */
export function RpeScale({
  value,
  planned,
  expected = false,
  disabled,
  onChange,
}: {
  value: number | null;
  planned: number | null;
  /** A placeholder's effort was expected, not planned. */
  expected?: boolean;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  const target = planned != null ? Math.round(planned) : null;
  return (
    <View style={{ gap: 8, opacity: disabled ? 0.5 : 1 }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Session effort"
        style={{ flexDirection: 'row', gap: 4 }}
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const color = theme.efforts[rpeEffort(n)];
          const active = value === n;
          const isTarget = target === n;
          return (
            <Pressable
              key={n}
              disabled={disabled}
              onPress={() => {
                buzz('select');
                onChange(n);
              }}
              accessibilityRole="radio"
              accessibilityLabel={`Effort ${n}: ${RPE_WORDS[n - 1]}`}
              accessibilityState={{ selected: active, disabled }}
              style={{
                flex: 1,
                height: 40,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active
                  ? color
                  : value != null && n < value
                    ? alpha(color, 0.28)
                    : theme.colors.surfaceRaised,
                borderWidth: isTarget ? 1.5 : 0,
                borderStyle: expected ? 'dashed' : 'solid',
                borderColor: isTarget ? color : 'transparent',
              }}
            >
              <Text
                variant="caption"
                numeric
                style={{
                  fontWeight: '800',
                  color: active ? '#0A0A0B' : theme.colors.text,
                }}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {['Easy', 'Moderate', 'Hard', 'Max'].map((word) => (
          <Text key={word} variant="label" style={{ fontSize: 9.5 }}>
            {word}
          </Text>
        ))}
      </View>
      {value ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text variant="subheading" numeric style={{ fontWeight: '800' }}>
            {value}/10
          </Text>
          <Text variant="caption">{RPE_WORDS[value - 1]}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---- Quick log ---------------------------------------------------------------------------------

function StatusButton({
  status,
  onPress,
  disabled,
  compact,
  iconOnly,
}: {
  status: LogStatus;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
  /** A round icon button, for rows with little room. */
  iconOnly?: boolean;
}) {
  const theme = useTheme();
  const done = status === 'done';
  if (iconOnly)
    return (
      <PressableScale
        onPress={disabled ? undefined : onPress}
        haptic={null}
        accessibilityRole="button"
        accessibilityLabel={LOG_LABELS[status]}
        accessibilityState={{ disabled: !!disabled }}
        hitSlop={4}
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: done ? theme.accent : theme.colors.surfaceRaised,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {done ? <AccentFill /> : null}
        <Ionicons
          name={STATUS_ICON[status]}
          size={18}
          color={done ? theme.onAccent : statusColor(theme, status)}
        />
      </PressableScale>
    );
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      haptic={null}
      accessibilityRole="button"
      accessibilityLabel={LOG_LABELS[status]}
      accessibilityState={{ disabled: !!disabled }}
      style={{
        flex: compact ? undefined : 1,
        height: compact ? 34 : 44,
        paddingHorizontal: compact ? 14 : 4,
        borderRadius: compact ? 11 : 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        overflow: 'hidden',
        backgroundColor: done ? theme.accent : theme.colors.surfaceRaised,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {done ? <AccentFill /> : null}
      <Ionicons
        name={STATUS_ICON[status]}
        size={compact ? 14 : 15}
        color={done ? theme.onAccent : statusColor(theme, status)}
      />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ fontWeight: '800', color: done ? theme.onAccent : theme.colors.text }}
      >
        {LOG_LABELS[status]}
      </Text>
    </PressableScale>
  );
}

/**
 * Record a due workout in one tap, then correct or rate it. `hero` sits inside Today's workout
 * card, `compact` under a schedule row, `inline` (icons only) beside a one-line summary, and
 * `detail` on the workout screen with the full log.
 */
export function WorkoutLogActions({
  workout,
  variant = 'hero',
}: {
  workout: WorkoutSummary;
  variant?: 'hero' | 'compact' | 'inline' | 'detail';
}) {
  const theme = useTheme();
  const coach = useCoachWord();
  const buzz = useHaptics();
  const context = useLogContext();
  const today = useLocalToday();
  const units = useUnits();
  const { pool } = useSportUnits();
  const log = context?.logs.find((l) => l.lineageId === workout.lineageId);
  const save = useSaveLog(workout.planId, workout.lineageId);
  const clear = useClearLog(workout.planId, workout.lineageId);
  const busy = save.isPending || clear.isPending;
  const compact = variant === 'compact' || variant === 'inline';
  if (!context || !context.ready || (!log && workout.scheduledDate > today)) return null;
  if (!log && workout.planVersionId !== context.lockedVersionId)
    return context.writable && !compact ? (
      <Text variant="caption" color="muted" style={variant === 'hero' ? { padding: 18 } : null}>
        Log the published workout from Today after its scheduled date.
      </Text>
    ) : null;

  const choose = (status: LogStatus) => {
    const full = fullFeedback(
      { ...workout, sessionType: workout.sessionType ?? inferKind(workout) },
      status,
    );
    save.mutate(
      { status },
      {
        onSuccess: (saved) => {
          buzz('success');
          if (full) context.edit(workout, saved, status);
        },
      },
    );
  };
  const rate = (rpe: number) => {
    if (!log) return;
    const next = log.rpe === rpe ? null : rpe;
    const full = next !== null && fullFeedback(workout, log.status, next, log.plannedRpe);
    save.mutate(logInput(log, { rpe: next }), {
      onSuccess: (saved) => {
        if (full) context.edit(workout, saved);
      },
    });
  };
  const error = save.error?.message ?? clear.error?.message;

  if (compact)
    return context.writable ? (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['done', 'skipped'] as const).map((status) => (
            <StatusButton
              key={status}
              status={status}
              compact
              iconOnly={variant === 'inline'}
              disabled={busy}
              onPress={() => choose(status)}
            />
          ))}
        </View>
        {error ? <ErrorState message={error} /> : null}
      </View>
    ) : null;

  const distance = (metres: number | null) =>
    metres == null
      ? '—'
      : workout.discipline === 'swim'
        ? formatSwimDistance(metres, pool)
        : formatDistance(metres, units);
  return (
    <View
      accessibilityLabel={`Log ${workout.title}`}
      style={{ gap: 14, padding: variant === 'hero' ? 18 : 0 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          {log ? (
            <>
              <LogChip log={log} />
              {log.actualSessionType ? (
                <Text variant="caption" color="muted">
                  Was {KIND_META[log.actualSessionType].label.toLowerCase()}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text variant="subheading" style={{ fontWeight: '800' }}>
                How did it go?
              </Text>
              <Text variant="caption">
                {workout.placeholder
                  ? `Tell your ${coach} what the session turned out to be.`
                  : 'A quick log is enough. Add detail if it’s useful.'}
              </Text>
            </>
          )}
        </View>
        {log && context.writable ? (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Button
              size="sm"
              variant="ghost"
              icon="pencil"
              label="Edit"
              disabled={busy}
              onPress={() => context.edit(workout, log)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon="arrow-undo"
              label="Undo"
              disabled={busy}
              onPress={() => clear.mutate()}
            />
          </View>
        ) : null}
      </View>
      {!log && context.writable ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['done', 'changed', 'skipped'] as const).map((status) => (
            <StatusButton
              key={status}
              status={status}
              disabled={busy}
              onPress={() => choose(status)}
            />
          ))}
        </View>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      <StravaLinkRow workout={workout} writable={context.writable} />
      {log && log.status !== 'skipped' ? (
        <View style={{ gap: 10 }}>
          <View>
            <Text variant="caption" color="text" style={{ fontWeight: '700' }}>
              How hard was it overall?
            </Text>
            <Text variant="caption" color="muted">
              Optional · {log.placeholder ? 'expected' : 'planned'}{' '}
              {log.plannedRpe == null ? 'effort not set' : `~${log.plannedRpe}/10`}
            </Text>
          </View>
          <RpeScale
            value={log.rpe}
            planned={log.plannedRpe}
            expected={log.placeholder}
            disabled={!context.writable || busy}
            onChange={rate}
          />
          {effortFlag(log) ? (
            <Text variant="caption" style={{ color: theme.warning, fontWeight: '700' }}>
              {effortFlag(log)}
            </Text>
          ) : null}
          {context.writable && variant === 'hero' ? (
            <Pressable
              onPress={() => context.edit(workout, log)}
              accessibilityRole="button"
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                alignSelf: 'flex-start',
              }}
            >
              <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
                Add details
              </Text>
              <Ionicons name="chevron-forward" size={14} color={theme.accentText} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {variant === 'detail' && log ? (
        <View style={{ gap: 10 }}>
          <View
            style={{
              flexDirection: 'row',
              borderRadius: 16,
              backgroundColor: theme.colors.surfaceRaised,
              padding: 14,
              gap: 14,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="label">Time · planned / actual</Text>
              <Text variant="subheading" numeric style={{ marginTop: 4, fontWeight: '800' }}>
                {formatDuration(log.plannedDurationSeconds ?? 0)} /{' '}
                {log.actualDurationSeconds == null
                  ? '—'
                  : formatDuration(log.actualDurationSeconds)}
              </Text>
            </View>
            {log.plannedDistanceMetres == null && log.actualDistanceMetres == null ? null : (
              <View style={{ flex: 1 }}>
                <Text variant="label">Distance · planned / actual</Text>
                <Text variant="subheading" numeric style={{ marginTop: 4, fontWeight: '800' }}>
                  {distance(log.plannedDistanceMetres)} / {distance(log.actualDistanceMetres)}
                </Text>
              </View>
            )}
          </View>
          {log.actualSessionType ? (
            <Text variant="caption">
              Turned out to be {KIND_META[log.actualSessionType].label.toLowerCase()}
            </Text>
          ) : null}
          {log.reasons.length ? (
            <Text variant="caption">{log.reasons.map((r) => REASON_LABELS[r]).join(' · ')}</Text>
          ) : null}
          {log.note ? (
            <View
              style={{
                borderLeftWidth: 3,
                borderLeftColor: theme.accentBorder,
                paddingLeft: 12,
                paddingVertical: 2,
              }}
            >
              <Text variant="body" color="dim">
                {log.note}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---- Entry points ------------------------------------------------------------------------------

/** Today's "Not feeling 100%?" link: a short check-in, then a conversation about the next days. */
export function CheckInButton({ plan }: { plan: Plan }) {
  const theme = useTheme();
  if (plan.archived) return null;
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/check-in', params: { planId: plan.id } })}
      accessibilityRole="button"
      accessibilityLabel="Not feeling 100%?"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: alpha(theme.danger, 0.14),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="pulse" size={18} color={theme.danger} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="subheading">Not feeling 100%?</Text>
        <Text variant="caption">
          Ill, run down or short on time? Talk through the next few days.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </PressableScale>
  );
}

export const openTrainingLog = (planId: string) =>
  router.push({ pathname: '/training-log', params: { planId } });
