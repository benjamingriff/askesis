import { useState } from 'react';
import { linearScale } from './scale';
import { Tooltip, TooltipRow, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

export interface BarGroup {
  key: string;
  label: string;
  color: string;
  bars: { key: string; short: string; label: string; value: number; runs: number; demo: boolean }[];
}

const HEIGHT = 360;
const MARGIN = { top: 34, right: 16, bottom: 58, left: 64 };

/** Vertical bars per variant, clustered by model, labelled by reasoning effort. */
export function GroupedBars({
  groups,
  title,
  format,
}: {
  groups: BarGroup[];
  title: string;
  format: (value: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const max = Math.max(1, ...groups.flatMap((group) => group.bars.map((bar) => bar.value)));
  const y = linearScale([0, max * 1.12], [HEIGHT - MARGIN.bottom, MARGIN.top], 4);
  const barCount = groups.reduce((sum, group) => sum + group.bars.length, 0);
  const gap = 26;
  const plot = width - MARGIN.left - MARGIN.right - gap * Math.max(0, groups.length - 1);
  const barWidth = Math.max(8, Math.min(46, plot / Math.max(1, barCount) - 4));
  const base = HEIGHT - MARGIN.bottom;
  const positions = new Map<string, number>();
  const spans = new Map<string, [number, number]>();
  let cursor = MARGIN.left + 8;
  for (const group of groups) {
    const start = cursor;
    for (const bar of group.bars) {
      positions.set(bar.key, cursor);
      cursor += barWidth + 4;
    }
    spans.set(group.key, [start, cursor - 4]);
    cursor += gap;
  }

  return (
    <div className="chart-canvas" ref={ref} onMouseLeave={() => setTooltip(null)}>
      <svg width={width} height={HEIGHT} className="chart-svg" role="img" aria-label={title}>
        <text x={MARGIN.left} y={16} className="axis-title">
          {title}
        </text>
        {y.ticks.map((tick) => (
          <g key={tick} transform={`translate(0,${y(tick)})`}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} className="grid-line" />
            <text x={MARGIN.left - 14} y={4} textAnchor="end" className="tick-label">
              {format(tick)}
            </text>
          </g>
        ))}
        {groups.map((group) => {
          const [start, end] = spans.get(group.key) ?? [0, 0];
          const bars = group.bars.map((bar) => {
            const left = positions.get(bar.key) ?? 0;
            const top = y(bar.value);
            const radius = Math.min(4, barWidth / 2, base - top);
            return (
              <g
                key={bar.key}
                onMouseEnter={() =>
                  setTooltip({
                    x: left + barWidth / 2,
                    y: top,
                    content: (
                      <>
                        <div className="tooltip-title">
                          <i style={{ background: group.color }} /> {group.label}
                          <span className="tooltip-sub">{bar.label}</span>
                        </div>
                        <TooltipRow label="Median" value={format(bar.value)} />
                        <TooltipRow label="Runs" value={bar.runs} />
                        {bar.demo && <div className="tooltip-hint">Demo data</div>}
                      </>
                    ),
                  })
                }
              >
                <path
                  d={`M${left},${base}V${top + radius}Q${left},${top} ${left + radius},${top}H${left + barWidth - radius}Q${left + barWidth},${top} ${left + barWidth},${top + radius}V${base}Z`}
                  fill={bar.demo ? 'transparent' : group.color}
                  stroke={bar.demo ? group.color : 'none'}
                  strokeWidth={1.5}
                  opacity={0.9}
                />
                <text x={left + barWidth / 2} y={top - 6} textAnchor="middle" className="bar-value">
                  {format(bar.value)}
                </text>
                <text
                  x={left + barWidth / 2}
                  y={base + 16}
                  textAnchor="middle"
                  className="tick-label"
                >
                  {bar.short}
                </text>
              </g>
            );
          });
          return (
            <g key={group.key}>
              {bars}
              <text x={(start + end) / 2} y={base + 38} textAnchor="middle" className="group-label">
                {group.label}
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
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
