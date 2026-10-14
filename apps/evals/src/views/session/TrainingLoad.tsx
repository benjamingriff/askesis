import { Fragment, useState } from 'react';
import { Tooltip, TooltipRow, type TooltipState } from '../../charts/Tooltip';
import { linearScale } from '../../charts/scale';
import { useWidth } from '../../charts/useWidth';
import { formatDate } from '../../lib/format';
import type { LoadAmount, LoadMethod, LoadSport, PlanLoad } from '../../types';

// Categorical slots from the dashboard's validated palette, in fixed sport order.
const SPORT_COLOR: Record<LoadSport, string> = {
  run: '#d06a42',
  cycle: '#3987e5',
  swim: '#199e70',
  strength: '#c98500',
  other: '#d55181',
};
const SPORT_NAME: Record<LoadSport, string> = {
  run: 'Run',
  cycle: 'Ride',
  swim: 'Swim',
  strength: 'Strength',
  other: 'Other',
};
const SPORTS: LoadSport[] = ['run', 'cycle', 'swim', 'strength', 'other'];
const METHOD_LABEL: Record<LoadMethod, string> = {
  targets: 'pace or power targets',
  rpe: 'RPE',
  zone_default: 'typical zone intensity',
  estimate: "coach's duration estimate",
  not_counted: 'not counted (strength)',
  unestimated: 'no usable duration or intensity',
};
const MARGIN = { top: 26, right: 74, bottom: 30, left: 56 };
const ROW_GAP = 30;
type Mode = 'week' | 'day' | 'table';

interface Point {
  key: string;
  label: string;
  start: string;
  sports: Partial<Record<LoadSport, LoadAmount>>;
  seconds: number;
  metres: number;
  tss: number;
  fitness: number;
  fatigue: number;
  form: number;
}

const hours = (seconds: number) => seconds / 3600;
const km = (metres: number) => metres / 1000;
const formatHours = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

function points(load: PlanLoad, mode: 'week' | 'day'): Point[] {
  if (mode === 'day')
    return load.days.map((day) => ({
      ...day,
      key: day.date,
      label: formatDate(day.date),
      start: day.date,
    }));
  return load.weeks.map((week) => ({
    ...week,
    key: week.start,
    label: `Week ${week.index}`,
    start: week.start,
  }));
}

