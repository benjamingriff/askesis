import type { StepTarget, WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { CalendarOff, ChevronRight, MessageSquare, Moon, Repeat } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  dayNumber,
  formatDistance,
  formatDuration,
  formatLoad,
  formatLong,
  formatPace,
  formatSpeed,
  formatSwimDistance,
  formatSwimPace,
  WEEKDAYS_SHORT,
  weekdayIndex,
  type LoadUnits,
  type PoolUnits,
} from '../lib/format';
import { formatZoneValue, SPORT_META, zoneLabel, type Sport } from '../lib/sports';
import { RACE_META, stepEffort, workoutLook } from '../lib/workouts';
import { effortColor } from '../theme/palette';
import { useWorkoutDetail, type PlanVersion } from '../plan-data';
import { useSportUnits, type Units } from '../settings';
import { WorkoutChangeBadge } from './PlanChanges';
import { IntensityChart } from './IntensityChart';
import { Stat } from './PlanWidgets';
import { Button, Dialog, ErrorState, KindIcon, LoadingState, cx } from './ui';

export function workoutMeta(workout: WorkoutSummary, units: Units, pool: PoolUnits = 'm'): string {
  const parts = [];
  if (workout.estimatedDistanceMetres !== null)
    parts.push(
      workout.discipline === 'swim'
        ? formatSwimDistance(workout.estimatedDistanceMetres, pool)
        : formatDistance(workout.estimatedDistanceMetres, units),
    );
  if (workout.estimatedDurationSeconds !== null)
    parts.push(formatDuration(workout.estimatedDurationSeconds));
  return parts.join(' · ') || SPORT_META[workout.discipline as Sport]?.label || workout.discipline;
}

/** Headline numbers for a workout, in the units its sport is usually described in. */
export function workoutStats(workout: WorkoutSummary, units: Units, pool: PoolUnits) {
  const { estimatedDistanceMetres: metres, estimatedDurationSeconds: seconds } = workout;
  const stats: { label: string; value: string; unit?: string }[] = [];
  if (metres !== null)
    stats.push(
      workout.discipline === 'swim'
        ? { label: 'Distance', value: formatSwimDistance(metres, pool) }
        : { label: 'Distance', value: formatDistance(metres, units, false), unit: units },
    );
  if (seconds !== null) stats.push({ label: 'Time', value: formatDuration(seconds) });
  if (metres && seconds) {
    if (workout.discipline === 'run')
      stats.push({
        label: 'Avg pace',
        value: formatPace((seconds / metres) * 1000, units, false),
        unit: `/${units}`,
      });
    if (workout.discipline === 'swim')
      stats.push({
        label: 'Avg pace',
        value: formatSwimPace((seconds / metres) * 100, pool, false),
        unit: `/100${pool}`,
      });
    if (workout.discipline === 'cycle')
      stats.push({ label: 'Avg speed', value: formatSpeed(metres / seconds, units) });
  }
  return stats;
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
  const look = workoutLook(workout);
  const { pool } = useSportUnits();
  return (
    <button
      type="button"
      className="workout-card"
      style={{ '--kind': look.color } as CSSProperties}
      onClick={() => onOpen(workout)}
      aria-label={`${workout.title}, ${look.label}, ${formatLong(workout.scheduledDate)}`}
    >
      <KindIcon icon={look.icon} color={look.color} />
      <span className="workout-card-copy">
        <span className="workout-card-kind">
          {look.label}
          {workout.racePriority ? (
            <em className="race-badge" title={RACE_META[workout.racePriority].description}>
              {RACE_META[workout.racePriority].label}
            </em>
          ) : workout.priority === 'high' ? (
            <em>Key session</em>
          ) : null}
          <WorkoutChangeBadge id={workout.id} />
        </span>
        <strong>{workout.title}</strong>
        <small>{workoutMeta(workout, units, pool)}</small>
      </span>
      <ChevronRight size={18} aria-hidden="true" className="chevron" />
    </button>
  );
}

// ---- Prescription ------------------------------------------------------------------------------

type Display = { units: Units; pool: PoolUnits; load: LoadUnits };

function formatValue(
  value: number | null,
  unit: string | null,
  display: Display,
  discipline: string | null,
): string | null {
  if (value === null) return null;
  const { units } = display;
  if (unit === 'seconds') return value % 60 === 0 ? `${value / 60} min` : `${value}s`;
  if (unit === 'minutes') return `${value} min`;
  if (unit === 'metres' && discipline === 'swim') return formatSwimDistance(value, display.pool);
  if (unit === 'metres') return value >= 1000 ? formatDistance(value, units) : `${value} m`;
  if (unit === 'kilometres') return formatDistance(value * 1000, units);
  if (unit === 'miles') return formatDistance(value * 1609.344, units);
  if (unit === 'repetitions') return `${value} reps`;
  if (unit === 'kilograms') return formatLoad(value, display.load);
  if (unit === 'pounds') return formatLoad(value / 2.20462, display.load);
  if (unit === null) return String(value);
  return formatZoneValue(value, unit, display);
}

