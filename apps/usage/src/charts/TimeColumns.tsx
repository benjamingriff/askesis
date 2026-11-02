import { useState } from 'react';
import { linearScale } from './scale';
import { Tooltip, TooltipRow, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

export interface TimeSeries {
  key: string;
  label: string;
  color: string;
}

export interface TimeMarker {
  day: string;
  label: string;
}

const HEIGHT = 280;
const MARGIN = { top: 26, right: 12, bottom: 30, left: 60 };

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

/** Stacked daily columns; one hover target per day. */
export function TimeColumns({
  days,
  series,
  value,
  format,
  formatAxis,
  markers = [],
  title,
  footer,
}: {
  days: string[];
  series: TimeSeries[];
  value: (day: string, key: string) => number;
  format: (value: number) => string;
  formatAxis: (value: number) => string;
  markers?: TimeMarker[];
  title: string;
  footer?: (day: string) => string | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const totals = days.map((day) => series.reduce((sum, item) => sum + value(day, item.key), 0));
  const max = Math.max(...totals, 0) || 1;
  const y = linearScale([0, max * 1.08], [HEIGHT - MARGIN.bottom, MARGIN.top], 4);
  const plot = width - MARGIN.left - MARGIN.right;
  const step = plot / Math.max(1, days.length);
  const gap = step > 6 ? 2 : 1;
  const barWidth = Math.max(1, step - gap);
  const base = HEIGHT - MARGIN.bottom;
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plot / 70))));
  const xOf = (index: number) => MARGIN.left + index * step + gap / 2;

  return (
    <div className="chart-canvas" ref={ref} onMouseLeave={() => (setTooltip(null), setHover(null))}>
      <svg width={width} height={HEIGHT} className="chart-svg" role="img" aria-label={title}>
        {y.ticks.map((tick) => (
          <g key={tick} transform={`translate(0,${y(tick)})`}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} className="grid-line" />
            <text x={MARGIN.left - 12} y={4} textAnchor="end" className="tick-label">
              {formatAxis(tick)}
            </text>
          </g>
        ))}
        {markers.map((marker) => {
          const index = days.indexOf(marker.day);
          if (index < 0) return null;
          const x = xOf(index) - gap / 2;
          return (
            <g key={marker.day + marker.label} className="time-marker">
              <line x1={x} x2={x} y1={MARGIN.top - 12} y2={base} />
              <text x={x + 5} y={MARGIN.top - 4}>
                {marker.label}
              </text>
            </g>
          );
        })}
        {days.map((day, index) => {
          let top = base;
          const x = xOf(index);
          const dim = hover !== null && hover !== day;
          const stack = series
            .map((item) => ({ item, v: value(day, item.key) }))
            .filter(({ v }) => v > 0);
          return (
            <g key={day} opacity={dim ? 0.45 : 1}>
              {stack.map(({ item, v }, position) => {
                const height = Math.max(0, base - y(v));
                top -= height;
                const last = position === stack.length - 1;
                const segment = Math.max(0, height - (last ? 0 : 1));
                return last && segment > 3 && barWidth > 4 ? (
                  <path
                    key={item.key}
                    d={roundedTop(x, top, barWidth, segment, Math.min(3, barWidth / 2))}
                    fill={item.color}
                  />
                ) : (
                  <rect
                    key={item.key}
                    x={x}
                    y={top}
                    width={barWidth}
                    height={segment}
                    fill={item.color}
                  />
                );
              })}
              <rect
                x={x - gap / 2}
                y={MARGIN.top}
                width={step}
                height={base - MARGIN.top}
                fill="transparent"
                onMouseMove={(event) => {
                  const box = ref.current?.getBoundingClientRect();
                  setHover(day);
                  const note = footer?.(day);
                  setTooltip({
                    x: event.clientX - (box?.left ?? 0),
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
                        {[...series].reverse().map((item) => (
                          <TooltipRow
                            key={item.key}
                            label={
                              <>
                                <i className="swatch" style={{ background: item.color }} />
                                {item.label}
                              </>
                            }
                            value={format(value(day, item.key))}
                          />
                        ))}
                        <TooltipRow label="Total" value={format(totals[index] ?? 0)} />
                        {note && <div className="tooltip-hint">{note}</div>}
                      </>
                    ),
                  });
                }}
              />
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
            <text
              key={day}
              x={xOf(index) + barWidth / 2}
              y={base + 18}
              textAnchor="middle"
              className="tick-label"
            >
              {dayLabel(day)}
            </text>
          ) : null,
        )}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}

export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span key={item.key}>
          <i className="swatch" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