/** Days since the chart's first Monday. */
function dayIndex(load: PlanLoad, date: string) {
  return Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${load.start}T12:00:00Z`)) / 86400000,
  );
}

export function TrainingLoad({ load }: { load: PlanLoad | null }) {
  const [mode, setMode] = useState<Mode>('week');
  if (!load) return <p className="muted">No workouts were saved, so there is no load to show.</p>;
  const present = SPORTS.filter((sport) =>
    load.workouts.some((workout) => workout.sport === sport),
  );
  const counted = Object.entries(load.methods) as [LoadMethod, number][];
  return (
    <div className="training-load">
      <div className="load-toolbar">
        <div className="segmented" role="group" aria-label="Load view">
          {(['week', 'day', 'table'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === 'week' ? 'By week' : value === 'day' ? 'By day' : 'Table'}
            </button>
          ))}
        </div>
        <span className="small muted">Descriptive only: nothing here passes or fails a plan.</span>
      </div>
      {mode === 'table' ? (
        <LoadTable load={load} present={present} />
      ) : (
        <LoadRows load={load} mode={mode} present={present} />
      )}
      <IntensitySplit load={load} />
      <ul className="load-notes small muted">
        <li>
          Stress uses TSS-style scoring: hours × IF² × 100, or IF³ for swimming, where IF is the
          prescribed pace or power relative to threshold.
          {load.thresholds.runPaceSecondsPerKm !== null &&
            ` Run threshold ${formatPace(load.thresholds.runPaceSecondsPerKm)}/km.`}
          {load.thresholds.ftpWatts !== null && ` FTP ${Math.round(load.thresholds.ftpWatts)} W.`}
          {load.thresholds.cssSecondsPer100m !== null &&
            ` CSS ${formatPace(load.thresholds.cssSecondsPer100m)}/100 m.`}
        </li>
        <li>
          Workouts scored from{' '}
          {counted.map(([method, count], index) => (
            <Fragment key={method}>
              {index > 0 && (index === counted.length - 1 ? ' and ' : ', ')}
              {METHOD_LABEL[method]} ({count})
            </Fragment>
          ))}
          .
        </li>
        <li>
          Fitness and fatigue are 42- and 7-day weighted averages of daily stress; form is fitness
          minus fatigue.{' '}
          {load.baseline
            ? `${load.baseline.assumption} That is about ${load.baseline.weeklyTss} stress a week, which seeds both.`
            : 'No baseline was stated, so both start at zero.'}
        </li>
      </ul>
    </div>
  );
}

function formatPace(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

interface Row {
  id: string;
  title: string;
  height: number;
  max: number;
  value: (amount: LoadAmount) => number;
  baseline: number | null;
  format: (value: number) => string;
}

function LoadRows({
  load,
  mode,
  present,
}: {
  load: PlanLoad;
  mode: 'week' | 'day';
  present: LoadSport[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const data = points(load, mode);
  const perPoint = mode === 'week' ? 1 : 1 / 7;
  const baseline = load.baseline;
  const distanceSports = present.filter((sport) => sport !== 'strength');
  const rows: Row[] = [
    {
      id: 'tss',
      title: mode === 'week' ? 'Training stress per week' : 'Training stress per day',
      height: 120,
      max: Math.max(...data.map((point) => point.tss), (baseline?.weeklyTss ?? 0) * perPoint),
      value: (amount) => amount.tss,
      baseline: baseline ? baseline.weeklyTss * perPoint : null,
      format: (value) => String(Math.round(value)),
    },
    {
      id: 'fitness',
      title: 'Fitness and fatigue (stress per day)',
      height: 96,
      max: Math.max(...data.flatMap((point) => [point.fitness, point.fatigue])),
      value: () => 0,
      baseline: null,
      format: (value) => String(Math.round(value)),
    },
    {
      id: 'distance',
      title: mode === 'week' ? 'Distance per week (km)' : 'Distance per day (km)',
      height: 96,
      max: Math.max(
        ...data.map((point) => km(point.metres)),
        km(baseline?.weeklyMetres ?? 0) * perPoint,
      ),
      value: (amount) => km(amount.metres),
      baseline: baseline?.weeklyMetres ? km(baseline.weeklyMetres) * perPoint : null,
      format: (value) => `${Number(value.toFixed(1))}`,
    },
    {
      id: 'time',
      title: mode === 'week' ? 'Time per week (hours)' : 'Time per day (hours)',
      height: 96,
      max: Math.max(
        ...data.map((point) => hours(point.seconds)),
        hours(baseline?.weeklySeconds ?? 0) * perPoint,
      ),
      value: (amount) => hours(amount.seconds),
      baseline: baseline ? hours(baseline.weeklySeconds) * perPoint : null,
      format: (value) => `${Number(value.toFixed(1))}`,
    },
  ];
  const inner = width - MARGIN.left - MARGIN.right;
  const band = inner / Math.max(1, data.length);
  const barWidth = Math.max(2, Math.min(40, band * (mode === 'week' ? 0.56 : 0.7)));
  const total =
    MARGIN.top + rows.reduce((sum, row) => sum + row.height + ROW_GAP, 0) - ROW_GAP + MARGIN.bottom;
  let offset = MARGIN.top;
  const layout = rows.map((row) => {
    const top = offset;
    offset += row.height + ROW_GAP;
    return {
      row,
      top,
      y: linearScale([0, Math.max(1, row.max) * 1.12], [top + row.height, top], 3),
    };
  });
  const bottom = total - MARGIN.bottom;
  const position = (date: string) => {
    const index = dayIndex(load, date) / (mode === 'week' ? 7 : 1);
    return MARGIN.left + index * band;
  };
  const markers = [
    ...(load.coverageEnd
      ? [
          {
            x: position(load.coverageEnd) + band / (mode === 'week' ? 7 : 1),
            label: 'Prescribed to here',
            kind: 'coverage',
          },
        ]
      : []),
    ...load.events
      .filter((event) => event.date <= load.end)
      .map((event) => ({
        x: position(event.date) + band / (mode === 'week' ? 14 : 2),
        label: event.label,
        kind: 'event',
      })),
  ];
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(inner / 64)));

  const show = (index: number, clientX: number, clientY: number) => {
    const point = data[index];
    const box = ref.current?.getBoundingClientRect();
    if (!point || !box) return;
    setHover(index);
    setTooltip({
      x: clientX - box.left,
      y: clientY - box.top,
      content: (
        <>
          <div className="tooltip-title">
            <strong>{point.label}</strong>
            {mode === 'week' && <span className="muted">from {formatDate(point.start)}</span>}
          </div>
          {present
            .filter((sport) => point.sports[sport])
            .map((sport) => {
              const amount = point.sports[sport]!;
              return (
                <TooltipRow
                  key={sport}
                  label={SPORT_NAME[sport]}
                  value={`${formatHours(amount.seconds)}${amount.metres ? ` · ${km(amount.metres).toFixed(1)} km` : ''} · ${Math.round(amount.tss)}`}
                />
              );
            })}
          <TooltipRow label="Stress" value={Math.round(point.tss)} />
          <TooltipRow
            label="Fitness · fatigue · form"
            value={`${Math.round(point.fitness)} · ${Math.round(point.fatigue)} · ${point.form > 0 ? '+' : ''}${Math.round(point.form)}`}
          />
        </>
      ),
    });
  };

  return (
    <div
      className="chart-canvas"
      ref={ref}
      onMouseLeave={() => {
        setHover(null);
        setTooltip(null);
      }}
    >
      <svg
        width={width}
        height={total}
        className="chart-svg"
        role="img"
        aria-label="Prescribed training stress, fitness and fatigue, distance and time on a shared date axis"
      >
        {layout.map(({ row, top, y }) => (
          <g key={row.id}>
            <text x={MARGIN.left} y={top - 10} className="axis-title">
              {row.title}
            </text>
            {y.ticks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line x1={MARGIN.left} x2={width - MARGIN.right} className="grid-line" />
                <text x={MARGIN.left - 10} y={4} textAnchor="end" className="tick-label">
                  {row.format(tick)}
                </text>
              </g>
            ))}
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={top + row.height}
              y2={top + row.height}
              className="axis-line"
            />
            {row.id === 'fitness' ? (
              <FitnessLines data={data} y={y} band={band} hover={hover} width={width} />
            ) : (
              data.map((point, index) => {
                const centre = MARGIN.left + band * index + band / 2;
                let cumulative = 0;
                const parts = (row.id === 'distance' ? distanceSports : present).flatMap(
                  (sport) => {
                    const amount = point.sports[sport];
                    const value = amount ? row.value(amount) : 0;
                    if (value <= 0) return [];
                    const lower = cumulative;
                    cumulative += value;
                    // A 2px surface gap separates a segment from the one below it.
                    const gap = lower > 0 ? 2 : 0;
                    return [
                      {
                        sport,
                        top: y(cumulative),
                        height: Math.max(1, y(lower) - y(cumulative) - gap),
                      },
                    ];
                  },
                );
                return (
                  <g key={point.key} opacity={hover === null || hover === index ? 1 : 0.55}>
                    {parts.map((part) => (
                      <rect
                        key={part.sport}
                        x={centre - barWidth / 2}
                        y={part.top}
                        width={barWidth}
                        height={part.height}
                        rx={Math.min(2, barWidth / 4)}
                        fill={SPORT_COLOR[part.sport]}
                      />
                    ))}
                  </g>
                );
              })
            )}
            {row.baseline !== null && row.baseline > 0 && (
              <g>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(row.baseline)}
                  y2={y(row.baseline)}
                  className="baseline-line"
                />
                <text x={width - MARGIN.right + 6} y={y(row.baseline) + 4} className="series-label">
                  baseline
                </text>
              </g>
            )}
          </g>
        ))}
        {markers.map((marker) => (
          <g key={`${marker.kind}-${marker.label}`}>
            <line
              x1={marker.x}
              x2={marker.x}
              y1={MARGIN.top - 4}
              y2={bottom}
              className={`load-marker ${marker.kind}`}
            />
            <text
              x={marker.x > width - 160 ? marker.x - 4 : marker.x + 4}
              y={MARGIN.top - 14}
              textAnchor={marker.x > width - 160 ? 'end' : 'start'}
              className="series-label"
            >
              {marker.label}
            </text>
          </g>
        ))}
        {data.map((point, index) =>
          index % labelEvery === 0 ? (
            <text
              key={point.key}
              x={MARGIN.left + band * index + band / 2}
              y={bottom + 18}
              textAnchor="middle"
              className="tick-label"
            >
              {mode === 'week' ? `W${index + 1}` : formatDate(point.start)}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <line
            x1={MARGIN.left + band * hover + band / 2}
            x2={MARGIN.left + band * hover + band / 2}
            y1={MARGIN.top}
            y2={bottom}
            className="crosshair"
          />
        )}
        {data.map((point, index) => (
          <rect
            key={`hit-${point.key}`}
            x={MARGIN.left + band * index}
            y={MARGIN.top}
            width={band}
            height={bottom - MARGIN.top}
            fill="transparent"
            onMouseMove={(event) => show(index, event.clientX, event.clientY)}
          />
        ))}
      </svg>
      <div className="legend">
        {present.map((sport) => (
          <span key={sport}>
            <i className="legend-swatch" style={{ background: SPORT_COLOR[sport] }} />{' '}
            {SPORT_NAME[sport]}
          </span>
        ))}
        <span>
          <i className="legend-line fitness" /> Fitness
        </span>
        <span>
          <i className="legend-line fatigue" /> Fatigue
        </span>
        {baseline && (
          <span>
            <i className="legend-swatch baseline" /> Stated baseline
          </span>
        )}
      </div>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}

function FitnessLines({
  data,
  y,
  band,
  hover,
  width,
}: {
  data: Point[];
  y: (value: number) => number;
  band: number;
  hover: number | null;
  width: number;
}) {
  const x = (index: number) => MARGIN.left + band * index + band / 2;
  const path = (key: 'fitness' | 'fatigue') =>
    data.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point[key])}`).join(' ');
  const last = data.at(-1);
  return (
    <g>
      <path d={path('fitness')} className="load-line fitness" />
      <path d={path('fatigue')} className="load-line fatigue" />
      {hover !== null && data[hover] && (
        <>
          <circle cx={x(hover)} cy={y(data[hover].fitness)} r={4} className="load-dot fitness" />
          <circle cx={x(hover)} cy={y(data[hover].fatigue)} r={4} className="load-dot fatigue" />
        </>
      )}
      {last && (
        <EndLabels
          fitness={y(last.fitness)}
          fatigue={y(last.fatigue)}
          x={width - MARGIN.right + 6}
        />
      )}
    </g>
  );
}

