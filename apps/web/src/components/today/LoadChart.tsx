import type { WorkoutSummary } from '@askesis/api-client';
import { Trophy } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { daysBetween, formatShort, WEEKDAYS_SHORT, weekdayIndex } from '../../lib/format';
import { FORM_STATES, formRatio, formState, type LoadDay } from '../../lib/load';
import { cx } from '../ui';

/** Lower and upper edge of the productive range, as a share of fitness. */
const PRODUCTIVE = [-0.3, -0.1] as const;

function linePath(points: [number, number][]) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
}

/**
 * Fitness and fatigue across the plan, then form beneath on its own scale (never a second axis on
 * one plot). Days before today are solid; the rest is the schedule projected forward.
 */
export function LoadChart({
  series,
  today,
  workouts = [],
  parts = 'both',
}: {
  series: LoadDay[];
  today: string;
  /** Sessions for the readout, and races to mark. */
  workouts?: WorkoutSummary[] | undefined;
  /** The compact version shows fitness and fatigue without the form chart. */
  parts?: 'both' | 'lines' | undefined;
}) {
  const id = useId();
  const n = series.length;
  const todayIndex = series.findIndex((day) => day.date === today);
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? (todayIndex >= 0 ? todayIndex : null);
  const scale = useMemo(() => {
    // Lines need no zero baseline; fit them so a plan's rise and its cutbacks are visible.
    const top = Math.max(...series.map((d) => Math.max(d.fitness, d.fatigue)), 1) * 1.08;
    const bottom = Math.min(...series.map((d) => Math.min(d.fitness, d.fatigue))) * 0.8;
    const fitnessPeak = Math.max(...series.map((d) => d.fitness), 1);
    const low = Math.min(...series.map((d) => d.form), PRODUCTIVE[0] * fitnessPeak * 1.15);
    const high = Math.max(...series.map((d) => d.form), 0.2 * fitnessPeak);
    return { top, bottom, low, high };
  }, [series]);
  if (n < 2) return null;

  const x = (i: number) => i + 0.5;
  const pct = (i: number) => (x(i) / n) * 100;
  const yTop = (value: number) =>
    100 - ((value - scale.bottom) / Math.max(1, scale.top - scale.bottom)) * 100;
  const yForm = (value: number) => ((scale.high - value) / (scale.high - scale.low)) * 100;
  const split = todayIndex >= 0 ? todayIndex : n - 1;
  const past = (key: 'fitness' | 'fatigue') =>
    linePath(series.slice(0, split + 1).map((d, i) => [x(i), yTop(d[key])]));
  const ahead = (key: 'fitness' | 'fatigue') =>
    linePath(series.slice(split).map((d, i) => [x(i + split), yTop(d[key])]));
  const band = `${linePath(series.map((d, i) => [x(i), yForm(PRODUCTIVE[1] * d.fitness)]))}${linePath(
    [...series].reverse().map((d, j) => [x(n - 1 - j), yForm(PRODUCTIVE[0] * d.fitness)]),
  ).replace(/^M/, 'L')}Z`;
  const zero = yForm(0);
  const races = workouts.filter(
    (w) =>
      (w.racePriority === 'A' || w.racePriority === 'B') &&
      series.some((d) => d.date === w.scheduledDate),
  );
  const weekStarts = series
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => weekdayIndex(day.date) === 0);
  const every = weekStarts.length > 14 ? 4 : weekStarts.length > 8 ? 2 : 1;
  const day = shown !== null ? series[shown]! : null;
  const sessions = day ? workouts.filter((w) => w.scheduledDate === day.date) : [];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * n);
    setActive(Math.max(0, Math.min(n - 1, index)));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = shown ?? 0;
    const next =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? n - 1
              : null;
    if (event.key === 'Escape') setActive(null);
    if (next === null) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(n - 1, next)));
  };

  return (
    <div className={cx('load-chart', parts === 'lines' && 'lines-only')}>
      <div className="load-legend" aria-hidden="true">
        <span className="legend-line fitness">
          <i /> Fitness <strong>{day ? Math.round(day.fitness) : '—'}</strong>
        </span>
        <span className="legend-line fatigue">
          <i /> Fatigue <strong>{day ? Math.round(day.fatigue) : '—'}</strong>
        </span>
        {parts === 'both' ? (
          <>
            <span className="legend-line form">
              <i /> Form <strong>{day ? signed(Math.round(day.form)) : '—'}</strong>
            </span>
            <span className="legend-band">
              <i /> Productive range
            </span>
          </>
        ) : null}
      </div>

      <div
        className="load-plot"
        role="group"
        tabIndex={0}
        aria-label="Training load across the plan. Use the arrow keys to read each day."
        aria-describedby={`${id}-readout`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
        onKeyDown={keys}
        onBlur={() => setActive(null)}
      >
        <div className="load-pane load-pane-lines">
          <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
            <path className="line fatigue" d={past('fatigue')} />
            <path className="line fatigue ahead" d={ahead('fatigue')} />
            <path className="line fitness" d={past('fitness')} />
            <path className="line fitness ahead" d={ahead('fitness')} />
          </svg>
          {day && shown !== null ? (
            <>
              <span
                className="load-dot fatigue"
                style={{ left: `${pct(shown)}%`, top: `${yTop(day.fatigue)}%` }}
              />
              <span
                className="load-dot fitness"
                style={{ left: `${pct(shown)}%`, top: `${yTop(day.fitness)}%` }}
              />
            </>
          ) : null}
          {races.map((race) => (
            <span
              key={race.id}
              className="load-race"
              style={{ left: `${pct(daysBetween(series[0]!.date, race.scheduledDate))}%` }}
              title={`${race.title}, ${formatShort(race.scheduledDate)}`}
            >
              <Trophy size={12} aria-hidden="true" />
            </span>
          ))}
        </div>
        {parts === 'both' ? (
          <div className="load-pane load-pane-form">
            <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
              <path className="productive-band" d={band} />
              {series.map((d, i) => {
                const y = yForm(d.form);
                return (
                  <rect
                    key={d.date}
                    className={cx(
                      'form-bar',
                      i === todayIndex && 'today',
                      i === shown && 'shown',
                      i > split && 'ahead',
                    )}
                    x={i + 0.18}
                    width={0.64}
                    y={Math.min(y, zero)}
                    height={Math.max(Math.abs(zero - y), 0.6)}
                  />
                );
              })}
              <line className="zero" x1={0} x2={n} y1={zero} y2={zero} />
            </svg>
          </div>
        ) : null}
        {todayIndex >= 0 ? (
          <span className="load-today" style={{ left: `${pct(todayIndex)}%` }}>
            <span>Today</span>
          </span>
        ) : null}
        {active !== null && active !== todayIndex ? (
          <span className="load-crosshair" style={{ left: `${pct(active)}%` }} />
        ) : null}
      </div>

      <div className="load-axis" aria-hidden="true">
        {weekStarts.map(({ index }, k) =>
          k % every === 0 ? (
            <span key={index} style={{ left: `${pct(index)}%` }}>
              W{k + 1 + (weekdayIndex(series[0]!.date) === 0 ? 0 : 1)}
            </span>
          ) : null,
        )}
      </div>

      <p className="load-readout" id={`${id}-readout`} aria-live="polite">
        {day ? (
          <>
            <strong>
              {day.date === today
                ? 'Today'
                : `${WEEKDAYS_SHORT[weekdayIndex(day.date)]} ${formatShort(day.date)}`}
            </strong>
            {' · '}
            {FORM_STATES[formState(day)].label} ({signed(Math.round(formRatio(day) * 100))}%)
            {' · '}
            {sessions.length
              ? `${sessions.map((w) => w.title).join(' + ')}, load ${Math.round(day.load)}`
              : 'Rest'}
          </>
        ) : null}
      </p>

      <table className="sr-only">
        <caption>Training load by week, on Monday morning</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Fitness</th>
            <th scope="col">Fatigue</th>
            <th scope="col">Form</th>
          </tr>
        </thead>
        <tbody>
          {weekStarts.map(({ day: d }) => (
            <tr key={d.date}>
              <th scope="row">{formatShort(d.date)}</th>
              <td>{Math.round(d.fitness)}</td>
              <td>{Math.round(d.fatigue)}</td>
              <td>{signed(Math.round(d.form))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function signed(value: number) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
}
