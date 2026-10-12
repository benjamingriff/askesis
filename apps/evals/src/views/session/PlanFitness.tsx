import { Fragment, useState } from 'react';
import { Tooltip, TooltipRow, type TooltipState } from '../../charts/Tooltip';
import { linearScale } from '../../charts/scale';
import { useWidth } from '../../charts/useWidth';
import { Tag } from '../../components/Badges';
import { formatDate, formatDistance, formatDuration } from '../../lib/format';
import type { PlanFitness as Fitness, PlannedWorkout, RunDetail } from '../../types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HEIGHT = 250;
const MARGIN = { top: 26, right: 16, bottom: 40, left: 52 };

/** Weekly volume and long run against the athlete's stated baseline. */
function LoadChart({ fitness }: { fitness: Fitness }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const weeks = fitness.weeks;
  const baseline = fitness.baselineWeeklyMetres;
  const longest = fitness.baselineLongestMetres;
  const max =
    Math.max(1, ...weeks.map((week) => week.distanceMetres), (baseline ?? 0) * 1.1) / 1000;
  const y = linearScale([0, max * 1.15], [HEIGHT - MARGIN.bottom, MARGIN.top], 4);
  const band = (width - MARGIN.left - MARGIN.right) / Math.max(1, weeks.length);
  const barWidth = Math.min(64, band * 0.5);
  const base = HEIGHT - MARGIN.bottom;

  return (
    <div className="chart-canvas" ref={ref} onMouseLeave={() => setTooltip(null)}>
      <svg
        width={width}
        height={HEIGHT}
        className="chart-svg"
        role="img"
        aria-label="Weekly volume against baseline"
      >
        <text x={MARGIN.left} y={14} className="axis-title">
          km per week
        </text>
        {y.ticks.map((tick) => (
          <g key={tick} transform={`translate(0,${y(tick)})`}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} className="grid-line" />
            <text x={MARGIN.left - 12} y={4} textAnchor="end" className="tick-label">
              {tick}
            </text>
          </g>
        ))}
        {baseline !== null && (
          <g>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(baseline / 1000)}
              y2={y(baseline / 1000)}
              className="baseline-line"
            />
            <text
              x={width - MARGIN.right}
              y={y(baseline / 1000) - 6}
              textAnchor="end"
              className="baseline-label"
            >
              baseline {formatDistance(baseline)}
            </text>
          </g>
        )}
        {weeks.map((week, index) => {
          const centre = MARGIN.left + band * index + band / 2;
          const previous = index === 0 ? baseline : (weeks[index - 1]?.distanceMetres ?? null);
          const cap = previous ? (previous * 1.1) / 1000 : null;
          const over = cap !== null && week.distanceMetres / 1000 > cap;
          const total = week.distanceMetres / 1000;
          const long = week.longestMetres / 1000;
          const radius = Math.min(4, base - y(total));
          const left = centre - barWidth / 2;
          return (
            <g
              key={week.index}
              onMouseMove={(event) => {
                const box = ref.current?.getBoundingClientRect();
                setTooltip({
                  x: event.clientX - (box?.left ?? 0),
                  y: event.clientY - (box?.top ?? 0),
                  content: (
                    <>
                      <div className="tooltip-title">
                        Week {week.index} · {formatDate(week.start)}
                      </div>
                      <TooltipRow label="Total" value={formatDistance(week.distanceMetres)} />
                      <TooltipRow label="Long run" value={formatDistance(week.longestMetres)} />
                      <TooltipRow label="Sessions" value={week.sessions} />
                      <TooltipRow
                        label="Time"
                        value={formatDuration(week.durationSeconds * 1000)}
                      />
                      {cap !== null && (
                        <TooltipRow label="+10% guide" value={`${cap.toFixed(1)} km`} />
                      )}
                    </>
                  ),
                });
              }}
            >
              <path
                d={`M${left},${base}V${y(total) + radius}Q${left},${y(total)} ${left + radius},${y(total)}H${left + barWidth - radius}Q${left + barWidth},${y(total)} ${left + barWidth},${y(total) + radius}V${base}Z`}
                className={over ? 'load-bar over' : 'load-bar'}
              />
              <rect
                x={centre - barWidth / 6}
                y={y(long)}
                width={barWidth / 3}
                height={Math.max(0, base - y(long))}
                className="long-bar"
                rx={2}
              />
              {cap !== null && (
                <line
                  x1={left - 4}
                  x2={left + barWidth + 4}
                  y1={y(cap)}
                  y2={y(cap)}
                  className="cap-line"
                />
              )}
              <text x={centre} y={y(total) - 6} textAnchor="middle" className="bar-value">
                {total}
              </text>
              <text x={centre} y={base + 16} textAnchor="middle" className="tick-label">
                W{week.index}
              </text>
              <text x={centre} y={base + 31} textAnchor="middle" className="point-label">
                long {long} km
              </text>
            </g>
          );
        })}
        {longest !== null && weeks.length > 0 && (
          <line
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={y(longest / 1000)}
            y2={y(longest / 1000)}
            className="baseline-line long"
          />
        )}
        <line
          x1={MARGIN.left}
          x2={width - MARGIN.right}
          y1={base}
          y2={base}
          className="axis-line"
        />
      </svg>
      <div className="legend">
        <span>
          <i className="legend-swatch load" /> Weekly total
        </span>
        <span>
          <i className="legend-swatch long" /> Long run
        </span>
        <span>
          <i className="legend-swatch cap" /> +10% on the previous week
        </span>
        <span>
          <i className="legend-swatch baseline" /> Stated baseline
        </span>
      </div>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}

