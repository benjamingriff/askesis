import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
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
import { useCoachWord, useInAppCoach } from '../data/account';
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
import { METRES_PER_MILE, METRES_PER_YARD, formatLong } from '../lib/format';
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

const STATUS_ICON: Record<LogStatus, IconName> = {
  done: 'checkmark-circle',
  changed: 'create',
  skipped: 'close-circle',
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

  // The form starts from the saved log, so it waits for the training log as well as the workout.
  if (!workout || !plan.data || !logs.data)
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
      unit={planVersion(plan.data, 'locked')}
      planId={plan.data.id}
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
  unit,
  planId,
}: {
  workout: WorkoutSummary;
  log: WorkoutLog | undefined;
  initialStatus: LogStatus | undefined;
  planName: string;
  writable: boolean;
  unit: ReturnType<typeof planVersion>;
  planId: string;
}) {
  const theme = useTheme();
  const coach = useCoachWord();
  const inAppCoach = useInAppCoach();
  const today = useLocalToday();
  const brief = useBriefState(planId, unit);
  const units = useUnits(brief.data?.brief.unit);
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
  const [minutes, setMinutes] = useState(() => {
    const seconds = log
      ? log.actualDurationSeconds
      : status === 'done'
        ? workout.estimatedDurationSeconds
        : null;
    return seconds == null ? '' : String(Math.round((seconds / 60) * 10) / 10);
  });
  const [distance, setDistance] = useState(() => {
    const metres = log
      ? log.actualDistanceMetres
      : status === 'done'
        ? workout.estimatedDistanceMetres
        : null;
    if (metres == null) return '';
    const value = metres / metresPer;
    return String(
      metresPer === 1 || distanceUnit === 'yd' ? Math.round(value) : Math.round(value * 100) / 100,
    );
  });
  // Gym sessions have no distance, unless one was already recorded.
  const [showDistance] = useState(workout.discipline !== 'strength' || distance !== '');
  const [rpe, setRpe] = useState<number | null>(log?.rpe ?? null);
  const [feel, setFeel] = useState<number | null>(log?.feel ?? null);
  const [reasons, setReasons] = useState<Reason[]>(log?.reasons ?? []);
  const [note, setNote] = useState(log?.note ?? '');
  const [answers, setAnswers] = useState<Answers>(log?.answers ?? {});
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
    const secs = minutes.trim() ? Math.round(number(minutes) * 60) : null;
    const metres = distance.trim() ? Math.round(number(distance) * metresPer * 10) / 10 : null;
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
  const showReasons =
    status !== 'done' ||
    (rpe != null && planned != null && (rpe - planned >= 2 || planned - rpe >= 3)) ||
    reasons.length > 0;
  const safety =
    reasons.includes('pain') && answers.painSeverity && answers.painSeverity !== 'mild';
  const active = status !== 'skipped';

  return (
    <FormScreen
      title={log ? 'Edit log' : 'Log workout'}
      subtitle={formatLong(workout.scheduledDate)}
      guard={guard}
      saveLabel="Save"
      saving={save.isPending && !discuss.isPending}
      canSave={!busy}
      onSave={() => void persist(false)}
      footer={
        <View style={{ gap: 10 }}>
          <Button
            label="Save and talk it through"
            icon="chatbubble-ellipses"
            busy={discuss.isPending}
            disabled={busy}
            onPress={() => void persist(true)}
          />
          <Text variant="caption" color="muted" style={{ textAlign: 'center', fontSize: 12 }}>
            Saving feedback never changes your plan. Your {coach} helps only when you choose to
            talk.
          </Text>
        </View>
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
        <Question title="Did you do it?">
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
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 14,
                    borderRadius: 16,
                    backgroundColor: on ? alpha(tint, 0.16) : theme.colors.surfaceRaised,
                    borderWidth: 1.5,
                    borderColor: on ? tint : 'transparent',
                  }}
                >
                  <Ionicons
                    name={STATUS_ICON[s]}
                    size={22}
                    color={on ? tint : theme.colors.textMuted}
                  />
                  <Text
                    variant="caption"
                    style={{ fontWeight: '800', color: on ? tint : theme.colors.text }}
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

      <FormSection
        title={active ? 'What you did' : 'When'}
        description={
          active
            ? `Done starts with the ${placeholder ? 'expected' : 'planned'} amounts as estimates. Correct them or leave them blank if unknown.`
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
                suffix={distanceUnit}
              />
            ) : null}
          </View>
        ) : null}
      </FormSection>

      {active ? (
        <FormSection>
          <Question
            title="How hard was it overall?"
            hint={`Optional · ${
              placeholder && workout.expectedRpe
                ? `expected ${expectedEffort(workout)}`
                : `planned ${planned == null ? 'effort not set' : `~${planned}/10`}`
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

      {active &&
      (
        ['intervals', 'tempo', 'speed', 'long', 'strength', 'brick', 'race', 'test'] as string[]
      ).includes(kind) ? (
        <FormSection title="About the session">
          {['intervals', 'tempo', 'speed'].includes(kind) ? (
            <Question title="How did the intervals go?">
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

      <FormSection>
        <Question title="How did your body feel?">
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
        {showReasons ? (
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
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon="add"
            label="Add contributing factors"
            style={{ alignSelf: 'flex-start' }}
            onPress={() => {
              setReasons(['other']);
              changed();
            }}
          />
        )}
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

      <FormSection>
        <Field
          label={placeholder ? 'What did you do?' : `Anything else for your ${coach}?`}
          value={note}
          multiline
          maxLength={2000}
          onChangeText={(value) => {
            setNote(value);
            changed();
          }}
          placeholder={
            placeholder
              ? `The session, such as 6 × 800 m off 90 s, and anything else for your ${coach}…`
              : 'How it went, what helped, or anything you want to talk through…'
          }
        />
      </FormSection>

      {log ? (
        <View style={{ gap: 10 }}>
          <Button
            variant="danger"
            size="md"
            icon="trash-outline"
            label="Clear this log"
            busy={clear.isPending}
            disabled={busy}
            onPress={() =>
              clear.mutate(undefined, { onSuccess: () => guard.exit(() => leaveScreen()) })
            }
          />
          {clear.error ? <ErrorState message={clear.error.message} /> : null}
        </View>
      ) : null}
    </FormScreen>
  );
}
