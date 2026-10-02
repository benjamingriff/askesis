import type { StepTarget, WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { CalendarOff, ChevronRight, MessageSquare, Moon, Repeat } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  dayNumber,
  formatDistance,
  formatDuration,
  formatLong,
  formatPace,
  WEEKDAYS_SHORT,
  weekdayIndex,
} from '../lib/format';
import { inferKind, KIND_META } from '../lib/workouts';
import { useWorkoutDetail, type PlanVersion } from '../plan-data';
import type { Units } from '../settings';
import { IntensityChart } from './IntensityChart';
import { Stat } from './PlanWidgets';
import { Button, Dialog, ErrorState, KindIcon, LoadingState, cx } from './ui';

export function workoutMeta(workout: WorkoutSummary, units: Units): string {
  const parts = [];
  if (workout.estimatedDistanceMetres !== null)
    parts.push(formatDistance(workout.estimatedDistanceMetres, units));
  if (workout.estimatedDurationSeconds !== null)
    parts.push(formatDuration(workout.estimatedDurationSeconds));
  return parts.join(' · ') || workout.discipline;
}

/** One day of the plan: date gutter on the left, workout cards (or rest) on the right. */
export function DayRow({
  date,
  today,
  workouts,
  units,
  onOpen,
  showDate = true,
  status = 'planned',
}: {
  date: string;
  today: string;
  /** Empty planned days are rest; unplanned or out-of-plan days are not. */
  status?: 'planned' | 'unplanned' | 'outside' | undefined;
  workouts: WorkoutSummary[];
  units: Units;
  onOpen: (workout: WorkoutSummary) => void;
  showDate?: boolean | undefined;
}) {
  const isToday = date === today;
  const past = date < today;
  return (
    <li className={cx('day-row', isToday && 'today', past && 'past')} id={`day-${date}`}>
      {showDate ? (
        <time className="day-gutter" dateTime={date}>
          <span>{WEEKDAYS_SHORT[weekdayIndex(date)]}</span>
          <strong>{dayNumber(date)}</strong>
        </time>
      ) : null}
      <div className="day-items">
        {workouts.length === 0 && status !== 'planned' ? (
          <div className="rest-card unplanned">
            <CalendarOff size={16} aria-hidden="true" />{' '}
            {status === 'outside' ? 'Outside plan dates' : 'Not planned yet'}
          </div>
        ) : workouts.length === 0 ? (
          <div className="rest-card">
            <Moon size={16} aria-hidden="true" /> Rest day
          </div>
        ) : (
          workouts.map((workout) => (
            <WorkoutCard key={workout.id} workout={workout} units={units} onOpen={onOpen} />
          ))
        )}
      </div>
    </li>
  );
}

export function WorkoutCard({
  workout,
  units,
  onOpen,
}: {
  workout: WorkoutSummary;
  units: Units;
  onOpen: (workout: WorkoutSummary) => void;
}) {
  const kind = KIND_META[inferKind(workout)];
  return (
    <button
      type="button"
      className="workout-card"
      style={{ '--kind': kind.color } as CSSProperties}
      onClick={() => onOpen(workout)}
      aria-label={`${workout.title}, ${kind.label}, ${formatLong(workout.scheduledDate)}`}
    >
      <KindIcon icon={kind.icon} color={kind.color} />
      <span className="workout-card-copy">
        <span className="workout-card-kind">
          {kind.label}
          {workout.priority === 'high' ? <em>Key session</em> : null}
        </span>
        <strong>{workout.title}</strong>
        <small>{workoutMeta(workout, units)}</small>
      </span>
      <ChevronRight size={18} aria-hidden="true" className="chevron" />
    </button>
  );
}

// ---- Prescription ------------------------------------------------------------------------------

function formatValue(value: number | null, unit: string | null, units: Units): string | null {
  if (value === null) return null;
  if (unit === 'seconds') return value % 60 === 0 ? `${value / 60} min` : `${value}s`;
  if (unit === 'minutes') return `${value} min`;
  if (unit === 'metres') return value >= 1000 ? formatDistance(value, units) : `${value} m`;
  if (unit === 'kilometres') return formatDistance(value * 1000, units);
  if (unit === 'miles') return formatDistance(value * 1609.344, units);
  if (unit === 'repetitions') return `${value} reps`;
  if (unit === 'seconds_per_kilometre') return formatPace(value, units);
  if (unit === 'seconds_per_mile') return formatPace(value / 1.609344, units);
  return unit === null ? String(value) : `${value} ${unit.replaceAll('_', ' ')}`;
}

function formatCompletion(step: WorkoutStep, units: Units): string | null {
  const completion = step.completion;
  if (completion === null) return null;
  if (completion.value !== null) return formatValue(completion.value, completion.unit, units);
  if (completion.type === 'until_condition')
    return `until ${completion.conditionType?.replaceAll('_', ' ') ?? 'complete'}`;
  return completion.type.replaceAll('_', ' ');
}

