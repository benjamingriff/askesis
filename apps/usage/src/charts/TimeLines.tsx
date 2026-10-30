import { useState } from 'react';
import { linearScale } from './scale';
import type { TimeMarker, TimeSeries } from './TimeColumns';
import { Tooltip, TooltipRow, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

const HEIGHT = 250;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 60 };

/** Daily lines on one axis with a crosshair; null values break the line. */
export function TimeLines({
  days,
  series,
  value,
  format,
  domain,
  markers = [],
  title,
  detail,
}: {
  days: string[];
  series: TimeSeries[];
  value: (day: string, key: string) => number | null;
  format: (value: number) => string;
  domain: [number, number];
  markers?: TimeMarker[];
  title: string;
  detail?: (day: string, key: string) => string | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const y = linearScale(domain, [HEIGHT - MARGIN.bottom, MARGIN.top], 4);
  const plot = width - MARGIN.left - MARGIN.right;
  const step = plot / Math.max(1, days.length - 1);
  const x = (index: number) => MARGIN.left + index * step;
  const base = HEIGHT - MARGIN.bottom;
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plot / 70))));

  const paths = series.map((item) => {
    let d = '';
    let open = false;
    let last: { x: number; y: number } | null = null;
    days.forEach((day, index) => {
      const v = value(day, item.key);
      if (v === null) {
        open = false;
        return;
      }
      const point = { x: x(index), y: y(v) };
      d += `${open ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      open = true;
      last = point;
    });
    return { item, d, last: last as { x: number; y: number } | null };
  });

  // Nudge end labels apart so converging lines keep readable names.
  const labelY = new Map<string, number>();
  const ends = paths
    .flatMap(({ item, last }) => (last ? [{ key: item.key, y: last.y + 4 }] : []))
    .sort((a, b) => a.y - b.y);
  ends.forEach((end, index) => {
    const previous = ends[index - 1];
    if (previous && end.y - previous.y < 14) end.y = previous.y + 14;
    labelY.set(end.key, end.y);
  });

  return (
    <div
      className="chart-canvas"
      ref={ref}
      onMouseLeave={() => (setTooltip(null), setHover(null))}
      onMouseMove={(event) => {
        const box = ref.current?.getBoundingClientRect();
        const px = event.clientX - (box?.left ?? 0);
        const index = Math.round((px - MARGIN.left) / step);
        if (index < 0 || index >= days.length) {
          setTooltip(null);
          setHover(null);
          return;
        }
        const day = days[index] as string;
        setHover(index);
        setTooltip({
          x: px,
          y: event.clientY - (box?.top ?? 0),
          content: (
            <>
              <div className="tooltip-title">
                {new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </div>
              {series.map((item) => {
                const v = value(day, item.key);
                const note = detail?.(day, item.key);
                return (
                  <TooltipRow
                    key={item.key}
                    label={
                      <>
                        <i className="swatch line" style={{ background: item.color }} />
                        {item.label}
                      </>
                    }
                    value={
                      v === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {format(v)}
                          {note && <span className="tooltip-sub"> · {note}</span>}
                        </>
                      )
                    }
                  />
                );
              })}
            </>
          ),
        });
      }}
    >
      <svg width={width} height={HEIGHT} className="chart-svg" role="img" aria-label={title}>
        {y.ticks.map((tick) => (
          <g key={tick} transform={`translate(0,${y(tick)})`}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} className="grid-line" />
            <text x={MARGIN.left - 12} y={4} textAnchor="end" className="tick-label">
              {format(tick)}
            </text>
          </g>
        ))}
        {markers.map((marker) => {
          const index = days.indexOf(marker.day);
          if (index < 0) return null;
          return (
            <g key={marker.day + marker.label} className="time-marker">
              <line x1={x(index)} x2={x(index)} y1={MARGIN.top - 12} y2={base} />
              <text x={x(index) + 5} y={MARGIN.top - 4}>
                {marker.label}
              </text>
            </g>
          );
        })}
        <line
          x1={MARGIN.left}
          x2={width - MARGIN.right}
          y1={base}
          y2={base}
          className="axis-line"
        />
        {days.map((day, index) =>
          index % labelEvery === 0 ? (
            <text key={day} x={x(index)} y={base + 18} textAnchor="middle" className="tick-label">
              {new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
              })}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={base} className="crosshair" />
        )}
        {paths.map(({ item, d, last }) => (
          <g key={item.key}>
            <path d={d} fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" />
            {hover !== null &&
              (() => {
                const v = value(days[hover] as string, item.key);
                return v === null ? null : (
                  <circle
                    cx={x(hover)}
                    cy={y(v)}
                    r={4}
                    fill={item.color}
                    stroke="var(--bg)"
                    strokeWidth={2}
                  />
                );
              })()}
            {last && (
              <text x={last.x + 8} y={labelY.get(item.key)} className="series-label">
                {item.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
