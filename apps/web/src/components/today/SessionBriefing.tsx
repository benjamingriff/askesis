import type { WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { ArrowRight, ChevronRight, MessageSquare, Repeat, TrendingUp } from 'lucide-react';
import type { CSSProperties } from 'react';
import { formatDuration, formatSwimDistance } from '../../lib/format';
import { sessionLoad } from '../../lib/load';
import { firstMark, firstMarkLabel } from '../../lib/today';
import { RACE_META, stepEffort, workoutLook } from '../../lib/workouts';
import { useWorkoutDetail, type PlanVersion } from '../../plan-data';
import { useSportUnits, type Units } from '../../settings';
import { effortColor } from '../../theme/palette';
import { IntensityChart } from '../IntensityChart';
import { Stat } from '../PlanWidgets';
import { KindIcon, cx } from '../ui';
import {
  formatCompletion,
  formatTarget,
  workoutMeta,
  workoutStats,
  type Display,
} from '../Workout';

const ROLE_NAMES: Record<string, string> = {
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  recovery: 'Recover',
};

/**
 * Today's session as a briefing: the cover and headline numbers, then the session's shape step by
 * step with each target already resolved to the athlete's paces or power, so the gist needs no tap.
 */
export function SessionBriefing({
  workout,
  workouts,
  version,
  units,
  onOpen,
  onAskCoach,
}: {
  workout: WorkoutSummary;
  /** The plan's sessions, to recognise a session that reaches a new length. */
  workouts: WorkoutSummary[];
  version: PlanVersion | null;
  units: Units;
  onOpen: (workout: WorkoutSummary) => void;
  onAskCoach?: ((workout: WorkoutSummary) => void) | undefined;
}) {
  const look = workoutLook(workout);
  const detail = useWorkoutDetail(workout.id, version);
  const sportUnits = useSportUnits();
  const display = { units, ...sportUnits };
  const mark = firstMark(workout, workouts);
  return (
    <article
      className="briefing"
      style={{ '--kind': look.color } as CSSProperties}
      aria-label={workout.title}
    >
      <button
        type="button"
        className="briefing-cover"
        aria-label={`${workout.title}, ${look.label}`}
        onClick={() => onOpen(workout)}
      >
        <span className="briefing-badges">
          <span className="hero-kind">
            <look.icon size={15} aria-hidden="true" /> {look.label}
          </span>
          {workout.racePriority ? (
            <span className="briefing-badge">{RACE_META[workout.racePriority].label}</span>
          ) : workout.priority === 'high' ? (
            <span className="briefing-badge">Key session</span>
          ) : null}
          {mark ? (
            <span className="briefing-badge">
              <TrendingUp size={13} aria-hidden="true" />{' '}
              {firstMarkLabel(workout, mark, (metres) =>
                formatSwimDistance(metres, sportUnits.pool),
              )}
            </span>
          ) : null}
        </span>
        {detail.data ? (
          <IntensityChart prescription={detail.data.prescription} height={64} />
        ) : (
          <span className="briefing-chart-placeholder" aria-hidden="true" />
        )}
      </button>
      <div className="briefing-body">
        <h2 className="hero-title">{workout.title}</h2>
        {workout.purpose ? <p className="hero-purpose">{workout.purpose}</p> : null}
        <div className="hero-stats">
          {workoutStats(workout, units, sportUnits.pool).map((stat) => (
            <Stat key={stat.label} label={stat.label} value={stat.value} unit={stat.unit} large />
          ))}
          <Stat label="Load" value={String(Math.round(sessionLoad(workout)))} large />
        </div>
        {detail.data ? (
          <SessionStructure prescription={detail.data.prescription} display={display} />
        ) : detail.isPending ? (
          <p className="muted briefing-loading">Loading the session…</p>
        ) : null}
        <div className="briefing-actions">
          <button type="button" className="hero-cta" onClick={() => onOpen(workout)}>
            Full workout <ArrowRight size={16} aria-hidden="true" />
          </button>
          {onAskCoach ? (
            <button type="button" className="briefing-ask" onClick={() => onAskCoach(workout)}>
              <MessageSquare size={15} aria-hidden="true" /> Ask coach
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** The session's top-level steps, with repeats and circuits folded under one heading. */
export function SessionStructure({
  prescription,
  display,
}: {
  prescription: WorkoutStep;
  display: Display;
}) {
  const steps = prescription.kind === 'sequence' ? prescription.steps : [prescription];
  return (
    <ol className="session-structure" aria-label="Session structure">
      {steps.map((step) =>
        step.kind === 'effort' ? (
          <StructureStep key={step.id} step={step} display={display} />
        ) : (
          <li key={step.id} className="structure-set">
            <span className="structure-set-heading">
              {step.kind === 'repeat' ? (
                <>
                  <Repeat size={13} aria-hidden="true" />
                  <strong>{step.repeatCount}×</strong>
                </>
              ) : null}
              <span>{step.label ?? 'Set'}</span>
            </span>
            <ol>
              {flatten(step).map((child) => (
                <StructureStep key={child.id} step={child} display={display} nested />
              ))}
            </ol>
          </li>
        ),
      )}
    </ol>
  );
}

/** Steps inside a set, with deeper nesting flattened: the briefing is a summary, not the plan. */
function flatten(step: WorkoutStep): WorkoutStep[] {
  return step.steps.flatMap((child) => (child.kind === 'effort' ? [child] : flatten(child)));
}

function StructureStep({
  step,
  display,
  nested,
}: {
  step: WorkoutStep;
  display: Display;
  nested?: boolean;
}) {
  const { effort } = stepEffort(step);
  const amount = step.completion?.type === 'open' ? null : formatCompletion(step, display);
  const targets = step.targets.filter((target) => target.type !== 'instruction').slice(0, 2);
  const note = targets.length
    ? null
    : (step.targets.find((target) => target.type === 'instruction')?.text ?? null);
  const role = step.role ? ROLE_NAMES[step.role] : undefined;
  const name = step.label ?? step.movement?.name ?? role ?? 'Effort';
  return (
    <li
      className={cx('structure-step', nested && 'nested', step.role === 'recovery' && 'restful')}
      style={{ '--zone': effortColor(effort) } as CSSProperties}
    >
      <i aria-hidden="true" />
      <span className="structure-copy">
        <span className="structure-name">
          {role && role !== name && !nested ? <small>{role}</small> : null}
          {name}
        </span>
        {targets.length ? (
          <span className="structure-target">
            {targets.map((target) => formatTarget(target, display, step.discipline)).join(' · ')}
          </span>
        ) : note ? (
          <span className="structure-note">{note}</span>
        ) : null}
      </span>
      {amount ? <strong className="structure-amount">{amount}</strong> : null}
    </li>
  );
}

/** A smaller session card: kind, title, numbers and effort profile. Opens the full workout. */
export function SessionTile({
  workout,
  version,
  units,
  onOpen,
  label,
}: {
  workout: WorkoutSummary;
  version: PlanVersion | null;
  units: Units;
  onOpen: (workout: WorkoutSummary) => void;
  label?: string | undefined;
}) {
  const look = workoutLook(workout);
  const detail = useWorkoutDetail(workout.id, version);
  const { pool } = useSportUnits();
  return (
    <button
      type="button"
      className="session-tile"
      style={{ '--kind': look.color } as CSSProperties}
      onClick={() => onOpen(workout)}
    >
      <span className="session-tile-head">
        <KindIcon icon={look.icon} color={look.color} size={38} />
        <span className="session-tile-copy">
          <span className="label">{label ?? look.label}</span>
          <strong>{workout.title}</strong>
          <small>
            {workoutMeta(workout, units, pool)} · load {Math.round(sessionLoad(workout))}
          </small>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="chevron" />
      </span>
      {detail.data ? (
        <IntensityChart prescription={detail.data.prescription} height={40} />
      ) : (
        <span className="briefing-chart-placeholder small" aria-hidden="true" />
      )}
    </button>
  );
}

/** "2 sessions · 1h 19m" for a day with several. */
export function dayTotal(workouts: WorkoutSummary[]) {
  const seconds = workouts.reduce((sum, w) => sum + (w.estimatedDurationSeconds ?? 0), 0);
  return `${workouts.length} sessions${seconds ? ` · ${formatDuration(seconds)}` : ''}`;
}
