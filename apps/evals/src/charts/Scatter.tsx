import { useMemo, useState } from 'react';
import { reasoningRank, reasoningShort } from '../lib/models';
import { linearScale, logScale, paddedDomain } from './scale';
import { Tooltip, TooltipRow, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

export interface ScatterRun {
  id: string;
  x: number;
  y: number;
  model: string;
  reasoning: string;
  color: string;
  demo: boolean;
  label: string;
}

export interface ScatterGroup {
  key: string;
  model: string;
  modelLabel: string;
  reasoning: string;
  color: string;
  x: number;
  y: number;
  runs: number;
  acceptable: number;
  demo: boolean;
}

interface ScatterProps {
  runs: ScatterRun[];
  groups: ScatterGroup[];
  log: boolean;
  pareto: boolean;
  xTitle: string;
  yTitle: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  highlighted: string | null;
  onHighlight: (model: string | null) => void;
  onSelectRun: (id: string) => void;
}

const HEIGHT = 470;
const MARGIN = { top: 30, right: 128, bottom: 60, left: 64 };

/** Non-dominated groups: no other group scores higher for less of the cost axis. */
export function paretoFront<T extends { x: number; y: number }>(points: T[]): T[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || b.y - a.y);
  const front: T[] = [];
  let best = -Infinity;
  for (const point of sorted) {
    if (point.y > best) {
      front.push(point);
      best = point.y;
    }
  }
  return front;
}

