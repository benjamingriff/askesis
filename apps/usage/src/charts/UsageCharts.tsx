import { useState, type ReactNode } from 'react';
import { linearScale, logScale } from './scale';
import { Tooltip, TooltipRow, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

/** Tiny daily bars for a table row; no axes, the row's numbers carry the values. */
export function Sparkline({ values, max }: { values: number[]; max: number }) {
  const width = 96;
  const height = 22;
  const step = width / Math.max(1, values.length);
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} />
      {values.map((value, index) =>
        value > 0 ? (
          <rect
            key={index}
            x={index * step}
            y={height - Math.max(1.5, (value / (max || 1)) * height)}
            width={Math.max(1, step - (step > 3 ? 1 : 0))}
            height={Math.max(1.5, (value / (max || 1)) * height)}
          />
        ) : null,
      )}
    </svg>
  );
}

export interface ShareRow {
  key: string;
  label: ReactNode;
  caption: string;
  segments: { key: string; label: string; color: string; value: number; display: string }[];
}

/** 100% horizontal stacks; label segments that are wide enough to hold text. */
export function ShareRows({ rows }: { rows: ShareRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  return (
    <div className="chart-canvas share-rows" ref={ref} onMouseLeave={() => setTooltip(null)}>
      {rows.map((row) => {
        const total = row.segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
        return (
          <div className="share-row" key={row.key}>
            <div className="share-label">
              {row.label}
              <small>{row.caption}</small>
            </div>
            <div className="share-track">
              {row.segments
                .filter((segment) => segment.value > 0)
                .map((segment) => {
                  const share = segment.value / total;
                  return (
                    <div
                      key={segment.key}
                      style={{ flexGrow: segment.value, background: segment.color }}
                      onMouseMove={(event) => {
                        const box = ref.current?.getBoundingClientRect();
                        setTooltip({
                          x: event.clientX - (box?.left ?? 0),
                          y: event.clientY - (box?.top ?? 0),
                          content: (
                            <>
                              <div className="tooltip-title">
                                <i style={{ background: segment.color }} /> {segment.label}
                              </div>
                              <TooltipRow label="Share" value={`${(share * 100).toFixed(1)}%`} />
                              <TooltipRow label="Amount" value={segment.display} />
                            </>
                          ),
                        });
                      }}
                    >
                      {share >= 0.09 && <span>{Math.round(share * 100)}%</span>}
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}

const CURVE_HEIGHT = 300;
const CURVE_MARGIN = { top: 18, right: 20, bottom: 44, left: 60 };

/** Cumulative share of spend against share of athletes, ranked by spend. */
export function ConcentrationCurve({
  values,
  marks,
}: {
  values: { label: string; value: number }[];
  marks: number[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const sorted = [...values].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, item) => sum + item.value, 0) || 1;
  const points = [{ x: 0, y: 0, label: '', value: 0 }];
  let running = 0;
  sorted.forEach((item, index) => {
    running += item.value;
    points.push({ x: (index + 1) / sorted.length, y: running / total, ...item });
  });
  const x = linearScale([0, 1], [CURVE_MARGIN.left, width - CURVE_MARGIN.right], 5);
  const y = linearScale([0, 1], [CURVE_HEIGHT - CURVE_MARGIN.bottom, CURVE_MARGIN.top], 4);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join('');
  const at = (share: number) => {
    const index = Math.max(1, Math.round(share * sorted.length));
    return points[index] ?? points[points.length - 1]!;
  };
  const base = CURVE_HEIGHT - CURVE_MARGIN.bottom;
  return (
    <div
      className="chart-canvas"
      ref={ref}
      onMouseLeave={() => (setTooltip(null), setHover(null))}
      onMouseMove={(event) => {
        const box = ref.current?.getBoundingClientRect();
        const px = event.clientX - (box?.left ?? 0);
        const share = (px - CURVE_MARGIN.left) / (width - CURVE_MARGIN.left - CURVE_MARGIN.right);
        const index = Math.round(share * sorted.length);
        const point = points[index];
        if (!point || index === 0) {
          setTooltip(null);
          setHover(null);
          return;
        }
        setHover(index);
        setTooltip({
          x: px,
          y: event.clientY - (box?.top ?? 0),
          content: (
            <>
              <div className="tooltip-title">
                Top {index} of {sorted.length} athletes
              </div>
              <TooltipRow label="Share of athletes" value={`${Math.round(point.x * 100)}%`} />
              <TooltipRow label="Share of spend" value={`${Math.round(point.y * 100)}%`} />
              <TooltipRow label={`#${index}`} value={point.label} />
            </>
          ),
        });
      }}
    >
      <svg
        width={width}
        height={CURVE_HEIGHT}
        className="chart-svg"
        role="img"
        aria-label="Spend concentration"
      >
        {y.ticks.map((tick) => (
          <g key={tick} transform={`translate(0,${y(tick)})`}>
            <line x1={CURVE_MARGIN.left} x2={width - CURVE_MARGIN.right} className="grid-line" />
            <text x={CURVE_MARGIN.left - 12} y={4} textAnchor="end" className="tick-label">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        {x.ticks.map((tick) => (
          <text key={tick} x={x(tick)} y={base + 18} textAnchor="middle" className="tick-label">
            {Math.round(tick * 100)}%
          </text>
        ))}
        <text x={x(0.5)} y={base + 38} textAnchor="middle" className="axis-title">
          Athletes, ranked by spend
        </text>
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="equality-line" />
        <line
          x1={CURVE_MARGIN.left}
          x2={width - CURVE_MARGIN.right}
          y1={base}
          y2={base}
          className="axis-line"
        />
        <path d={`${d}L${x(1)},${base}L${x(0)},${base}Z`} className="curve-area" />
        <path d={d} className="curve-line" />
        {marks.map((share) => {
          const point = at(share);
          return (
            <g key={share} className="curve-mark">
              <line x1={x(point.x)} x2={x(point.x)} y1={base} y2={y(point.y)} />
              <circle cx={x(point.x)} cy={y(point.y)} r={4} />
              <text x={x(point.x) + 8} y={y(point.y) + 14}>
                Top {Math.round(share * 100)}% → {Math.round(point.y * 100)}% of spend
              </text>
            </g>
          );
        })}
        {hover !== null && points[hover] && (
          <circle cx={x(points[hover].x)} cy={y(points[hover].y)} r={4} className="curve-hover" />
        )}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}

export interface DotDatum {
  key: string;
  label: string;
  x: number;
  y: number;
  color: string;
  detail: ReactNode;
}

const DOT_HEIGHT = 320;
const DOT_MARGIN = { top: 18, right: 24, bottom: 44, left: 64 };

/** Log–log dot plot: each dot is an athlete, so outliers on either axis stand apart. */
export function DotPlot({
  dots,
  xTitle,
  yTitle,
  formatX,
  formatY,
  onSelect,
}: {
  dots: DotDatum[];
  xTitle: string;
  yTitle: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  onSelect: (key: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const usable = dots.filter((dot) => dot.x > 0 && dot.y > 0);
  if (usable.length === 0) {
    return (
      <div className="chart-canvas" ref={ref}>
        <p className="muted">No priced runs in this range.</p>
      </div>
    );
  }
  const xs = usable.map((dot) => dot.x);
  const ys = usable.map((dot) => dot.y);
  const x = logScale(
    [Math.min(...xs) / 1.3, Math.max(...xs) * 1.3],
    [DOT_MARGIN.left, width - DOT_MARGIN.right],
  );
  const y = logScale(
    [Math.min(...ys) / 1.3, Math.max(...ys) * 1.3],
    [DOT_HEIGHT - DOT_MARGIN.bottom, DOT_MARGIN.top],
  );
  const base = DOT_HEIGHT - DOT_MARGIN.bottom;
  return (
    <div className="chart-canvas" ref={ref} onMouseLeave={() => (setTooltip(null), setHover(null))}>
      <svg width={width} height={DOT_HEIGHT} className="chart-svg" role="img" aria-label={yTitle}>
        {y.ticks.map((tick) => (
          <g key={tick} transform={`translate(0,${y(tick)})`}>
            <line x1={DOT_MARGIN.left} x2={width - DOT_MARGIN.right} className="grid-line" />
            <text x={DOT_MARGIN.left - 12} y={4} textAnchor="end" className="tick-label">
              {formatY(tick)}
            </text>
          </g>
        ))}
        {x.ticks.map((tick) => (
          <text key={tick} x={x(tick)} y={base + 18} textAnchor="middle" className="tick-label">
            {formatX(tick)}
          </text>
        ))}
        <line
          x1={DOT_MARGIN.left}
          x2={width - DOT_MARGIN.right}
          y1={base}
          y2={base}
          className="axis-line"
        />
        <text
          x={(DOT_MARGIN.left + width) / 2}
          y={base + 38}
          textAnchor="middle"
          className="axis-title"
        >
          {xTitle}
        </text>
        <text
          transform={`translate(14,${(DOT_MARGIN.top + base) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="axis-title"
        >
          {yTitle}
        </text>
        {usable.map((dot) => (
          <g
            key={dot.key}
            className="run-dot"
            role="button"
            tabIndex={0}
            aria-label={dot.label}
            opacity={hover && hover !== dot.key ? 0.35 : 1}
            onClick={() => onSelect(dot.key)}
            onKeyDown={(event) => event.key === 'Enter' && onSelect(dot.key)}
            onMouseMove={(event) => {
              const box = ref.current?.getBoundingClientRect();
              setHover(dot.key);
              setTooltip({
                x: event.clientX - (box?.left ?? 0),
                y: event.clientY - (box?.top ?? 0),
                content: (
                  <>
                    <div className="tooltip-title">
                      <i style={{ background: dot.color }} /> {dot.label}
                    </div>
                    {dot.detail}
                    <div className="tooltip-hint">Click to open</div>
                  </>
                ),
              });
            }}
          >
            <circle cx={x(dot.x)} cy={y(dot.y)} r={12} fill="transparent" />
            <circle
              cx={x(dot.x)}
              cy={y(dot.y)}
              r={5}
              fill={dot.color}
              stroke="var(--bg)"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}

export interface SequenceBar {
  key: string;
  label: string;
  value: number | null;
  count: number;
}

/** Vertical bars on a 0–100% axis, one per request position within a run. */
export function PercentBars({
  bars,
  title,
  color,
  unit,
}: {
  bars: SequenceBar[];
  title: string;
  color: string;
  unit: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const height = 220;
  const margin = { top: 20, right: 12, bottom: 32, left: 60 };
  const y = linearScale([0, 1], [height - margin.bottom, margin.top], 4);
  const plot = width - margin.left - margin.right;
  const step = plot / Math.max(1, bars.length);
  const barWidth = Math.min(44, step - 6);
  const base = height - margin.bottom;
  return (
    <div className="chart-canvas" ref={ref} onMouseLeave={() => setTooltip(null)}>
      <svg width={width} height={height} className="chart-svg" role="img" aria-label={title}>
        {y.ticks.map((tick) => (
          <g key={tick} transform={`translate(0,${y(tick)})`}>
            <line x1={margin.left} x2={width - margin.right} className="grid-line" />
            <text x={margin.left - 12} y={4} textAnchor="end" className="tick-label">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        <line
          x1={margin.left}
          x2={width - margin.right}
          y1={base}
          y2={base}
          className="axis-line"
        />
        {bars.map((bar, index) => {
          const cx = margin.left + index * step + step / 2;
          const top = bar.value === null ? base : y(bar.value);
          return (
            <g
              key={bar.key}
              onMouseMove={(event) => {
                const box = ref.current?.getBoundingClientRect();
                setTooltip({
                  x: event.clientX - (box?.left ?? 0),
                  y: event.clientY - (box?.top ?? 0),
                  content: (
                    <>
                      <div className="tooltip-title">{bar.label}</div>
                      <TooltipRow
                        label="Cache read ÷ input"
                        value={bar.value === null ? '—' : `${(bar.value * 100).toFixed(1)}%`}
                      />
                      <TooltipRow label={unit} value={bar.count.toLocaleString('en-GB')} />
                    </>
                  ),
                });
              }}
            >
              <rect
                x={cx - step / 2}
                y={margin.top}
                width={step}
                height={base - margin.top}
                fill="transparent"
              />
              {bar.value !== null && (
                <>
                  <path
                    d={`M${cx - barWidth / 2},${base}V${top + 3}Q${cx - barWidth / 2},${top} ${cx - barWidth / 2 + 3},${top}H${cx + barWidth / 2 - 3}Q${cx + barWidth / 2},${top} ${cx + barWidth / 2},${top + 3}V${base}Z`}
                    fill={color}
                  />
                  <text x={cx} y={top - 6} textAnchor="middle" className="bar-value">
                    {Math.round(bar.value * 100)}%
                  </text>
                </>
              )}
              <text x={cx} y={base + 18} textAnchor="middle" className="tick-label">
                {bar.key}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
