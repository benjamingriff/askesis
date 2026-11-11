import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Chips,
  DateField,
  Field,
  FormScreen,
  FormSection,
  useLeaveGuard,
  leaveScreen,
} from '../components/forms';
import { PerformanceResult } from '../components/PerformanceResult';
import { StravaActivityPanel, StravaConnectHint, StravaLinkRow } from '../components/Strava';
import { RpeScale, statusColor } from '../components/TrainingLog';
import {
  Button,
  ErrorState,
  IconButton,
  KindIcon,
  LoadingState,
  Notice,
  PressableScale,
  Screen,
  Text,
  type IconName,
} from '../components/ui';
import { useAskIcon, useCoachWord, useInAppCoach } from '../data/account';
import { useActivityLink } from '../data/activities';
import { planVersion, useBriefState, usePlan, useWorkoutDetail } from '../data/plan-data';
import {
  LOG_LABELS,
  REASON_LABELS,
  loggedWorkout,
  openConversation,
  useClearLog,
  useDiscussFeedback,
  useSaveLog,
  useTrainingLog,
  type LogInput,
  type LogStatus,
  type WorkoutLog,
} from '../data/training-log';
import type { WorkoutSummary } from '../lib/api-types';
import { METRES_PER_MILE, METRES_PER_YARD, formatLong, type Units } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import {
  KIND_META,
  expectedEffort,
  inferKind,
  workoutLook,
  type WorkoutKind,
} from '../lib/workouts';
import { effortTint, useSportUnits, useTheme, useUnits } from '../state/settings';
import { alpha } from '../theme/palette';

// The web app's feedback sheet (FeedbackSheet in apps/web/src/components/TrainingLog.tsx).

type ActualType = NonNullable<LogInput['actualSessionType']>;
type Answers = NonNullable<LogInput['answers']>;
type Reason = NonNullable<LogInput['reasons']>[number];

/** What a placeholder can turn out to be, in the order athletes usually think of them. */
const ACTUAL_TYPES = [
  'recovery',
  'easy',
  'steady',
  'long',
  'tempo',
  'intervals',
  'speed',
  'race',
  'test',
  'strength',
  'mobility',
  'brick',
] as const satisfies readonly (ActualType & WorkoutKind)[];

const FEEL: { label: string; icon: IconName }[] = [
  { label: 'Strong', icon: 'flash-outline' },
  { label: 'Good', icon: 'happy-outline' },
  { label: 'Normal', icon: 'remove-circle-outline' },
  { label: 'Tired', icon: 'sad-outline' },
  { label: 'Drained', icon: 'battery-dead-outline' },
];

// Filled when chosen, outlined otherwise, so an unchosen answer never looks ticked. The pencil
// matches "Changed it" everywhere else in the app.
const STATUS_ICON: Record<LogStatus, [IconName, IconName]> = {
  done: ['checkmark-circle', 'checkmark-circle-outline'],
  changed: ['pencil', 'pencil-outline'],
  skipped: ['close-circle', 'close-circle-outline'],
};

const PAIN_AREAS = [
  ['foot', 'Foot'],
  ['ankle', 'Ankle'],
  ['calf', 'Calf'],
  ['knee', 'Knee'],
  ['hip', 'Hip'],
  ['back', 'Back'],
  ['shoulder', 'Shoulder'],
  ['other', 'Other'],
] as const;
const PAIN_SEVERITY = [
  ['mild', 'Mild · moved normally'],
  ['changed_movement', 'Changed how I moved'],
  ['stopped', 'Had to stop'],
] as const;

