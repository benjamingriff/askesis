import { createContext, useContext, useState, type ReactNode, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import {
  Check,
  Pencil,
  X,
  CircleDashed,
  MessageSquare,
  History,
  HeartPulse,
  Undo2,
  Laugh,
  Smile,
  Meh,
  Frown,
  BatteryLow,
} from 'lucide-react';
import type { WorkoutSummary } from '@askesis/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { result } from '../lib/result';
import { addDays, formatDuration, formatDistance, formatLong } from '../lib/format';
import { useRequestKey } from '../lib/use-request-key';
import {
  KIND_META,
  expectedEffort,
  inferKind,
  workoutLook,
  type WorkoutKind,
} from '../lib/workouts';
import { useLocalToday } from '../lib/use-local-today';
import { useUnits } from '../settings';
import {
  useTrainingLog,
  useSaveLog,
  useClearLog,
  useDiscussFeedback,
  LOG_LABELS,
  REASON_LABELS,
  effortFlag,
  fullFeedback,
  type WorkoutLog,
  type LogInput,
  type CheckInInput,
} from '../training-log';
import { Button, Dialog, Notice, ErrorState, LoadingState, SectionHeader } from './ui';
import { PerformanceResult } from './TrainingResult';
import type { Plan } from '../plan-data';

type Subject = {
  workout: WorkoutSummary;
  log?: WorkoutLog | undefined;
  status?: LogInput['status'] | undefined;
};
const LogContext = createContext<{
  logs: WorkoutLog[];
  ready: boolean;
  writable: boolean;
  lockedVersionId: string | undefined;
  edit: (w: WorkoutSummary, l?: WorkoutLog, s?: LogInput['status']) => void;
} | null>(null);
export const useLogContext = () => useContext(LogContext);
export function TrainingLogProvider({ plan, children }: { plan: Plan; children: ReactNode }) {
  const query = useTrainingLog(plan.id);
  const [subject, setSubject] = useState<Subject | null>(null);
  return (
    <LogContext.Provider
      value={{
        logs: query.data?.logs ?? [],
        ready: !!query.data,
        writable: !!plan.locked && !plan.archived,
        lockedVersionId: plan.locked?.id,
        edit: (workout, log, status) => {
          if (plan.archived || (!log && workout.planVersionId !== plan.locked?.id)) return;
          setSubject({ workout: log ? loggedWorkout(log, workout) : workout, log, status });
        },
      }}
    >
      {children}
      {query.error ? (
        <Notice
          tone="danger"
          role="alert"
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        >
          Couldn’t load your training log: {query.error.message}
        </Notice>
      ) : null}
      {subject ? (
        <FeedbackSheet
          key={`${subject.workout.lineageId}/${subject.status ?? 'edit'}`}
          subject={subject}
          onClose={() => setSubject(null)}
        />
      ) : null}
    </LogContext.Provider>
  );
}
export function LogChip({
  log,
  unlogged = false,
}: {
  log?: WorkoutLog | undefined;
  unlogged?: boolean;
}) {
  if (!log && !unlogged) return null;
  const status = log?.status ?? 'unlogged',
    Icon =
      status === 'done'
        ? Check
        : status === 'changed'
          ? Pencil
          : status === 'skipped'
            ? X
            : CircleDashed;
  return (
    <span className={`log-chip ${status}`}>
      <Icon size={13} aria-hidden="true" />
      {log ? LOG_LABELS[log.status] : 'Not logged'}
      {log?.rpe != null ? <span className="rpe">RPE {log.rpe}</span> : null}
    </span>
  );
}
export function LogMark({
  logs,
  date,
  today,
}: {
  logs: WorkoutLog[];
  date: string;
  today: string;
}) {
  if (date > today) return null;
  const status = logs.some((l) => l.status === 'changed')
    ? 'changed'
    : logs.some((l) => l.status === 'skipped')
      ? 'skipped'
      : logs.length
        ? 'done'
        : 'unlogged';
  const Icon =
    status === 'done'
      ? Check
      : status === 'changed'
        ? Pencil
        : status === 'skipped'
          ? X
          : CircleDashed;
  return (
    <span
      className={`strip-log ${status}`}
      aria-label={status === 'unlogged' ? 'Not logged' : LOG_LABELS[status]}
    >
      <Icon size={12} aria-hidden="true" />
    </span>
  );
}
export function WorkoutLogActions({
  workout,
  detail = false,
  compact = false,
}: {
  workout: WorkoutSummary;
  detail?: boolean;
  compact?: boolean;
}) {
  const context = useLogContext(),
    today = useLocalToday(),
    units = useUnits();
  const log = context?.logs.find((l) => l.lineageId === workout.lineageId),
    save = useSaveLog(workout.planId, workout.lineageId),
    clear = useClearLog(workout.planId, workout.lineageId);
  const busy = save.isPending || clear.isPending;
  if (!context || !context.ready || (!log && workout.scheduledDate > today)) return null;
  if (!log && workout.planVersionId !== context.lockedVersionId)
    return context.writable ? (
      <p className="fb-hint">Log the published workout from Today after its scheduled date.</p>
    ) : null;
  const choose = (status: LogInput['status']) => {
    const full = fullFeedback(
      { ...workout, sessionType: workout.sessionType ?? inferKind(workout) },
      status,
    );
    save.mutate(
      { status },
      {
        onSuccess: (saved) => {
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
  return (
    <section
      className={compact ? 'quick-log' : detail ? 'your-log' : 'hero-log-wrapper'}
      aria-label={`Log ${workout.title}`}
    >
      <div className="hero-log">
        <div className="hero-log-copy">
          {log ? (
            <>
              <LogChip log={log} />
              {log.actualSessionType ? (
                <small>Was {KIND_META[log.actualSessionType].label.toLowerCase()}</small>
              ) : null}
            </>
          ) : (
            <>
              <strong>How did it go?</strong>
              <small>
                {workout.placeholder
                  ? 'Tell your coach what the session turned out to be.'
                  : 'A quick log is enough. Add detail if it’s useful.'}
              </small>
            </>
          )}
        </div>
        {context.writable ? (
          <div className="log-actions">
            {log ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Pencil}
                  disabled={busy}
                  onClick={() => context.edit(workout, log)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Undo2}
                  disabled={busy}
                  onClick={() => clear.mutate()}
                >
                  Undo
                </Button>
              </>
            ) : (
              <>
                {(compact
                  ? (['done', 'skipped'] as const)
                  : (['done', 'changed', 'skipped'] as const)
                ).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    className={s === 'done' ? 'btn-done' : ''}
                    disabled={busy}
                    onClick={() => choose(s)}
                  >
                    {LOG_LABELS[s]}
                  </Button>
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
      {save.error || clear.error ? (
        <Notice tone="danger" role="alert">
          {save.error?.message ?? clear.error?.message}
        </Notice>
      ) : null}
      {!compact && log && log.status !== 'skipped' ? (
        <div className="quick-rpe">
          <div className="quick-rpe-head">
            <strong>How hard was it overall?</strong>
            <small>
              Optional · {log.placeholder ? 'expected' : 'planned'}{' '}
              {log.plannedRpe == null ? 'effort not set' : `~${log.plannedRpe}/10`}
            </small>
          </div>
          <RpeScale
            value={log.rpe}
            planned={log.plannedRpe}
            expected={log.placeholder}
            disabled={!context.writable || busy}
            onChange={rate}
          />
          {effortFlag(log) ? <span className="fb-hint">{effortFlag(log)}</span> : null}
          {context.writable ? (
            <Button size="sm" variant="ghost" onClick={() => context.edit(workout, log)}>
              Add details
            </Button>
          ) : null}
        </div>
      ) : null}
      {detail && log ? (
        <>
          <div className="pva">
            <div>
              <small>Time · planned / actual</small>
              <strong>
                {formatDuration(log.plannedDurationSeconds ?? 0)} /{' '}
                {log.actualDurationSeconds == null
                  ? '—'
                  : formatDuration(log.actualDurationSeconds)}
              </strong>
            </div>
            <div>
              <small>Distance · planned / actual</small>
              <strong>
                {log.plannedDistanceMetres == null
                  ? '—'
                  : formatDistance(log.plannedDistanceMetres, units)}{' '}
                /{' '}
                {log.actualDistanceMetres == null
                  ? '—'
                  : formatDistance(log.actualDistanceMetres, units)}
              </strong>
            </div>
          </div>
          {log.actualSessionType ? (
            <p className="muted">
              Turned out to be {KIND_META[log.actualSessionType].label.toLowerCase()}
            </p>
          ) : null}
          {log.reasons.length ? (
            <p className="muted">{log.reasons.map((r) => REASON_LABELS[r]).join(' · ')}</p>
          ) : null}
          {log.note ? <blockquote className="log-quote">{log.note}</blockquote> : null}
        </>
      ) : null}
    </section>
  );
}
export function logInput(log: WorkoutLog, changes: Partial<LogInput> = {}): LogInput {
  return {
    status: log.status,
    performedOn: log.performedOn,
    actualDurationSeconds: log.actualDurationSeconds,
    actualDistanceMetres: log.actualDistanceMetres,
    rpe: log.rpe,
    feel: log.feel,
    reasons: log.reasons,
    answers: log.answers,
    note: log.note,
    ...(log.placeholder ? { actualSessionType: log.actualSessionType } : {}),
    ...changes,
  };
}
const RPE_WORDS = [
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
  return (
    <>
      <div
        className={`rpe-scale${expected ? ' is-expected' : ''}`}
        role="group"
        aria-label="Session effort"
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            type="button"
            key={n}
            aria-label={`Effort ${n}: ${RPE_WORDS[n - 1]}`}
            aria-pressed={value === n}
            disabled={disabled}
            className={`${value === n ? 'active ' : ''}${planned != null && n === Math.round(planned) ? 'expected' : ''}`}
            style={
              {
                '--rpe':
                  n <= 2
                    ? 'var(--effort-recovery)'
                    : n <= 4
                      ? 'var(--effort-easy)'
                      : n <= 5
                        ? 'var(--effort-steady)'
                        : n <= 7
                          ? 'var(--effort-threshold)'
                          : n <= 9
                            ? 'var(--effort-hard)'
                            : 'var(--effort-max)',
              } as CSSProperties
            }
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="rpe-legend">
        <span>Easy</span>
        <span>Moderate</span>
        <span>Hard</span>
        <span>Max</span>
      </div>
      {value ? (
        <p className="rpe-readout">
          <b>{value}/10</b>
          <span>{RPE_WORDS[value - 1]}</span>
        </p>
      ) : null}
    </>
  );
}
function Options<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T | undefined;
  values: [T, string][];
  onChange: (v: T | undefined) => void;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {values.map(([key, text]) => (
        <button
          type="button"
          key={key}
          className={value === key ? 'active' : ''}
          aria-pressed={value === key}
          onClick={() => onChange(value === key ? undefined : key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
type ActualType = NonNullable<LogInput['actualSessionType']>;
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
const FEEL = [
  { label: 'Strong', Icon: Laugh },
  { label: 'Good', Icon: Smile },
  { label: 'Normal', Icon: Meh },
  { label: 'Tired', Icon: Frown },
  { label: 'Drained', Icon: BatteryLow },
];
function FeedbackSheet({ subject, onClose }: { subject: Subject; onClose: () => void }) {
  const { workout, log } = subject,
    navigate = useNavigate(),
    today = useLocalToday();
  const [status, setStatus] = useState<LogInput['status']>(subject.status ?? log?.status ?? 'done');
  const [performed, setPerformed] = useState(log?.performedOn ?? workout.scheduledDate);
  const [minutes, setMinutes] = useState(() => {
    const seconds = log
      ? log.actualDurationSeconds
      : status === 'done'
        ? workout.estimatedDurationSeconds
        : null;
    return seconds == null ? '' : String(seconds / 60);
  });
  const [distance, setDistance] = useState(() => {
    const metres = log
      ? log.actualDistanceMetres
      : status === 'done'
        ? workout.estimatedDistanceMetres
        : null;
    return metres == null ? '' : String(metres);
  });
  const [rpe, setRpe] = useState<number | null>(log?.rpe ?? null),
    [feel, setFeel] = useState<number | null>(log?.feel ?? null);
  const [reasons, setReasons] = useState<NonNullable<LogInput['reasons']>>(log?.reasons ?? []),
    [note, setNote] = useState(log?.note ?? '');
  const [answers, setAnswers] = useState<NonNullable<LogInput['answers']>>(log?.answers ?? {});
  const placeholder = !!(log?.placeholder ?? workout.placeholder);
  const [actualType, setActualType] = useState<ActualType | undefined>(
    log?.actualSessionType ?? undefined,
  );
  const save = useSaveLog(workout.planId, workout.lineageId),
    discuss = useDiscussFeedback(workout.planId),
    clear = useClearLog(workout.planId, workout.lineageId);
  const [resultBusy, setResultBusy] = useState(false);
  const busy = save.isPending || discuss.isPending || clear.isPending || resultBusy;
  // Follow-up questions match what a placeholder turned out to be, once the athlete says.
  const kind =
      (status !== 'skipped' ? actualType : undefined) ??
      log?.sessionType ??
      workout.sessionType ??
      inferKind(workout),
    look = workoutLook(workout),
    planned = log ? log.plannedRpe : workout.plannedRpe;
  const [saved, setSaved] = useState<WorkoutLog | null>(null),
    [localError, setLocalError] = useState<string | null>(null);
  const setAnswer = <K extends keyof typeof answers>(key: K, value: (typeof answers)[K]) => {
    setAnswers((a) => {
      const next = { ...a };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setSaved(null);
  };
  const payload = (): LogInput => {
    const secs = minutes.trim() ? Math.round(Number(minutes) * 60) : null,
      metres = distance.trim() ? Number(distance) : null;
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
      if (talk) {
        const id = await discuss.mutateAsync({
          content: `I’d like to talk through my ${LOG_LABELS[current.status].toLowerCase()} workout: ${current.title}, ${current.performedOn}.${current.rpe != null ? ` Effort ${current.rpe}/10.` : ''}${current.note ? ` ${current.note}` : ''}`,
          reference: { type: 'workout_log', logId: current.id },
        });
        void navigate(`/chat/${id}`);
      }
      onClose();
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
  return (
    <Dialog
      open
      size="md"
      className="training-feedback"
      busy={busy}
      onClose={onClose}
      title={
        <span className="fb-title">
          <span className="kind-line">
            <look.icon size={15} />
            {look.label}
            {workout.priority === 'high' ? ' · Key session' : ''}
          </span>
          {workout.title}
        </span>
      }
      description={formatLong(workout.scheduledDate)}
      footer={
        <>
          <Button
            variant="primary"
            icon={MessageSquare}
            disabled={busy}
            busy={busy}
            onClick={() => void persist(true)}
          >
            Save and talk it through
          </Button>
          <Button disabled={busy} onClick={() => void persist(false)}>
            Save
          </Button>
          <p className="fb-footer-note">
            Saving feedback never changes your plan. Your coach helps only when you choose to talk.
          </p>
        </>
      }
    >
      <fieldset className="feedback-form" disabled={busy} onChange={() => setSaved(null)}>
        {localError ? (
          <Notice tone="danger" role="alert">
            {saved ? 'Your log is saved. ' : ''}
            {localError}
          </Notice>
        ) : null}
        <section className="fb-section">
          <div className="fb-question">
            <h3>Did you do it?</h3>
          </div>
          <div className="status-choice" role="group" aria-label="Workout status">
            {(['done', 'changed', 'skipped'] as const).map((s) => (
              <button
                type="button"
                key={s}
                className={`${s}${status === s ? ' active' : ''}`}
                aria-pressed={status === s}
                onClick={() => {
                  setStatus(s);
                  setSaved(null);
                }}
              >
                {s === 'done' ? (
                  <Check size={18} />
                ) : s === 'changed' ? (
                  <Pencil size={18} />
                ) : (
                  <X size={18} />
                )}{' '}
                {LOG_LABELS[s]}
              </button>
            ))}
          </div>
        </section>
        {placeholder && status !== 'skipped' ? (
          <section className="fb-section">
            <div className="fb-question">
              <h3>What was it?</h3>
              {workout.sessionType ? (
                <small>
                  Your coach assumed {KIND_META[workout.sessionType].label.toLowerCase()}
                </small>
              ) : null}
            </div>
            <Options
              label="What the session was"
              value={actualType}
              values={ACTUAL_TYPES.map((type) => [type, KIND_META[type].label])}
              onChange={(v) => {
                setActualType(v);
                setSaved(null);
              }}
            />
          </section>
        ) : null}
        <section className="fb-section">
          <div className="field-row">
            <label className="field">
              <span>{status === 'skipped' ? 'Date' : 'Performed on'}</span>
              <input
                type="date"
                value={performed}
                max={today}
                onChange={(e) => {
                  setPerformed(e.target.value);
                  setAnswer('result', undefined);
                }}
              />
            </label>
            {status !== 'skipped' ? (
              <>
                <label className="field">
                  <span>Actual time (minutes)</span>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Actual distance (metres)</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                  />
                </label>
              </>
            ) : null}
          </div>
          <p className="fb-hint">
            Done starts with the {placeholder ? 'expected' : 'planned'} amounts as estimates.
            Correct them or leave them blank if unknown.
          </p>
        </section>
        {status !== 'skipped' ? (
          <section className="fb-section">
            <div className="fb-question">
              <h3>How hard was it overall?</h3>
              <small>
                Optional ·{' '}
                {placeholder && workout.expectedRpe
                  ? `expected ${expectedEffort(workout)}`
                  : `planned ${planned == null ? 'effort not set' : `~${planned}/10`}`}
              </small>
            </div>
            <RpeScale
              value={rpe}
              planned={planned}
              expected={placeholder}
              onChange={(n) => {
                setRpe(rpe === n ? null : n);
                setSaved(null);
              }}
            />
          </section>
        ) : null}
        {status !== 'skipped' && ['intervals', 'tempo', 'speed'].includes(kind) ? (
          <section className="fb-section">
            <h3>How did the intervals go?</h3>
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
          </section>
        ) : null}
        {status !== 'skipped' && kind === 'long' ? (
          <section className="fb-section">
            <h3>How did you finish?</h3>
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
            <h3>Did you fuel the session?</h3>
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
          </section>
        ) : null}
        {status !== 'skipped' && kind === 'strength' ? (
          <section className="fb-section">
            <h3>Were the weights right?</h3>
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
            <label className="field">
              <span>Weights used (optional)</span>
              <input
                value={answers.weightsUsed ?? ''}
                maxLength={1000}
                placeholder="e.g. Back squat 40 kg, 3 × 8"
                onChange={(e) => setAnswer('weightsUsed', e.target.value || undefined)}
              />
            </label>
          </section>
        ) : null}
        {status !== 'skipped' && kind === 'brick' ? (
          <section className="fb-section">
            <h3>Which part was hardest?</h3>
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
          </section>
        ) : null}
        {status !== 'skipped' && kind === 'race' ? (
          <section className="fb-section">
            <h3>How did the race go?</h3>
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
          </section>
        ) : null}
        {status !== 'skipped' && ['test', 'race'].includes(kind) ? (
          <PerformanceResult
            key={performed}
            discipline={workout.discipline}
            value={answers.result}
            performedOn={performed}
            onChange={(v) => setAnswer('result', v)}
            onBusyChange={setResultBusy}
          />
        ) : null}
        <section className="fb-section">
          <h3>How did your body feel?</h3>
          <div className="feel-scale" role="group" aria-label="Body feel">
            {FEEL.map(({ label, Icon }, i) => (
              <button
                type="button"
                key={label}
                className={feel === i + 1 ? 'active' : ''}
                aria-pressed={feel === i + 1}
                onClick={() => {
                  setFeel(feel === i + 1 ? null : i + 1);
                  setSaved(null);
                }}
              >
                <Icon size={22} />
                {label}
              </button>
            ))}
          </div>
        </section>
        {showReasons ? (
          <section className="fb-section">
            <div className="fb-question">
              <h3>What affected it?</h3>
              <small>Choose any · optional</small>
            </div>
            <div className="chips" role="group" aria-label="Contributing factors">
              {(Object.keys(REASON_LABELS) as (keyof typeof REASON_LABELS)[]).map((reason) => (
                <button
                  type="button"
                  key={reason}
                  className={reasons.includes(reason) ? 'active' : ''}
                  aria-pressed={reasons.includes(reason)}
                  onClick={() => {
                    setReasons((r) =>
                      r.includes(reason) ? r.filter((x) => x !== reason) : [...r, reason],
                    );
                    setSaved(null);
                  }}
                >
                  {REASON_LABELS[reason]}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setReasons(['other']);
              setSaved(null);
            }}
          >
            Add contributing factors
          </Button>
        )}
        {reasons.includes('pain') ? (
          <section className="fb-section">
            <h3>Where is the pain?</h3>
            <Options
              label="Pain area"
              value={answers.painArea}
              values={[
                ['foot', 'Foot'],
                ['ankle', 'Ankle'],
                ['calf', 'Calf'],
                ['knee', 'Knee'],
                ['hip', 'Hip'],
                ['back', 'Back'],
                ['shoulder', 'Shoulder'],
                ['other', 'Other'],
              ]}
              onChange={(v) => setAnswer('painArea', v)}
            />
            <h3>How bad was it?</h3>
            <Options
              label="Pain severity"
              value={answers.painSeverity}
              values={[
                ['mild', 'Mild · moved normally'],
                ['changed_movement', 'Changed how I moved'],
                ['stopped', 'Had to stop'],
              ]}
              onChange={(v) => setAnswer('painSeverity', v)}
            />
          </section>
        ) : null}
        {safety ? (
          <Notice tone="warning">
            Rest and seek professional advice for pain that changes how you move. Your coach won’t
            prescribe training through it.
          </Notice>
        ) : null}
        <section className="fb-section">
          <label className="field">
            <span>{placeholder ? 'What did you do?' : 'Anything else for your coach?'}</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                placeholder
                  ? 'The session, such as 6 × 800 m off 90 s, and anything else for your coach…'
                  : 'How it went, what helped, or anything you want to talk through…'
              }
            />
          </label>
        </section>
        {log ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => clear.mutate(undefined, { onSuccess: onClose })}
          >
            Clear this log
          </Button>
        ) : null}
        {clear.error ? (
          <Notice tone="danger" role="alert">
            {clear.error.message}
          </Notice>
        ) : null}
      </fieldset>
    </Dialog>
  );
}
function loggedWorkout(log: WorkoutLog, current?: WorkoutSummary): WorkoutSummary {
  return {
    id: current?.id ?? log.lineageId,
    lineageId: log.lineageId,
    planId: log.planId,
    planVersionId: log.loggedVersionId,
    planTitle: current?.planTitle ?? '',
    weekNumber: current?.weekNumber ?? 1,
    scheduledDate: log.scheduledOn,
    title: log.title,
    description: null,
    purpose: null,
    discipline: log.discipline,
    priority: log.keySession ? 'high' : 'medium',
    racePriority: log.sessionType === 'race' ? 'C' : null,
    sessionType: log.sessionType,
    plannedRpe: log.plannedRpe,
    estimatedDurationSeconds: log.plannedDurationSeconds,
    estimatedDistanceMetres: log.plannedDistanceMetres,
    placeholder: log.placeholder,
    expectedRpe: log.placeholder ? (current?.expectedRpe ?? null) : null,
  };
}
export function TrainingHistory({
  planId,
  workouts,
  readOnly = false,
}: {
  planId: string;
  workouts: WorkoutSummary[];
  readOnly?: boolean;
}) {
  const query = useTrainingLog(planId),
    context = useLogContext(),
    [open, setOpen] = useState(false);
  const units = useUnits();
  return (
    <>
      <Button icon={History} size="sm" onClick={() => setOpen(true)}>
        Training log
      </Button>
      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          size="lg"
          title="Your training log"
          description="Your recorded sessions, including workouts from earlier plan versions."
        >
          {query.isPending ? <LoadingState>Loading log…</LoadingState> : null}
          {query.error ? (
            <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
          ) : null}
          {query.data && !query.data.logs.length ? (
            <p className="muted">
              No workouts logged yet. Open a due workout or use Today to record one.
            </p>
          ) : null}
          <div className="training-history">
            {[...(query.data?.logs ?? [])].reverse().map((log) => {
              const found = workouts.find((w) => w.lineageId === log.lineageId);
              const workout = loggedWorkout(log, found);
              return (
                <article key={log.id} className="training-history-entry">
                  <SectionHeader title={log.title} action={<LogChip log={log} />} />
                  <p className="muted">
                    {formatLong(log.performedOn)} ·{' '}
                    {log.actualDurationSeconds == null
                      ? 'Time not recorded'
                      : formatDuration(log.actualDurationSeconds)}
                    {log.actualDistanceMetres == null
                      ? ''
                      : ` · ${formatDistance(log.actualDistanceMetres, units)}`}
                    {log.actualSessionType
                      ? ` · Was ${KIND_META[log.actualSessionType].label.toLowerCase()}`
                      : ''}
                    {!found ? ' · From an earlier plan version' : ''}
                  </p>
                  {log.note ? <p>{log.note}</p> : null}
                  {!readOnly && context?.writable ? (
                    <Button
                      size="sm"
                      icon={Pencil}
                      onClick={() => {
                        setOpen(false);
                        context.edit(workout, log);
                      }}
                    >
                      Edit log
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

export function CheckInButton({ plan, workouts }: { plan: Plan; workouts: WorkoutSummary[] }) {
  const [open, setOpen] = useState(false);
  if (plan.archived) return null;
  return (
    <>
      <button type="button" className="feeling-link" onClick={() => setOpen(true)}>
        <HeartPulse size={20} />
        <span>
          <strong>Not feeling 100%?</strong>
          <small>Ill, run down or short on time? Talk through the next few days.</small>
        </span>
      </button>
      {open ? (
        <CheckInSheet planId={plan.id} workouts={workouts} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
function CheckInSheet({
  planId,
  workouts,
  onClose,
}: {
  planId: string;
  workouts: WorkoutSummary[];
  onClose: () => void;
}) {
  const today = useLocalToday(),
    navigate = useNavigate(),
    client = useQueryClient(),
    key = useRequestKey();
  const [kind, setKind] = useState<CheckInInput['kind']>('run_down'),
    [duration, setDuration] = useState('7'),
    [details, setDetails] = useState<CheckInInput['details']>({
      preference: 'coach',
      returnStyle: 'balanced',
    });
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const input: CheckInInput = {
        planId,
        kind,
        startsOn: today,
        endsOn: duration === 'unsure' ? null : addDays(today, Number(duration) - 1),
        details,
      };
      const response = result(
        await api.POST('/api/v1/check-ins', {
          params: { header: { 'idempotency-key': key(input) } },
          body: input,
        }),
      );
      key.settle(input);
      return response;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['training-log'] }),
  });
  const discuss = useDiscussFeedback(planId),
    busy = create.isPending || discuss.isPending;
  const amend = <K extends keyof typeof details>(name: K, value: (typeof details)[K]) => {
    setSaved(null);
    setDetails((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  };
  const affected = workouts.filter(
    (w) =>
      w.priority === 'high' &&
      w.scheduledDate >= today &&
      (duration === 'unsure' || w.scheduledDate <= addDays(today, Number(duration) - 1)),
  );
  const safety =
    details.symptoms === 'fever' ||
    details.symptoms === 'below_neck' ||
    details.symptoms === 'chest_pain' ||
    (kind === 'pain' && details.painSeverity && details.painSeverity !== 'mild');
  const send = async () => {
    try {
      const check = saved ?? (await create.mutateAsync());
      setSaved(check);
      const id = await discuss.mutateAsync({
        content: `I’m not feeling 100%: ${kind.replaceAll('_', ' ')}. Please help me adjust upcoming training.${details.note ? ` ${details.note}` : ''}`,
        reference: { type: 'check_in', checkInId: check.id },
      });
      onClose();
      void navigate(`/chat/${id}`);
    } catch {
      /* Mutation error is shown below; the saved check-in can be retried. */
    }
  };
  return (
    <Dialog
      open
      size="md"
      className="training-feedback"
      title="Not feeling 100%"
      description="Tell your coach what’s going on. Your plan stays unchanged until you review an amendment."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            icon={MessageSquare}
            disabled={busy}
            busy={busy}
            onClick={() => void send()}
          >
            Ask my coach to adjust
          </Button>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="feedback-form" onChange={() => setSaved(null)}>
        {create.error || discuss.error ? (
          <Notice tone="danger" role="alert">
            {saved ? 'Your check-in is saved. ' : ''}
            {create.error?.message ?? discuss.error?.message}
          </Notice>
        ) : null}
        <section className="fb-section">
          <h3>What’s going on?</h3>
          <Options
            label="Check-in reason"
            value={kind}
            values={[
              ['ill', 'Feeling ill'],
              ['pain', 'Pain or injury'],
              ['run_down', 'Run down'],
              ['busy', 'Busy or travelling'],
            ]}
            onChange={(v) => {
              if (v) {
                setKind(v);
                setDetails((p) => ({
                  preference: p.preference,
                  returnStyle: p.returnStyle,
                  ...(p.note ? { note: p.note } : {}),
                }));
                setSaved(null);
              }
            }}
          />
        </section>
        {kind === 'ill' ? (
          <section className="fb-section">
            <h3>How are you feeling?</h3>
            <Options
              label="Illness symptoms"
              value={details.symptoms}
              values={[
                ['above_neck', 'Above the neck'],
                ['below_neck', 'Chest or below the neck'],
                ['fever', 'Fever'],
                ['chest_pain', 'Chest pain'],
              ]}
              onChange={(v) => amend('symptoms', v)}
            />
          </section>
        ) : null}
        {kind === 'pain' ? (
          <section className="fb-section">
            <h3>Where is the pain?</h3>
            <Options
              label="Pain area"
              value={details.painArea}
              values={[
                ['foot', 'Foot'],
                ['ankle', 'Ankle'],
                ['calf', 'Calf'],
                ['knee', 'Knee'],
                ['hip', 'Hip'],
                ['back', 'Back'],
                ['shoulder', 'Shoulder'],
                ['other', 'Other'],
              ]}
              onChange={(v) => amend('painArea', v)}
            />
            <h3>How bad?</h3>
            <Options
              label="Pain severity"
              value={details.painSeverity}
              values={[
                ['mild', 'Mild · moved normally'],
                ['changed_movement', 'Changed how I moved'],
                ['stopped', 'Had to stop'],
              ]}
              onChange={(v) => amend('painSeverity', v)}
            />
          </section>
        ) : null}
        {safety ? (
          <Notice tone="warning">
            Rest and seek professional advice for fever, chest symptoms or pain that changes
            movement. For chest pain or severe symptoms, seek urgent medical help.
          </Notice>
        ) : null}
        <section className="fb-section">
          <h3>For how long?</h3>
          <Options
            label="Check-in duration"
            value={duration}
            values={[
              ['3', '3 days'],
              ['7', '1 week'],
              ['14', '2 weeks'],
              ['unsure', 'Not sure'],
            ]}
            onChange={(v) => {
              if (v) {
                setDuration(v);
                setSaved(null);
              }
            }}
          />
        </section>
        <section className="fb-section">
          <h3>What would help?</h3>
          <Options
            label="Training preference"
            value={details.preference}
            values={[
              ['easy', 'Easy sessions only'],
              ['shorter', 'Shorter sessions'],
              ['rest', 'Rest completely'],
              ['coach', 'Let my coach decide'],
            ]}
            onChange={(v) => {
              if (v) amend('preference', v);
            }}
          />
        </section>
        <section className="fb-section">
          <h3>Getting back to it</h3>
          <Options
            label="Return style"
            value={details.returnStyle}
            values={[
              ['gently', 'Gently'],
              ['balanced', 'Balanced'],
              ['quickly', 'Quickly'],
            ]}
            onChange={(v) => {
              if (v) amend('returnStyle', v);
            }}
          />
        </section>
        {affected.length ? (
          <section className="fb-section">
            <h3>Key sessions in this window</h3>
            <ul>
              {affected.map((w) => (
                <li key={w.id}>
                  {formatLong(w.scheduledDate)} · {w.title}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <label className="field">
          <span>Anything else? (optional)</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={details.note ?? ''}
            onChange={(e) => amend('note', e.target.value || undefined)}
          />
        </label>
      </fieldset>
    </Dialog>
  );
}
