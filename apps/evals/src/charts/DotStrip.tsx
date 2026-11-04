import { useState } from 'react';
import { linearScale } from './scale';
import { Tooltip, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

export interface StripPoint {
  id: string;
  value: number;
  tone: string;
  label: string;
  hollow?: boolean;
}

const HEIGHT = 64;
const PAD = { left: 8, right: 8 };

/**
 * One dot per run along a single axis, jittered into rows when values collide.
 * Shows the spread a mean hides, which matters at a handful of runs.
 */
export function DotStrip({
  points,
  format,
  median,
  onSelect,
  domain,
}: {
  points: StripPoint[];
  format: (value: number) => string;
  median: number | null;
  onSelect?: (id: string) => void;
  /** Shared axis when strips are compared side by side. */
  domain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(260);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  if (points.length === 0) return <div className="muted small strip-empty">No data</div>;
  const values = points.map((point) => point.value);
  const min = domain?.[0] ?? Math.min(...values);
  const max = domain?.[1] ?? Math.max(...values);
  const x = linearScale(
    [min === max ? min - 1 : min, min === max ? max + 1 : max],
    [PAD.left, width - PAD.right],
    4,
  );
  const rows = new Map<number, number>();
  const placed = [...points]
    .sort((a, b) => a.value - b.value)
    .map((point) => {
      const bucket = Math.round(x(point.value) / 9);
      const row = rows.get(bucket) ?? 0;
      rows.set(bucket, row + 1);
      return { ...point, cx: x(point.value), cy: HEIGHT - 26 - row * 9 };
    });

  return (
    <div className="chart-canvas dot-strip" ref={ref} onMouseLeave={() => setTooltip(null)}>
      <svg width={width} height={HEIGHT} className="chart-svg" role="img" aria-label="Distribution">
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={HEIGHT - 18}
          y2={HEIGHT - 18}
          className="axis-line"
        />
        {median !== null && (
          <line x1={x(median)} x2={x(median)} y1={6} y2={HEIGHT - 14} className="median-line" />
        )}
        {placed.map((point) => (
          <circle
            key={point.id}
            cx={point.cx}
            cy={Math.max(5, point.cy)}
            r={3.5}
            className={`strip-dot tone-${point.tone}${point.hollow ? ' hollow' : ''}`}
            onMouseEnter={() =>
              setTooltip({
                x: point.cx,
                y: point.cy,
                content: (
                  <>
                    <div className="tooltip-title">{format(point.value)}</div>
                    <div className="tooltip-hint">{point.label}</div>
                  </>
                ),
              })
            }
            onClick={() => onSelect?.(point.id)}
          />
        ))}
        <text x={PAD.left} y={HEIGHT - 3} className="tick-label small">
          {format(min)}
        </text>
        <text x={width - PAD.right} y={HEIGHT - 3} textAnchor="end" className="tick-label small">
          {format(max)}
        </text>
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