function WeekdayStrip({ fitness }: { fitness: Fitness }) {
  return (
    <div className="weekday-strip">
      {WEEKDAYS.map((day, index) => {
        const weekday = index + 1;
        const available =
          fitness.availableWeekdays.length === 0 || fitness.availableWeekdays.includes(weekday);
        const count = fitness.weekdayCounts[index] ?? 0;
        const limit = fitness.dayLimits[String(weekday)];
        return (
          <div
            key={day}
            className={`weekday${available ? '' : ' unavailable'}${!available && count > 0 ? ' violation' : ''}`}
          >
            <span className="weekday-name">{day}</span>
            <strong>{count}</strong>
            <span className="weekday-note">
              {available ? (limit ? `≤ ${limit} min` : 'available') : 'unavailable'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DurationBars({ fitness }: { fitness: Fitness }) {
  const max = Math.max(
    1,
    ...fitness.workouts.map((workout) => (workout.durationSeconds ?? 0) / 60),
    ...Object.values(fitness.dayLimits),
  );
  return (
    <ul className="duration-bars">
      {fitness.workouts.map((workout) => {
        const minutes = (workout.durationSeconds ?? 0) / 60;
        const limit = fitness.dayLimits[String(workout.weekday)];
        const over = limit !== undefined && minutes > limit;
        return (
          <li key={workout.id}>
            <span className="muted">
              {WEEKDAYS[workout.weekday - 1]} {workout.date.slice(5)}
            </span>
            <span className="duration-track">
              <span
                className={`duration-fill${over ? ' over' : ''}`}
                style={{ width: `${(minutes / max) * 100}%` }}
              />
              {limit !== undefined && (
                <span
                  className="duration-limit"
                  style={{ left: `${(limit / max) * 100}%` }}
                  title={`Limit ${limit} min`}
                />
              )}
            </span>
            <span className={over ? 'over-text' : undefined}>{Math.round(minutes)} min</span>
          </li>
        );
      })}
    </ul>
  );
}

export function PlanFitness({ run }: { run: RunDetail }) {
  const fitness = run.fitness;
  if (!fitness || fitness.workouts.length === 0)
    return <p className="muted">No workouts were saved.</p>;
  const zones = Object.entries(fitness.zoneCounts);
  const limitsParsed = Object.keys(fitness.dayLimits).length > 0;
  return (
    <div className="fitness">
      <div className="fitness-grid">
        <div className="fitness-panel wide">
          <h3>Load progression</h3>
          <LoadChart fitness={fitness} />
        </div>
        <div className="fitness-panel">
          <h3>Sessions by weekday</h3>
          <WeekdayStrip fitness={fitness} />
          {fitness.sessionsPerWeek !== null && (
            <p className="small muted">
              Athlete asked for {fitness.sessionsPerWeek} sessions a week; planned{' '}
              {fitness.weeks.map((week) => week.sessions).join(' / ')}.
            </p>
          )}
          <h3>Intensity</h3>
          <div className="zone-chips">
            {zones.length === 0 ? (
              <span className="muted small">No zone targets</span>
            ) : (
              zones.map(([zone, count]) => (
                <Tag key={zone} tone="accent">{`${zone} × ${count}`}</Tag>
              ))
            )}
          </div>
        </div>
        <div className="fitness-panel">
          <h3>Session length vs daily limit</h3>
          <DurationBars fitness={fitness} />
          {limitsParsed && (
            <p className="footnote">Limits parsed from the scenario&apos;s availability text.</p>
          )}
        </div>
        <div className="fitness-panel">
          <h3>Closing summary vs saved plan</h3>
          {run.claims.length === 0 ? (
            <p className="muted small">The closing message quotes no distances to compare.</p>
          ) : (
            <ul className="claims">
              {run.claims.map((claim) => (
                <li key={claim.label}>
                  <span className={claim.mentioned ? 'claim-ok' : 'claim-miss'}>
                    {claim.mentioned ? '✓' : '✕'}
                  </span>
                  <span>{claim.label}</span>
                  <span className="muted">{claim.plannedKm} km</span>
                </li>
              ))}
            </ul>
          )}
          <h3>Validation findings</h3>
          {fitness.findings.length === 0 ? (
            <p className="muted small">None.</p>
          ) : (
            <ul className="findings">
              {fitness.findings.map((finding) => (
                <li key={finding.code} className={`finding-${finding.severity}`}>
                  <code>{finding.code}</code> {finding.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {run.blocks.length > 0 && (
        <div className="blocks">
          {run.blocks.map((block) => (
            <div key={block.title + block.startDate} className="block">
              <Tag tone="accent">{block.phase ?? 'block'}</Tag>
              <strong>{block.title}</strong>
              <span className="muted">
                {formatDate(block.startDate)} – {formatDate(block.endDate)}
              </span>
            </div>
          ))}
        </div>
      )}
      <PlanGrid workouts={run.workouts} />
    </div>
  );
}

function mondayOf(iso: string): Date {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

export function PlanGrid({ workouts }: { workouts: PlannedWorkout[] }) {
  if (workouts.length === 0) return null;
  const first = mondayOf(workouts[0]?.date ?? '');
  const last = mondayOf(workouts[workouts.length - 1]?.date ?? '');
  const weeks: Date[] = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    weeks.push(new Date(cursor));
  }
  const byDate = new Map<string, PlannedWorkout[]>();
  for (const workout of workouts)
    byDate.set(workout.date, [...(byDate.get(workout.date) ?? []), workout]);

  return (
    <div className="plan-grid">
      <div className="plan-head" />
      {WEEKDAYS.map((day) => (
        <div key={day} className="plan-head">
          {day}
        </div>
      ))}
      {weeks.map((monday, weekIndex) => {
        const days = WEEKDAYS.map((_, offset) => {
          const date = new Date(monday);
          date.setUTCDate(date.getUTCDate() + offset);
          return date.toISOString().slice(0, 10);
        });
        const distance = days
          .flatMap((day) => byDate.get(day) ?? [])
          .reduce((sum, workout) => sum + (workout.distanceMetres ?? 0), 0);
        return (
          <Fragment key={monday.toISOString()}>
            <div className="plan-week">
              <strong>W{weekIndex + 1}</strong>
              <span>{distance > 0 ? formatDistance(distance) : ''}</span>
            </div>
            {days.map((day) => (
              <div key={day} className="plan-day">
                <span className="plan-date">{day.slice(8)}</span>
                {(byDate.get(day) ?? []).map((workout) => (
                  <div
                    key={workout.id}
                    id={`workout-${workout.id}`}
                    className="workout"
                    title={workout.instructions ?? undefined}
                  >
                    <strong>{workout.title}</strong>
                    <span>
                      {[
                        formatDistance(workout.distanceMetres),
                        workout.durationSeconds
                          ? formatDuration(workout.durationSeconds * 1000)
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