function formatCompletion(step: WorkoutStep, display: Display): string | null {
  const completion = step.completion;
  if (completion === null) return null;
  if (completion.value !== null)
    return formatValue(completion.value, completion.unit, display, step.discipline);
  if (completion.type === 'until_condition')
    return `until ${completion.conditionType?.replaceAll('_', ' ') ?? 'complete'}`;
  return completion.type.replaceAll('_', ' ');
}

/** "137 W" and "184 W" → "137–184 W"; "4:23/km" and "4:57/km" → "4:23–4:57/km". */
export function compactRange(low: string, high: string): string {
  const unit = /[ /][^ /]*$/.exec(high)?.[0];
  return unit && low.endsWith(unit) ? `${low.slice(0, -unit.length)}–${high}` : `${low}–${high}`;
}

function formatTarget(target: StepTarget, display: Display, discipline: string | null): string {
  if (target.type === 'zone' && target.zoneKey !== null) {
    const zone = target.resolvedZone;
    const name = zoneLabel(target.zoneKey, target.zoneSystem);
    if (zone && zone.minimumValue !== null && zone.maximumValue !== null) {
      const low = formatValue(zone.minimumValue, zone.unit, display, discipline)!;
      const high = formatValue(zone.maximumValue, zone.unit, display, discipline)!;
      return `${name} · ${compactRange(low, high)}`;
    }
    return name;
  }
  if (target.text !== null) return target.text;
  if (target.type === 'rpe' && target.targetValue !== null) return `RPE ${target.targetValue}`;
  if (target.type === 'rir' && target.targetValue !== null)
    return `${target.targetValue} rep${target.targetValue === 1 ? '' : 's'} in reserve`;
  if (target.type === 'load' && target.targetValue !== null)
    return `~${formatValue(target.targetValue, target.unit, display, discipline)}`;
  const minimum = formatValue(target.minimumValue, target.unit, display, discipline);
  const preferred = formatValue(target.targetValue, target.unit, display, discipline);
  const maximum = formatValue(target.maximumValue, target.unit, display, discipline);
  const range =
    minimum !== null && maximum !== null
      ? minimum === maximum
        ? minimum
        : `${minimum}–${maximum}`
      : (preferred ?? minimum ?? maximum);
  return `${target.type.replaceAll('_', ' ')}${range === null ? '' : ` ${range}`}`;
}

export function StepList({
  step,
  units,
  mixed = false,
}: {
  step: WorkoutStep;
  units: Units;
  /** Label each effort's sport, as in a brick or a Hyrox session. */
  mixed?: boolean | undefined;
}) {
  const display = { units, ...useSportUnits() };
  const children = step.kind === 'sequence' ? step.steps : [step];
  return (
    <ol className="step-list">
      {children.map((child) => (
        <StepItem step={child} display={display} mixed={mixed} key={child.id} />
      ))}
    </ol>
  );
}

function StepItem({
  step,
  display,
  mixed,
}: {
  step: WorkoutStep;
  display: Display;
  mixed: boolean;
}) {
  if (step.kind === 'sequence')
    return (
      <>
        {step.steps.map((child) => (
          <StepItem step={child} display={display} mixed={mixed} key={child.id} />
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
            <StepItem step={child} display={display} mixed={mixed} key={child.id} />
          ))}
        </ol>
      </li>
    );
  const completion = formatCompletion(step, display);
  const zone = step.targets.find((t) => t.type === 'zone')?.zoneKey ?? null;
  const sport = step.discipline ? SPORT_META[step.discipline as Sport] : undefined;
  const { effort } = stepEffort(step);
  return (
    <li
      className={cx('step', `step-${step.role ?? 'other'}`)}
      data-zone={zone ?? undefined}
      data-effort={effort}
      data-sport={step.discipline ?? undefined}
      style={{ '--zone': effortColor(effort) } as CSSProperties}
    >
      <span className="step-marker" aria-hidden="true" />
      <div className="step-copy">
        <span className="label">
          {mixed && sport ? (
            <>
              <span className="step-sport">
                <sport.icon size={12} aria-hidden="true" /> {sport.label}
              </span>
              {step.role ? ' · ' : ''}
            </>
          ) : null}
          {step.role ?? (mixed && sport ? '' : 'step')}
        </span>
        <strong>{step.label ?? step.movement?.name ?? 'Effort'}</strong>
        {step.instructions ? <p>{step.instructions}</p> : null}
        {step.targets.length ? (
          <div className="target-list">
            {step.targets.map((target, index) => (
              <span className="target" key={`${target.type}-${index}`}>
                {formatTarget(target, display, step.discipline)}
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
  const { pool } = useSportUnits();
  if (!workout) return null;
  const look = workoutLook(workout);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      className="workout-dialog"
      style={{ '--kind': look.color } as CSSProperties}
      title={
        <span className="workout-title">
          <span className="workout-kind-label">
            <look.icon size={15} aria-hidden="true" /> {look.label}
            {workout.racePriority ? ` · ${RACE_META[workout.racePriority].label}` : ''}
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
          {workoutStats(workout, units, pool).map((stat) => (
            <Stat key={stat.label} label={stat.label} value={stat.value} unit={stat.unit} large />
          ))}
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
            <StepList
              step={detail.data.prescription}
              units={units}
              mixed={workout.discipline === 'mixed'}
            />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