export default function LogWorkoutScreen() {
  const params = useLocalSearchParams<{
    planId: string;
    lineageId: string;
    workoutId?: string;
    status?: LogStatus;
  }>();
  const plan = usePlan(params.planId ?? null);
  const logs = useTrainingLog(params.planId);
  const detail = useWorkoutDetail(params.workoutId);
  const log = logs.data?.logs.find((l) => l.lineageId === params.lineageId);
  const current = detail.data?.workout;
  const workout = log ? loggedWorkout(log, current) : current;
  const loading =
    plan.isPending || logs.isPending || (!!params.workoutId && detail.isPending && !log);
  const error = plan.error ?? logs.error ?? (!log ? detail.error : null);
  // Distance is shown in the plan's units, so those are resolved before the form starts.
  const version = plan.data ? planVersion(plan.data, 'locked') : null;
  const brief = useBriefState(params.planId ?? '', version);
  const units = useUnits(brief.data?.brief.unit);
  const unitsReady = !!plan.data && (!version || !!brief.data || !!brief.error);

  // The form starts from the saved log, so it waits for the training log as well as the workout.
  if (!workout || !plan.data || !logs.data || !unitsReady)
    return (
      <Screen>
        <View style={{ padding: 20, gap: 20 }}>
          <IconButton
            icon="close"
            tone="filled"
            accessibilityLabel="Close"
            onPress={() => leaveScreen()}
          />
          {error ? (
            <ErrorState
              message={error.message}
              onRetry={() => {
                void plan.refetch();
                void logs.refetch();
                void detail.refetch();
              }}
            />
          ) : loading ? (
            <LoadingState label="Loading workout…" />
          ) : (
            <ErrorState message="This workout is no longer in your plan." />
          )}
        </View>
      </Screen>
    );
  return (
    <FeedbackForm
      key={`${workout.lineageId}/${params.status ?? 'edit'}`}
      workout={workout}
      log={log}
      initialStatus={params.status}
      planName={plan.data.displayName}
      writable={!!plan.data.locked && !plan.data.archived}
      units={units}
    />
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text variant="subheading" style={{ fontWeight: '700' }}>
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" color="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Opens a folded set of optional questions: one quiet style for every fold in the form. */
function Disclosure({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Add ${label.toLowerCase()}`}
      accessibilityState={{ expanded: false }}
      hitSlop={6}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="caption" color="text" style={{ fontWeight: '800' }}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Ionicons name="add" size={18} color={theme.accentText} />
    </Pressable>
  );
}

/** One optional answer: tap again to clear it. */
function Options<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T | undefined;
  values: readonly (readonly [T, string])[];
  onChange: (value: T | undefined) => void;
}) {
  return (
    <Chips
      label={label}
      options={values}
      selected={(v) => v === value}
      onPress={(v) => onChange(v === value ? undefined : v)}
    />
  );
}

function FeedbackForm({
  workout,
  log,
  initialStatus,
  planName,
  writable,
  units,
}: {
  workout: WorkoutSummary;
  log: WorkoutLog | undefined;
  initialStatus: LogStatus | undefined;
  planName: string;
  writable: boolean;
  units: Units;
}) {
  const theme = useTheme();
  const coach = useCoachWord();
  const inAppCoach = useInAppCoach();
  const askIcon = useAskIcon();
  const today = useLocalToday();
  const { pool } = useSportUnits();
  const swim = workout.discipline === 'swim';
  // Distance is entered in the units the athlete thinks in: km or mi, or the pool's m or yd.
  const distanceUnit = swim ? pool : units;
  const metresPer =
    distanceUnit === 'km'
      ? 1000
      : distanceUnit === 'mi'
        ? METRES_PER_MILE
        : distanceUnit === 'yd'
          ? METRES_PER_YARD
          : 1;
  const [status, setStatus] = useState<LogStatus>(initialStatus ?? log?.status ?? 'done');
  const [performed, setPerformed] = useState(log?.performedOn ?? workout.scheduledDate);
  // The amounts the form starts from. Their rounded text is only for display: saving untouched
  // fields keeps these exact values.
  const [start] = useState(() => {
    const seconds = log
      ? log.actualDurationSeconds
      : status === 'done'
        ? workout.estimatedDurationSeconds
        : null;
    const metres = log
      ? log.actualDistanceMetres
      : status === 'done'
        ? workout.estimatedDistanceMetres
        : null;
    const value = metres == null ? null : metres / metresPer;
    return {
      seconds,
      metres,
      minutes: seconds == null ? '' : String(Math.round((seconds / 60) * 10) / 10),
      distance:
        value == null
          ? ''
          : String(
              metresPer === 1 || distanceUnit === 'yd'
                ? Math.round(value)
                : Math.round(value * 100) / 100,
            ),
    };
  });
  const [minutes, setMinutes] = useState(start.minutes);
  const [distance, setDistance] = useState(start.distance);
  // Gym sessions have no distance, unless one was already recorded.
  const [showDistance] = useState(workout.discipline !== 'strength' || distance !== '');
  const [rpe, setRpe] = useState<number | null>(log?.rpe ?? null);
  const [feel, setFeel] = useState<number | null>(log?.feel ?? null);
  const [reasons, setReasons] = useState<Reason[]>(log?.reasons ?? []);
  const [note, setNote] = useState(log?.note ?? '');
  const [answers, setAnswers] = useState<Answers>(log?.answers ?? {});
  // The optional questions fold away until asked for, unless a saved log already answers them.
  const [factorsOpen, setFactorsOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(
    () => log?.feel != null || Object.keys(log?.answers ?? {}).length > 0,
  );
  const placeholder = !!(log?.placeholder ?? workout.placeholder);
  const [actualType, setActualType] = useState<ActualType | undefined>(
    log?.actualSessionType ?? undefined,
  );
  const save = useSaveLog(workout.planId, workout.lineageId);
  const discuss = useDiscussFeedback({ id: workout.planId, name: workout.planTitle || planName });
  const clear = useClearLog(workout.planId, workout.lineageId);
  const [resultBusy, setResultBusy] = useState(false);
  const busy = save.isPending || discuss.isPending || clear.isPending || resultBusy;
  const [touched, setTouched] = useState(false);
  const guard = useLeaveGuard(touched, { busy, what: 'feedback' });
  // The linked Strava activity opens above the form; linking one from here opens it.
  const activity = useActivityLink(workout.planId, workout.lineageId);
  const [panelChoice, setPanelChoice] = useState<boolean | null>(null);
  const linkedId = useRef(activity?.activityId);
  useEffect(() => {
    if (activity?.activityId && activity.activityId !== linkedId.current) setPanelChoice(true);
    linkedId.current = activity?.activityId;
  }, [activity?.activityId]);
  const panelOpen = !!activity && (panelChoice ?? false);
  // Follow-up questions match what a placeholder turned out to be, once the athlete says.
  const kind =
    (status !== 'skipped' ? actualType : undefined) ??
    log?.sessionType ??
    workout.sessionType ??
    inferKind(workout);
  const look = workoutLook(workout);
  const color = effortTint(theme, look.effort);
  const planned = log ? log.plannedRpe : workout.plannedRpe;
  const [saved, setSaved] = useState<WorkoutLog | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const changed = () => {
    setSaved(null);
    setTouched(true);
  };
  const setAnswer = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers((a) => {
      const next = { ...a };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    changed();
  };
  const number = (text: string) => Number(text.trim().replace(',', '.'));
  const payload = (): LogInput => {
    const secs =
      minutes === start.minutes
        ? start.seconds
        : minutes.trim()
          ? Math.round(number(minutes) * 60)
          : null;
    const metres =
      distance === start.distance
        ? start.metres
        : distance.trim()
          ? Math.round(number(distance) * metresPer * 10) / 10
          : null;
    if (
      status !== 'skipped' &&
      ((secs !== null && (!Number.isFinite(secs) || secs <= 0 || secs > 604800)) ||
        (metres !== null && (!Number.isFinite(metres) || metres <= 0 || metres > 1000000)))
    )
      throw new Error('Enter a positive time or distance, or leave it blank.');
    const cleaned = { ...answers };
    if (!reasons.includes('pain')) {
      delete cleaned.painArea;
      delete cleaned.painSeverity;
    }
    if (status === 'skipped') delete cleaned.result;
    // Drop follow-ups that no longer apply after the athlete says what the session was.
    if (!['intervals', 'tempo', 'speed'].includes(kind)) delete cleaned.intervals;
    if (kind !== 'long') {
      delete cleaned.finish;
      delete cleaned.fuelled;
    }
    if (kind !== 'strength') {
      delete cleaned.weights;
      delete cleaned.weightsUsed;
    }
    if (kind !== 'brick') delete cleaned.hardestPart;
    if (kind !== 'race') delete cleaned.race;
    if (!['test', 'race'].includes(kind)) delete cleaned.result;
    return {
      ...(placeholder
        ? { actualSessionType: status === 'skipped' ? null : (actualType ?? null) }
        : {}),
      status,
      performedOn: performed,
      actualDurationSeconds: status === 'skipped' ? null : secs,
      actualDistanceMetres: status === 'skipped' ? null : metres,
      rpe: status === 'skipped' ? null : rpe,
      feel,
      reasons,
      answers: cleaned,
      note: note || null,
    };
  };
  const persist = async (talk: boolean) => {
    if (busy) return;
    setLocalError(null);
    try {
      const current = saved ?? (await save.mutateAsync(payload()));
      setSaved(current);
      const request = {
        content: `I’d like to talk through my ${LOG_LABELS[current.status].toLowerCase()} workout: ${current.title}, ${current.performedOn}.${current.rpe != null ? ` Effort ${current.rpe}/10.` : ''}${current.note ? ` ${current.note}` : ''}`,
        reference: { type: 'workout_log' as const, logId: current.id },
      };
      // The athlete's own agent gets a prompt to paste, shown once this form has closed.
      if (talk && !inAppCoach)
        return guard.exit(() => {
          leaveScreen();
          discuss.mutate(request);
        });
      const conversation = talk ? await discuss.mutateAsync(request) : null;
      guard.exit(() => {
        leaveScreen();
        if (conversation) openConversation(conversation);
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Couldn’t save feedback.');
    }
  };
  const aboutSession =
    status !== 'skipped' &&
    ['intervals', 'tempo', 'speed', 'long', 'strength', 'brick', 'race', 'test'].includes(kind);
  const showReasons =
    status !== 'done' ||
    (rpe != null && planned != null && (rpe - planned >= 2 || planned - rpe >= 3)) ||
    reasons.length > 0;
  // Body feel shows for a changed or off-effort session; its factors and the session questions
  // still fold away until asked for, unless already answered.
  const detailShown = moreOpen || showReasons;
  const sessionShown = aboutSession && (moreOpen || sessionOpen);
  const factorsShown = detailShown && (factorsOpen || reasons.length > 0);
  const safety =
    reasons.includes('pain') && answers.painSeverity && answers.painSeverity !== 'mild';
  const active = status !== 'skipped';
  const notesLabel = placeholder
    ? 'What did you do?'
    : status === 'changed'
      ? 'What changed?'
      : 'Notes';
  const notesSection = (
    <FormSection>
      <Question title={notesLabel} hint="Optional · a sentence is plenty">
        <Field
          label={notesLabel}
          hideLabel
          value={note}
          multiline
          rows={3}
          maxLength={2000}
          onChangeText={(value) => {
            setNote(value);
            changed();
          }}
          placeholder={
            placeholder
              ? `The session, such as 6 × 800 m off 90 s, and anything else for your ${coach}…`
              : status === 'changed'
                ? 'How it differed from the plan, and why'
                : 'How it went, what helped, anything worth remembering…'
          }
        />
      </Question>
    </FormSection>
  );

  return (
    <FormScreen
      title={log ? 'Edit log' : 'Log workout'}
      subtitle={formatLong(workout.scheduledDate)}
      guard={guard}
      footer={
        <Button
          label="Save"
          icon="checkmark"
          busy={save.isPending && !discuss.isPending}
          disabled={busy}
          onPress={() => void persist(false)}
        />
      }
    >
      {/* The workout */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <KindIcon icon={look.icon} color={color} size={48} />
        <View style={{ flex: 1 }}>
          <Text variant="label" style={{ color }}>
            {look.label}
            {workout.priority === 'high' ? ' · Key session' : ''}
            {placeholder ? ' · Placeholder' : ''}
          </Text>
          <Text variant="heading" numberOfLines={2} style={{ marginTop: 2 }}>
            {workout.title}
          </Text>
        </View>
      </View>

      {localError ? (
        <ErrorState message={`${saved ? 'Your log is saved. ' : ''}${localError}`} />
      ) : null}

      <StravaLinkRow
        workout={workout}
        writable={writable}
        details={{ open: panelOpen, toggle: () => setPanelChoice(!panelOpen) }}
      />
      {activity && panelOpen ? (
        <StravaActivityPanel
          activityId={activity.activityId}
          url={activity.url}
          onClose={() => setPanelChoice(false)}
        />
      ) : null}
      <StravaConnectHint />

      <FormSection>
        <Question title="Did you do it?" hint="Pick one">
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {(['done', 'changed', 'skipped'] as const).map((s) => {
              const on = status === s;
              const tint = statusColor(theme, s);
              return (
                <PressableScale
                  key={s}
                  haptic="select"
                  onPress={() => {
                    setStatus(s);
                    changed();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={LOG_LABELS[s]}
                  accessibilityState={{ selected: on }}
                  style={{
                    // "Changed it" is the longest label, so it gets a wider share of the row.
                    flex: s === 'changed' ? 1.3 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    // Grows rather than clips when a larger text size wraps a label.
                    minHeight: 44,
                    paddingHorizontal: 6,
                    paddingVertical: 4,
                    borderRadius: 14,
                    backgroundColor: on
                      ? alpha(tint, theme.isDark ? 0.16 : 0.26)
                      : theme.colors.surfaceRaised,
                    borderWidth: 1.5,
                    borderColor: on ? tint : 'transparent',
                  }}
                >
                  <Ionicons
                    name={STATUS_ICON[s][on ? 0 : 1]}
                    size={16}
                    color={on ? tint : theme.colors.textMuted}
                  />
                  <Text
                    variant="caption"
                    style={{
                      flexShrink: 1,
                      textAlign: 'center',
                      fontWeight: '800',
                      color: on ? tint : theme.colors.text,
                    }}
                  >
                    {LOG_LABELS[s]}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </Question>
        {placeholder && active ? (
          <Question
            title="What was it?"
            hint={
              workout.sessionType
                ? `Your ${coach} assumed ${KIND_META[workout.sessionType].label.toLowerCase()}`
                : undefined
            }
          >
            <Options
              label="What the session was"
              value={actualType}
              values={ACTUAL_TYPES.map((type) => [type, KIND_META[type].label] as const)}
              onChange={(v) => {
                setActualType(v);
                changed();
              }}
            />
          </Question>
        ) : null}
      </FormSection>

      <FormSection>
        <Question
          title={active ? 'What you did' : 'When'}
          hint={
            active
              ? start.minutes || start.distance
                ? `${placeholder ? 'Expected' : 'Planned'} amounts, as estimates. Correct or clear them.`
                : 'Optional · leave blank if unsure'
              : undefined
          }
        >
          <DateField
            label={active ? 'Performed on' : 'Date'}
            value={performed}
            max={today}
            onChange={(value) => {
              setPerformed(value);
              setAnswer('result', undefined);
            }}
          />
          {active ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Field
                style={{ flex: 1 }}
                label="Time"
                value={minutes}
                onChangeText={(value) => {
                  setMinutes(value);
                  changed();
                }}
                keyboardType="decimal-pad"
                placeholder="e.g. 45"
                suffix="min"
              />
              {showDistance ? (
                <Field
                  style={{ flex: 1 }}
                  label="Distance"
                  value={distance}
                  onChangeText={(value) => {
                    setDistance(value);
                    changed();
                  }}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 30"
                  suffix={distanceUnit}
                />
              ) : null}
            </View>
          ) : null}
        </Question>
      </FormSection>

      {active ? (
        <FormSection>
          <Question
            title="How hard was it overall?"
            hint={`Optional · ${
              placeholder && workout.expectedRpe
                ? `expected ${expectedEffort(workout)}`
                : `whole session planned ${planned == null ? 'effort not set' : `~${Math.round(planned)}/10`}`
            }`}
          >
            <RpeScale
              value={rpe}
              planned={planned}
              expected={placeholder}
              onChange={(n) => {
                setRpe(rpe === n ? null : n);
                changed();
              }}
            />
          </Question>
        </FormSection>
      ) : null}

      {/* For a changed session, what changed follows the quick effort rating. */}
      {status === 'changed' ? notesSection : null}

      {detailShown ? (
        <FormSection>
          <Question title="How did your body feel?" hint="Optional · pick the closest">
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
              {FEEL.map(({ label, icon }, i) => {
                const on = feel === i + 1;
                return (
                  <PressableScale
                    key={label}
                    haptic="select"
                    onPress={() => {
                      setFeel(on ? null : i + 1);
                      changed();
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: on }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 12,
                      borderRadius: 14,
                      backgroundColor: on ? theme.accentSoft : theme.colors.surfaceRaised,
                      borderWidth: 1.5,
                      borderColor: on ? theme.accent : 'transparent',
                    }}
                  >
                    <Ionicons
                      name={icon}
                      size={22}
                      color={on ? theme.accentText : theme.colors.textDim}
                    />
                    <Text
                      variant="caption"
                      style={{
                        fontSize: 11.5,
                        fontWeight: on ? '800' : '600',
                        color: on ? theme.accentText : theme.colors.text,
                      }}
                    >
                      {label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </Question>
          {factorsShown ? (
            <Question title="What affected it?" hint="Choose any · optional">
              <Chips
                label="Contributing factors"
                options={(Object.keys(REASON_LABELS) as Reason[]).map(
                  (reason) => [reason, REASON_LABELS[reason]] as const,
                )}
                selected={(reason) => reasons.includes(reason)}
                onPress={(reason) => {
                  setReasons((r) =>
                    r.includes(reason) ? r.filter((x) => x !== reason) : [...r, reason],
                  );
                  changed();
                }}
              />
            </Question>
          ) : null}
          {reasons.includes('pain') ? (
            <>
              <Question title="Where is the pain?">
                <Options
                  label="Pain area"
                  value={answers.painArea}
                  values={PAIN_AREAS}
                  onChange={(v) => setAnswer('painArea', v)}
                />
              </Question>
              <Question title="How bad was it?">
                <Options
                  label="Pain severity"
                  value={answers.painSeverity}
                  values={PAIN_SEVERITY}
                  onChange={(v) => setAnswer('painSeverity', v)}
                />
              </Question>
            </>
          ) : null}
          {safety ? (
            <Notice tone="warning">
              {`Rest and seek professional advice for pain that changes how you move. Your ${coach} won’t prescribe training through it.`}
            </Notice>
          ) : null}
        </FormSection>
      ) : null}

      {/* The folds share their own card, after the body questions, so neither card's title
          misdescribes the other's contents. */}
      {detailShown && (!factorsShown || (aboutSession && !sessionShown)) ? (
        <FormSection>
          {factorsShown ? null : (
            <Disclosure
              label="What affected it"
              hint="Sleep, fuel, pain, time"
              onPress={() => setFactorsOpen(true)}
            />
          )}
          {!factorsShown && aboutSession && !sessionShown ? (
            <View
              style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }}
            />
          ) : null}
          {aboutSession && !sessionShown ? (
            <Disclosure
              label={
                ['intervals', 'tempo', 'speed'].includes(kind)
                  ? 'Interval feedback'
                  : 'Session feedback'
              }
              hint={
                ['intervals', 'tempo', 'speed'].includes(kind)
                  ? 'How the reps went'
                  : 'How the session went'
              }
              onPress={() => setSessionOpen(true)}
            />
          ) : null}
        </FormSection>
      ) : null}

      {sessionShown ? (
        <FormSection title="About the session">
          {['intervals', 'tempo', 'speed'].includes(kind) ? (
            <Question title="How did the intervals go?" hint="Optional">
              <Options
                label="Interval feedback"
                value={answers.intervals}
                values={[
                  ['on_target', 'All reps on target'],
                  ['faded', 'Faded on the last reps'],
                  ['missed', 'Couldn’t hold the target'],
                  ['stopped', 'Stopped early'],
                ]}
                onChange={(v) => setAnswer('intervals', v)}
              />
            </Question>
          ) : null}
          {kind === 'long' ? (
            <>
              <Question title="How did you finish?">
                <Options
                  label="Finish"
                  value={answers.finish}
                  values={[
                    ['strong', 'Strong'],
                    ['faded', 'Faded late'],
                    ['struggled', 'Struggled throughout'],
                  ]}
                  onChange={(v) => setAnswer('finish', v)}
                />
              </Question>
              <Question title="Did you fuel the session?">
                <Options
                  label="Fuelling"
                  value={answers.fuelled}
                  values={[
                    ['yes', 'Yes'],
                    ['some', 'Some'],
                    ['no', 'No'],
                  ]}
                  onChange={(v) => setAnswer('fuelled', v)}
                />
              </Question>
            </>
          ) : null}
          {kind === 'strength' ? (
            <>
              <Question title="Were the weights right?">
                <Options
                  label="Weight feedback"
                  value={answers.weights}
                  values={[
                    ['light', 'Too light'],
                    ['right', 'About right'],
                    ['heavy', 'Too heavy'],
                  ]}
                  onChange={(v) => setAnswer('weights', v)}
                />
              </Question>
              <Field
                label="Weights used (optional)"
                value={answers.weightsUsed ?? ''}
                maxLength={1000}
                placeholder="e.g. Back squat 40 kg, 3 × 8"
                onChangeText={(v) => setAnswer('weightsUsed', v || undefined)}
              />
            </>
          ) : null}
          {kind === 'brick' ? (
            <Question title="Which part was hardest?">
              <Options
                label="Hardest part"
                value={answers.hardestPart}
                values={[
                  ['run', 'Run'],
                  ['cycle', 'Ride'],
                  ['swim', 'Swim'],
                  ['strength', 'Strength'],
                  ['row', 'Row'],
                  ['ski_erg', 'Ski erg'],
                  ['transitions', 'Transitions'],
                ]}
                onChange={(v) => setAnswer('hardestPart', v)}
              />
            </Question>
          ) : null}
          {kind === 'race' ? (
            <Question title="How did the race go?">
              <Options
                label="Race feedback"
                value={answers.race}
                values={[
                  ['to_plan', 'Went to plan'],
                  ['faded', 'Faded'],
                  ['better', 'Better than expected'],
                ]}
                onChange={(v) => setAnswer('race', v)}
              />
            </Question>
          ) : null}
          {['test', 'race'].includes(kind) ? (
            <Question title="Your result (optional)">
              <PerformanceResult
                key={performed}
                discipline={workout.discipline}
                value={answers.result}
                performedOn={performed}
                onChange={(v) => setAnswer('result', v)}
                onBusyChange={setResultBusy}
              />
            </Question>
          ) : null}
        </FormSection>
      ) : null}

      {/* Folds sit in a card, like the one inside the body questions, so every fold lines up. */}
      {!detailShown ? (
        <FormSection>
          <Disclosure
            label="More detail"
            hint="How your body felt, and how the session went"
            onPress={() => setMoreOpen(true)}
          />
        </FormSection>
      ) : null}

      {status === 'changed' ? null : notesSection}

      {/* Talking it through is the second choice, so it sits below the form, not in the footer. */}
      <View style={{ gap: 8 }}>
        <Button
          label={inAppCoach ? 'Save and talk it through' : 'Save and ask your agent'}
          icon={askIcon}
          variant="ghost"
          busy={discuss.isPending}
          disabled={busy}
          onPress={() => void persist(true)}
        />
        <Text variant="caption" color="muted" style={{ textAlign: 'center', fontSize: 12 }}>
          Saving feedback never changes your plan.
        </Text>
      </View>
      {log ? (
        <View style={{ gap: 10 }}>
          {/* A quiet text action at the very end: clearing is rare and can't be undone. */}
          <Pressable
            onPress={
              busy || clear.isPending
                ? undefined
                : () =>
                    clear.mutate(undefined, { onSuccess: () => guard.exit(() => leaveScreen()) })
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy: clear.isPending }}
            hitSlop={8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 8,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Ionicons name="trash-outline" size={14} color={theme.danger} />
            <Text variant="caption" style={{ color: theme.danger, fontWeight: '700' }}>
              {clear.isPending ? 'Clearing…' : 'Clear this log'}
            </Text>
          </Pressable>
          {clear.error ? <ErrorState message={clear.error.message} /> : null}
        </View>
      ) : null}
    </FormScreen>
  );
}