/** Direct labels at the lines' ends, nudged apart when the lines finish close together. */
function EndLabels({ fitness, fatigue, x }: { fitness: number; fatigue: number; x: number }) {
  const gap = 14;
  const [upper, lower] = fitness <= fatigue ? [fitness, fatigue] : [fatigue, fitness];
  const spread = Math.max(0, gap - (lower - upper)) / 2;
  const place = (value: number) => (value === upper ? upper - spread : lower + spread) + 4;
  return (
    <>
      <text x={x} y={place(fitness)} className="series-label">
        Fitness
      </text>
      <text
        x={x}
        y={fitness === fatigue ? place(fitness) + gap : place(fatigue)}
        className="series-label"
      >
        Fatigue
      </text>
    </>
  );
}

function LoadTable({ load, present }: { load: PlanLoad; present: LoadSport[] }) {
  return (
    <div className="table-wrap">
      <table className="runs-table load-table">
        <thead>
          <tr>
            <th>Week</th>
            {present.map((sport) => (
              <th key={sport}>{SPORT_NAME[sport]}</th>
            ))}
            <th>Time</th>
            <th>Distance</th>
            <th>Stress</th>
            <th>Fitness</th>
            <th>Fatigue</th>
            <th>Form</th>
          </tr>
        </thead>
        <tbody>
          {load.weeks.map((week) => (
            <tr key={week.start}>
              <td>
                Week {week.index} <span className="muted">· {formatDate(week.start)}</span>
              </td>
              {present.map((sport) => {
                const amount = week.sports[sport];
                return (
                  <td key={sport} className="mono">
                    {amount ? `${formatHours(amount.seconds)} · ${Math.round(amount.tss)}` : '—'}
                  </td>
                );
              })}
              <td className="mono">{formatHours(week.seconds)}</td>
              <td className="mono">{km(week.metres).toFixed(1)} km</td>
              <td className="mono">{Math.round(week.tss)}</td>
              <td className="mono">{Math.round(week.fitness)}</td>
              <td className="mono">{Math.round(week.fatigue)}</td>
              <td className="mono">
                {week.form > 0 ? '+' : ''}
                {Math.round(week.form)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Share of each week's training time at easy, moderate and hard intensity. */
function IntensitySplit({ load }: { load: PlanLoad }) {
  const weeks = load.weeks.filter((week) => week.seconds > 0);
  if (weeks.length === 0) return null;
  return (
    <div className="intensity-split">
      <h3>Intensity by week</h3>
      {weeks.map((week) => {
        const parts = [
          ['easy', week.intensity.easy],
          ['moderate', week.intensity.moderate],
          ['hard', week.intensity.hard],
          ['uncounted', week.intensity.uncounted],
        ] as const;
        const total = parts.reduce((sum, [, seconds]) => sum + seconds, 0) || 1;
        return (
          <div key={week.start} className="intensity-row">
            <span className="small">Week {week.index}</span>
            <div
              className="intensity-bar"
              aria-label={parts
                .map(([name, seconds]) => `${name} ${Math.round((seconds / total) * 100)}%`)
                .join(', ')}
            >
              {parts.map(([name, seconds]) =>
                seconds > 0 ? (
                  <span
                    key={name}
                    className={`intensity-${name}`}
                    style={{ flexGrow: seconds }}
                    title={`${name}: ${formatHours(seconds)}`}
                  />
                ) : null,
              )}
            </div>
            <span className="small muted mono">
              {Math.round((week.intensity.easy / total) * 100)}% easy
            </span>
          </div>
        );
      })}
      <div className="legend">
        <span>
          <i className="legend-swatch intensity-easy" /> Easy (IF &lt; 0.85)
        </span>
        <span>
          <i className="legend-swatch intensity-moderate" /> Moderate (0.85–0.95)
        </span>
        <span>
          <i className="legend-swatch intensity-hard" /> Hard (≥ 0.95)
        </span>
        <span>
          <i className="legend-swatch intensity-uncounted" /> Not counted
        </span>
      </div>
    </div>
  );
}