function formatTarget(target: StepTarget, units: Units): string {
  if (target.type === 'zone' && target.zoneKey !== null) {
    const zone = target.resolvedZone;
    const name = target.zoneKey.charAt(0).toUpperCase() + target.zoneKey.slice(1);
    if (zone && zone.minimumValue !== null && zone.maximumValue !== null) {
      return `${name} · ${formatValue(zone.minimumValue, zone.unit, units)}–${formatValue(zone.maximumValue, zone.unit, units)}`;
    }
    return name;
  }
  if (target.text !== null) return target.text;
  const minimum = formatValue(target.minimumValue, target.unit, units);
  const preferred = formatValue(target.targetValue, target.unit, units);
  const maximum = formatValue(target.maximumValue, target.unit, units);
  const range =
    minimum !== null && maximum !== null
      ? minimum === maximum
        ? minimum
        : `${minimum}–${maximum}`
      : (preferred ?? minimum ?? maximum);
  return `${target.type.replaceAll('_', ' ')}${range === null ? '' : ` ${range}`}`;
}

export function StepList({ step, units }: { step: WorkoutStep; units: Units }) {
  if (step.kind === 'sequence')
    return (
      <ol className="step-list">
        {step.steps.map((child) => (
          <StepItem step={child} units={units} key={child.id} />
        ))}
      </ol>
    );
  return (
    <ol className="step-list">
      <StepItem step={step} units={units} />
    </ol>
  );
}

function StepItem({ step, units }: { step: WorkoutStep; units: Units }) {
  if (step.kind === 'sequence')
    return (
      <>
        {step.steps.map((child) => (
          <StepItem step={child} units={units} key={child.id} />
        ))}
      </>
    );
  if (step.kind === 'repeat')
    return (
      <li className="step-repeat">
        <div className="repeat-heading">
          <Repeat size={14} aria-hidden="true" />
          <strong>{step.repeatCount}×</strong>
          {step.label ? <span>{step.label}</span> : null}
        </div>
        <ol>
          {step.steps.map((child) => (
            <StepItem step={child} units={units} key={child.id} />
          ))}
        </ol>
      </li>
    );
  const completion = formatCompletion(step, units);
  const zone = step.targets.find((t) => t.type === 'zone')?.zoneKey ?? null;
  return (
    <li className={cx('step', `step-${step.role ?? 'other'}`)} data-zone={zone ?? undefined}>
      <span className="step-marker" aria-hidden="true" />
      <div className="step-copy">
        <span className="label">{step.role ?? 'step'}</span>
        <strong>{step.label ?? step.movement?.name ?? 'Effort'}</strong>
        {step.instructions ? <p>{step.instructions}</p> : null}
        {step.targets.length ? (
          <div className="target-list">
            {step.targets.map((target, index) => (
              <span className="target" key={`${target.type}-${index}`}>
                {formatTarget(target, units)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {completion ? <strong className="step-completion">{completion}</strong> : null}
    </li>
  );
}

/** Workout detail: kind header, key numbers, effort profile and the full prescription. */
export function WorkoutDialog({
  workout,
  version,
  units,
  onClose,
  onAskCoach,
}: {
  workout: WorkoutSummary | null;
  version?: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined;
  units: Units;
  onClose: () => void;
  onAskCoach?: ((workout: WorkoutSummary) => void) | undefined;
}) {
  const detail = useWorkoutDetail(workout?.id, version);
  if (!workout) return null;
  const kind = KIND_META[inferKind(workout)];
  const { estimatedDistanceMetres: metres, estimatedDurationSeconds: seconds } = workout;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      className="workout-dialog"
      style={{ '--kind': kind.color } as CSSProperties}
      title={
        <span className="workout-title">
          <span className="workout-kind-label">
            <kind.icon size={15} aria-hidden="true" /> {kind.label}
          </span>
          {workout.title}
        </span>
      }
      description={formatLong(workout.scheduledDate)}
      footer={
        onAskCoach ? (
          <Button icon={MessageSquare} onClick={() => onAskCoach(workout)}>
            Ask your coach about this
          </Button>
        ) : undefined
      }
    >
      <div className="workout-detail">
        <div className="workout-stats">
          {metres !== null ? (
            <Stat
              label="Distance"
              value={formatDistance(metres, units, false)}
              unit={units}
              large
            />
          ) : null}
          {seconds !== null ? <Stat label="Time" value={formatDuration(seconds)} large /> : null}
          {metres && seconds ? (
            <Stat
              label="Avg pace"
              value={formatPace((seconds / metres) * 1000, units, false)}
              unit={`/${units}`}
              large
            />
          ) : null}
        </div>
        {workout.purpose ? <p className="workout-purpose">{workout.purpose}</p> : null}
        {workout.description ? <p className="muted">{workout.description}</p> : null}
        {detail.isPending ? <LoadingState>Loading prescription…</LoadingState> : null}
        {detail.error ? (
          <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
        ) : null}
        {detail.data ? (
          <>
            <div className="effort-profile">
              <span className="label">Effort profile</span>
              <IntensityChart prescription={detail.data.prescription} height={64} />
            </div>
            {detail.data.tags.length ? (
              <div className="tag-list">
                {detail.data.tags.map((tag) => (
                  <span key={tag}>{tag.replaceAll('-', ' ')}</span>
                ))}
              </div>
            ) : null}
            <h3 className="steps-heading">Prescription</h3>
            <StepList step={detail.data.prescription} units={units} />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