export function Scatter(props: ScatterProps) {
  const { runs, groups, log, pareto, highlighted } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const layout = useMemo(() => {
    const xs = [...runs.map((run) => run.x), ...groups.map((group) => group.x)].filter(
      (x) => x > 0,
    );
    const ys = [...runs.map((run) => run.y), ...groups.map((group) => group.y)];
    const xDomain = xs.length > 0 ? paddedDomain(xs, log) : ([1, 10] as [number, number]);
    const yMin = ys.length > 0 ? Math.min(...ys) : 0;
    const yDomain: [number, number] = [Math.max(0, Math.floor((yMin - 0.05) * 10) / 10), 1];
    const range: [number, number] = [MARGIN.left, width - MARGIN.right];
    const x = log ? logScale(xDomain, range) : linearScale(xDomain, range, 7);
    const y = linearScale(yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top], 5);
    const byModel = new Map<string, ScatterGroup[]>();
    for (const group of groups) {
      byModel.set(group.model, [...(byModel.get(group.model) ?? []), group]);
    }
    for (const list of byModel.values()) {
      list.sort((a, b) => reasoningRank(a.reasoning) - reasoningRank(b.reasoning));
    }
    // End-of-line labels: nudge apart vertically when they would overlap.
    const labels = [...byModel.entries()]
      .map(([model, list]) => {
        const last = list[list.length - 1];
        return last ? { model, x: x(last.x) + 12, y: y(last.y) + 4 } : null;
      })
      .filter((label) => label !== null)
      .sort((a, b) => a.y - b.y);
    const labelY = new Map<string, number>();
    const placed: { x: number; y: number }[] = [];
    for (const label of labels) {
      let top = label.y;
      for (const other of placed) {
        if (Math.abs(other.x - label.x) < 120 && top - other.y < 14) top = other.y + 14;
      }
      placed.push({ x: label.x, y: top });
      labelY.set(label.model, top);
    }
    return { x, y, byModel, labelY, front: pareto ? paretoFront(groups) : [] };
  }, [runs, groups, log, pareto, width]);

  const { x, y, byModel, labelY, front } = layout;
  const dim = (model: string) => highlighted !== null && highlighted !== model;
  const plotRight = width - MARGIN.right;

  return (
    <div className="chart-canvas" ref={ref} onMouseLeave={() => setTooltip(null)}>
      <svg
        width={width}
        height={HEIGHT}
        className="chart-svg"
        role="img"
        aria-label={`${props.yTitle} versus ${props.xTitle}`}
      >
        <text x={MARGIN.left} y={16} className="axis-title">
          {props.yTitle}
        </text>
        {y.ticks.map((tick) => (
          <g key={`y${tick}`} transform={`translate(0,${y(tick)})`}>
            <line x1={MARGIN.left} x2={plotRight} className="grid-line" />
            <text x={MARGIN.left - 14} y={4} textAnchor="end" className="tick-label">
              {props.formatY(tick)}
            </text>
          </g>
        ))}
        {x.ticks.map((tick) => (
          <g key={`x${tick}`} transform={`translate(${x(tick)},${HEIGHT - MARGIN.bottom})`}>
            <line y2={5} className="axis-line" />
            <text y={24} textAnchor="middle" className="tick-label">
              {props.formatX(tick)}
            </text>
          </g>
        ))}
        <line
          x1={MARGIN.left}
          x2={plotRight}
          y1={HEIGHT - MARGIN.bottom}
          y2={HEIGHT - MARGIN.bottom}
          className="axis-line"
        />
        <text
          x={(MARGIN.left + plotRight) / 2}
          y={HEIGHT - 12}
          textAnchor="middle"
          className="axis-title"
        >
          {props.xTitle}
        </text>

        {front.length > 1 && (
          <path
            d={front
              .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.x)},${y(point.y)}`)
              .join('')}
            className="pareto-line"
          />
        )}

        {runs.map((run) => (
          <circle
            key={run.id}
            cx={x(run.x)}
            cy={y(run.y)}
            r={3}
            fill={run.color}
            opacity={dim(run.model) ? 0.08 : 0.35}
            className="run-dot"
            onMouseEnter={(event) =>
              setTooltip({
                x: event.nativeEvent.offsetX,
                y: event.nativeEvent.offsetY,
                content: (
                  <>
                    <div className="tooltip-title">
                      <i style={{ background: run.color }} /> {run.label}
                    </div>
                    <TooltipRow label="Score" value={props.formatY(run.y)} />
                    <TooltipRow label={props.xTitle} value={props.formatX(run.x)} />
                    <div className="tooltip-hint">Click to open run{run.demo ? ' · demo' : ''}</div>
                  </>
                ),
              })
            }
            onClick={() => props.onSelectRun(run.id)}
          />
        ))}

        {[...byModel.entries()].map(([model, list]) => {
          const last = list[list.length - 1];
          const color = list[0]?.color ?? 'currentColor';
          return (
            <g
              key={model}
              opacity={dim(model) ? 0.15 : 1}
              onMouseEnter={() => props.onHighlight(model)}
              onMouseLeave={() => props.onHighlight(null)}
            >
              {list.length > 1 && (
                <path
                  d={list
                    .map((group, index) => `${index === 0 ? 'M' : 'L'}${x(group.x)},${y(group.y)}`)
                    .join('')}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  opacity={0.75}
                />
              )}
              {list.map((group) => (
                <g
                  key={group.key}
                  className="group-point"
                  tabIndex={0}
                  role="button"
                  aria-label={`${group.modelLabel} ${group.reasoning}: score ${props.formatY(group.y)}, ${props.formatX(group.x)}`}
                  onMouseEnter={() =>
                    setTooltip({
                      x: x(group.x),
                      y: y(group.y),
                      content: (
                        <>
                          <div className="tooltip-title">
                            <i style={{ background: group.color }} /> {group.modelLabel}
                            <span className="tooltip-sub">{group.reasoning}</span>
                          </div>
                          <TooltipRow label="Median score" value={props.formatY(group.y)} />
                          <TooltipRow
                            label={`Median ${props.xTitle.toLowerCase()}`}
                            value={props.formatX(group.x)}
                          />
                          <TooltipRow
                            label="Acceptable"
                            value={`${group.acceptable}/${group.runs} runs`}
                          />
                          {group.demo && <div className="tooltip-hint">Demo data</div>}
                        </>
                      ),
                    })
                  }
                >
                  <circle cx={x(group.x)} cy={y(group.y)} r={13} fill="transparent" />
                  <circle
                    cx={x(group.x)}
                    cy={y(group.y)}
                    r={5}
                    fill={group.demo ? 'var(--bg)' : group.color}
                    stroke={group.demo ? group.color : 'var(--bg)'}
                    strokeWidth={group.demo ? 2 : 1.8}
                  />
                  {list.length > 1 && (
                    <text
                      x={x(group.x)}
                      y={y(group.y) - 10}
                      textAnchor="middle"
                      className="point-label"
                    >
                      {reasoningShort(group.reasoning)}
                    </text>
                  )}
                </g>
              ))}
              {last && (
                <text
                  x={x(last.x) + 12}
                  y={labelY.get(model) ?? y(last.y) + 4}
                  className="series-label"
                >
                  {last.modelLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
