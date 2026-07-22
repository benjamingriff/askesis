import type { StepTarget, WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import { useState } from 'react';
import { type LoaderFunctionArgs, useFetcher, useLoaderData } from 'react-router';
import { api } from '../api';

export async function workoutsLoader() {
  const { data, error } = await api.GET('/api/v1/workouts');

  if (error !== undefined || data === undefined) {
    throw new Response('The workout list could not be loaded.', { status: 500 });
  }

  return data;
}

export async function workoutDetailLoader({ params }: LoaderFunctionArgs) {
  if (params.workoutId === undefined) {
    throw new Response('Workout ID is required.', { status: 400 });
  }

  const { data, error, response } = await api.GET('/api/v1/workouts/{workoutId}', {
    params: { path: { workoutId: params.workoutId } },
  });

  if (error !== undefined || data === undefined) {
    throw new Response(error?.error ?? 'The workout could not be loaded.', {
      status: response.status,
    });
  }

  return data;
}

function formatDate(date: string): { day: string; date: string } {
  const value = new Date(`${date}T00:00:00Z`);
  return {
    day: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(value),
    date: new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    }).format(value),
  };
}

function formatDistance(metres: number | null): string {
  return metres === null ? '—' : `${(metres / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null): string {
  return seconds === null ? '—' : `${Math.round(seconds / 60)} min`;
}

function formatSecondsPerKilometre(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function formatValue(value: number | null, unit: string | null): string | null {
  if (value === null) return null;
  if (unit === 'seconds') return value % 60 === 0 ? `${value / 60} min` : `${value}s`;
  if (unit === 'metres') return value >= 1000 ? `${value / 1000} km` : `${value}m`;
  if (unit === 'repetitions') return `${value} reps`;
  if (unit === 'seconds_per_kilometre') return `${formatSecondsPerKilometre(value)}/km`;
  return unit === null ? String(value) : `${value} ${unit.replaceAll('_', ' ')}`;
}

function formatCompletion(step: WorkoutStep): string | null {
  const completion = step.completion;
  if (completion === null) return null;
  if (completion.value !== null) return formatValue(completion.value, completion.unit);
  if (completion.type === 'until_condition') {
    return `until ${completion.conditionType?.replaceAll('_', ' ') ?? 'complete'}`;
  }
  return completion.type.replaceAll('_', ' ');
}

function formatTarget(target: StepTarget): string {
  if (target.type === 'zone' && target.zoneKey !== null) {
    const zone = target.resolvedZone;
    if (zone !== null && zone.minimumValue !== null && zone.maximumValue !== null) {
      const minimum = formatValue(zone.minimumValue, zone.unit);
      const maximum = formatValue(zone.maximumValue, zone.unit);
      const fitness = zone.fitnessValue === null ? '' : ` · ${zone.method.toUpperCase()} ${zone.fitnessValue}`;
      return `${target.zoneKey} · ${minimum}–${maximum}${fitness}`;
    }
    return target.zoneKey;
  }

  if (target.text !== null) return target.text;
  const minimum = formatValue(target.minimumValue, target.unit);
  const preferred = formatValue(target.targetValue, target.unit);
  const maximum = formatValue(target.maximumValue, target.unit);
  const range = minimum !== null && maximum !== null
    ? minimum === maximum ? minimum : `${minimum}–${maximum}`
    : preferred ?? minimum ?? maximum;
  return `${target.type.replaceAll('_', ' ')}${range === null ? '' : ` ${range}`}`;
}

function StepNode({ step, depth = 0 }: { step: WorkoutStep; depth?: number }) {
  if (step.kind === 'sequence') {
    return (
      <div className="sequence">
        {step.steps.map((child) => <StepNode step={child} depth={depth} key={child.id} />)}
      </div>
    );
  }

  if (step.kind === 'repeat') {
    return (
      <section className="repeat-block" style={{ '--depth': depth } as React.CSSProperties}>
        <div className="repeat-heading">
          <span>Repeat</span>
          <strong>{step.repeatCount}×</strong>
          {step.label !== null && <span>{step.label}</span>}
        </div>
        <div className="repeat-steps">
          {step.steps.map((child) => <StepNode step={child} depth={depth + 1} key={child.id} />)}
        </div>
      </section>
    );
  }

  const completion = formatCompletion(step);
  return (
    <article className={`effort effort-${step.role ?? 'other'}`}>
      <div className="effort-marker" aria-hidden="true" />
      <div className="effort-copy">
        <div className="effort-meta">
          {step.role !== null && <span>{step.role}</span>}
          {step.discipline !== null && <span>{step.discipline}</span>}
        </div>
        <h4>{step.label ?? step.movement?.name ?? 'Effort'}</h4>
        {step.instructions !== null && <p>{step.instructions}</p>}
        {step.targets.length > 0 && (
          <div className="target-list">
            {step.targets.map((target, index) => (
              <span className="target" key={`${target.type}-${index}`}>{formatTarget(target)}</span>
            ))}
          </div>
        )}
      </div>
      {completion !== null && <strong className="completion">{completion}</strong>}
    </article>
  );
}

function WorkoutBreakdown({ detail }: { detail: Awaited<ReturnType<typeof workoutDetailLoader>> }) {
  return (
    <div className="workout-breakdown">
      <div className="breakdown-intro">
        <div>
          <span className="breakdown-label">Prescription</span>
          <p>{detail.workout.purpose}</p>
        </div>
        {detail.tags.length > 0 && (
          <div className="tag-list">{detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        )}
      </div>
      <StepNode step={detail.prescription} />
    </div>
  );
}

function WorkoutRow({ workout }: { workout: WorkoutSummary }) {
  const scheduled = formatDate(workout.scheduledDate);
  const [expanded, setExpanded] = useState(false);
  const detailFetcher = useFetcher<typeof workoutDetailLoader>();
  const breakdownId = `workout-${workout.id}-breakdown`;

  function toggleBreakdown() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && detailFetcher.data === undefined && detailFetcher.state === 'idle') {
      void detailFetcher.load(`/workouts/${workout.id}/detail`);
    }
  }

  return (
    <li className={`workout-item${expanded ? ' expanded' : ''}`}>
      <div className="workout-row">
        <time dateTime={workout.scheduledDate} className="workout-date">
          <span>{scheduled.day}</span>
          <strong>{scheduled.date}</strong>
        </time>
        <div className="workout-main">
          <div className="workout-heading">
            <span className={`priority priority-${workout.priority}`}>{workout.priority}</span>
            <span>Week {workout.weekNumber}</span>
          </div>
          <h2>{workout.title}</h2>
          <p>{workout.description}</p>
        </div>
        <dl className="workout-metrics">
          <div>
            <dt>Distance</dt>
            <dd>{formatDistance(workout.estimatedDistanceMetres)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(workout.estimatedDurationSeconds)}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="expand-button"
          aria-expanded={expanded}
          aria-controls={breakdownId}
          onClick={toggleBreakdown}
        >
          <span>{expanded ? 'Close' : 'Breakdown'}</span>
          <i aria-hidden="true">{expanded ? '−' : '+'}</i>
        </button>
      </div>
      {expanded && (
        <div id={breakdownId}>
          {detailFetcher.state === 'loading' && detailFetcher.data === undefined
            ? <p className="breakdown-loading">Loading prescription…</p>
            : detailFetcher.data !== undefined && <WorkoutBreakdown detail={detailFetcher.data} />}
        </div>
      )}
    </li>
  );
}

export function WorkoutsPage() {
  const { workouts } = useLoaderData<typeof workoutsLoader>();
  const planTitle = workouts.at(0)?.planTitle ?? 'Training plan';

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Askesis · API vertical slice</p>
          <h1>{planTitle}</h1>
          <p>Select a workout to inspect its ordered efforts, repeats, recoveries, targets, and resolved training zones.</p>
        </div>
        <a href="/api/docs" className="api-link">Open API docs</a>
      </header>

      <section aria-labelledby="workouts-heading">
        <div className="section-heading">
          <h2 id="workouts-heading">Workout schedule</h2>
          <span>{workouts.length} workouts</span>
        </div>
        {workouts.length === 0
          ? <p className="empty-state">No workouts have been scheduled.</p>
          : <ol className="workout-list">{workouts.map((workout) => (
              <WorkoutRow workout={workout} key={workout.id} />
            ))}</ol>}
      </section>
    </main>
  );
}
