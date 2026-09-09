import type { StepTarget, WorkoutStep, WorkoutSummary } from '@askesis/api-client';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Footprints,
  PanelTopClose,
  PanelTopOpen,
  Route,
  Timer,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { redirect, type LoaderFunctionArgs, useFetcher } from 'react-router';
import { api } from '../api';

export async function workoutsLoader({ request }: LoaderFunctionArgs) {
  const planVersionId = new URL(request.url).searchParams.get('planVersionId');
  if (planVersionId === null) return { workouts: [] };
  const { data, error, response } = await api.GET('/api/v1/workouts', {
    params: { query: { planVersionId } },
  });

  if (response.status === 401) throw redirect('/sign-in');
  if (error !== undefined || data === undefined) {
    throw new Response('The workout list could not be loaded.', { status: response.status });
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

  if (response.status === 401) throw redirect('/sign-in');
  if (error !== undefined || data === undefined) {
    throw new Response(error?.error.message ?? 'The workout could not be loaded.', {
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
      const fitness =
        zone.fitnessValue === null ? '' : ` · ${zone.method.toUpperCase()} ${zone.fitnessValue}`;
      return `${target.zoneKey} · ${minimum}–${maximum}${fitness}`;
    }
    return target.zoneKey;
  }

  if (target.text !== null) return target.text;
  const minimum = formatValue(target.minimumValue, target.unit);
  const preferred = formatValue(target.targetValue, target.unit);
  const maximum = formatValue(target.maximumValue, target.unit);
  const range =
    minimum !== null && maximum !== null
      ? minimum === maximum
        ? minimum
        : `${minimum}–${maximum}`
      : (preferred ?? minimum ?? maximum);
  return `${target.type.replaceAll('_', ' ')}${range === null ? '' : ` ${range}`}`;
}

function StepNode({ step, depth = 0 }: { step: WorkoutStep; depth?: number }) {
  if (step.kind === 'sequence') {
    return (
      <div className="sequence">
        {step.steps.map((child) => (
          <StepNode step={child} depth={depth} key={child.id} />
        ))}
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
          {step.steps.map((child) => (
            <StepNode step={child} depth={depth + 1} key={child.id} />
          ))}
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
              <span className="target" key={`${target.type}-${index}`}>
                {formatTarget(target)}
              </span>
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
          <div className="tag-list">
            {detail.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
      </div>
      <StepNode step={detail.prescription} />
    </div>
  );
}

function WorkoutRow({ workout, selected }: { workout: WorkoutSummary; selected: boolean }) {
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
    <li
      id={`workout-${workout.scheduledDate}`}
      className={`workout-item${expanded ? ' expanded' : ''}${selected ? ' selected' : ''}`}
    >
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
            <dt>
              <Route size={14} /> Distance
            </dt>
            <dd>{formatDistance(workout.estimatedDistanceMetres)}</dd>
          </div>
          <div>
            <dt>
              <Timer size={14} /> Duration
            </dt>
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
          {detailFetcher.state === 'loading' && detailFetcher.data === undefined ? (
            <p className="breakdown-loading">Loading prescription…</p>
          ) : (
            detailFetcher.data !== undefined && <WorkoutBreakdown detail={detailFetcher.data} />
          )}
        </div>
      )}
    </li>
  );
}

function WorkoutCalendar({
  workouts,
  selectedDate,
  onSelectDate,
}: {
  workouts: WorkoutSummary[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const firstWorkout = workouts.at(0)?.scheduledDate ?? new Date().toISOString().slice(0, 10);
  const [visibleMonth, setVisibleMonth] = useState(() => firstWorkout.slice(0, 7));
  const [year, month] = visibleMonth.split('-').map(Number) as [number, number];
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(firstDay);
  gridStart.setUTCDate(1 - ((firstDay.getUTCDay() + 6) % 7));
  const workoutsByDate = useMemo(() => {
    const result = new Map<string, WorkoutSummary[]>();
    for (const workout of workouts) {
      const values = result.get(workout.scheduledDate) ?? [];
      values.push(workout);
      result.set(workout.scheduledDate, values);
    }
    return result;
  }, [workouts]);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return date;
  });
  const monthLabel = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(firstDay);

  function changeMonth(offset: number) {
    const next = new Date(Date.UTC(year, month - 1 + offset, 1));
    setVisibleMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  return (
    <section className="plan-calendar" aria-label="Training calendar">
      <header className="calendar-header">
        <div>
          <CalendarDays size={18} />
          <strong>{monthLabel}</strong>
        </div>
        <div>
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={17} />
          </button>
          <button type="button" onClick={() => setVisibleMonth(firstWorkout.slice(0, 7))}>
            Plan start
          </button>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">
            <ChevronRight size={17} />
          </button>
        </div>
      </header>
      <div className="calendar-weekdays">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((date) => {
          const dateKey = date.toISOString().slice(0, 10);
          const dayWorkouts = workoutsByDate.get(dateKey) ?? [];
          const outsideMonth = date.getUTCMonth() !== month - 1;
          return (
            <button
              type="button"
              className={`${outsideMonth ? 'outside-month ' : ''}${selectedDate === dateKey ? 'selected' : ''}`}
              key={dateKey}
              onClick={() => dayWorkouts.length > 0 && onSelectDate(dateKey)}
              title={dayWorkouts.map((workout) => workout.title).join(', ') || undefined}
              aria-label={`${dateKey}${dayWorkouts.length > 0 ? `, ${dayWorkouts.map((workout) => workout.title).join(', ')}` : ''}`}
            >
              <span>{date.getUTCDate()}</span>
              <div className="calendar-activities">
                {dayWorkouts.map((workout) => (
                  <i className={`activity-marker priority-${workout.priority}`} key={workout.id}>
                    <Footprints size={13} />
                  </i>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function WorkoutsPage({ workouts, title }: { workouts: WorkoutSummary[]; title?: string }) {
  const planTitle = title ?? workouts.at(0)?.planTitle ?? 'Training plan';
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(
    () => window.localStorage.getItem('askesis-calendar-visible') !== 'false',
  );
  const weeks = useMemo(() => {
    const grouped = new Map<number, WorkoutSummary[]>();
    for (const workout of workouts)
      grouped.set(workout.weekNumber, [...(grouped.get(workout.weekNumber) ?? []), workout]);
    return [...grouped.entries()];
  }, [workouts]);

  function selectDate(date: string) {
    setSelectedDate(date);
    window.setTimeout(
      () =>
        document
          .getElementById(`workout-${date}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50,
    );
  }

  function toggleCalendar() {
    setCalendarVisible((visible) => {
      window.localStorage.setItem('askesis-calendar-visible', String(!visible));
      return !visible;
    });
  }

  return (
    <main className="plan-page">
      <header className="plan-header">
        <div>
          <p className="page-kicker">Training plan</p>
          <h1>{planTitle}</h1>
          <p>{workouts.length} scheduled workouts</p>
        </div>
        <button className="secondary-button" type="button" onClick={toggleCalendar}>
          {calendarVisible ? <PanelTopClose size={17} /> : <PanelTopOpen size={17} />}
          {calendarVisible ? 'Hide calendar' : 'Show calendar'}
        </button>
      </header>

      {calendarVisible && (
        <WorkoutCalendar
          workouts={workouts}
          selectedDate={selectedDate}
          onSelectDate={selectDate}
        />
      )}

      <section className="schedule" aria-labelledby="workouts-heading">
        <div className="section-heading">
          <div>
            <h2 id="workouts-heading">Schedule</h2>
            <p>Your upcoming training, ordered by date.</p>
          </div>
          {selectedDate !== null && (
            <button type="button" onClick={() => setSelectedDate(null)}>
              Clear selected day
            </button>
          )}
        </div>
        {workouts.length === 0 ? (
          <p className="empty-state">No workouts have been scheduled.</p>
        ) : (
          weeks.map(([weekNumber, weekWorkouts]) => (
            <section className="training-week" key={weekNumber}>
              <header>
                <span>Week {weekNumber}</span>
                <strong>
                  {weekWorkouts.reduce(
                    (total, workout) => total + (workout.estimatedDistanceMetres ?? 0),
                    0,
                  ) / 1000}{' '}
                  km
                </strong>
              </header>
              <ol className="workout-list">
                {weekWorkouts.map((workout) => (
                  <WorkoutRow
                    workout={workout}
                    selected={selectedDate === workout.scheduledDate}
                    key={workout.id}
                  />
                ))}
              </ol>
            </section>
          ))
        )}
      </section>
    </main>
  );
}
