import { useState } from 'react';
import { Tooltip, TooltipRow, type TooltipState } from '../../charts/Tooltip';
import { useWidth } from '../../charts/useWidth';
import { formatDuration, formatTokens, humanize } from '../../lib/format';
import type { CoachTurn, RunDetail } from '../../types';

const LANES = ['Athlete', 'Coach', 'Tools', 'Plan'] as const;
const LANE_HEIGHT = 34;
const TOP = 8;
const LEFT = 78;
const RIGHT = 16;
const AXIS = 26;

function at(value: string | null | undefined): number | null {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Where the conversation's time went: athlete replies, coach turns split into
 * queueing and model/tool execution, individual tool calls and plan writes.
 */
export function Timeline({
  run,
  selectedTurn,
  onSelectTurn,
}: {
  run: RunDetail;
  selectedTurn: number | null;
  onSelectTurn: (turn: CoachTurn) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const times = [
    ...run.messages.map((message) => at(message.createdAt)),
    ...run.turns.flatMap((turn) => [at(turn.createdAt), at(turn.finishedAt)]),
  ].filter((value): value is number => value !== null);
  if (times.length < 2) return <p className="muted">Not enough timing data to draw a timeline.</p>;
  const start = Math.min(...times);
  const end = Math.max(...times);
  const span = Math.max(1, end - start);
  const x = (time: number) => LEFT + ((time - start) / span) * (width - LEFT - RIGHT);
  const laneY = (index: number) => TOP + index * LANE_HEIGHT;
  const height = TOP + LANES.length * LANE_HEIGHT + AXIS;
  const ticks = Array.from({ length: 6 }, (_, index) => (span / 5) * index);
  const factsBySequence = new Map(run.disclosures.map((entry) => [entry.sequence, entry]));
  const show = (event: React.MouseEvent, content: TooltipState['content']) => {
    const box = ref.current?.getBoundingClientRect();
    setTooltip({
      x: event.clientX - (box?.left ?? 0),
      y: event.clientY - (box?.top ?? 0),
      content,
    });
  };

  return (
    <div className="chart-canvas" ref={ref} onMouseLeave={() => setTooltip(null)}>
      <svg
        width={width}
        height={height}
        className="chart-svg timeline"
        role="img"
        aria-label="Conversation timeline"
      >
        {LANES.map((lane, index) => (
          <g key={lane}>
            <line
              x1={LEFT}
              x2={width - RIGHT}
              y1={laneY(index) + LANE_HEIGHT - 0.5}
              y2={laneY(index) + LANE_HEIGHT - 0.5}
              className="lane-line"
            />
            <text x={0} y={laneY(index) + LANE_HEIGHT / 2 + 4} className="tick-label">
              {lane}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <g
            key={tick}
            transform={`translate(${x(start + tick)},${TOP + LANES.length * LANE_HEIGHT})`}
          >
            <line y2={5} className="axis-line" />
            <text y={19} textAnchor="middle" className="tick-label">
              {tick === 0 ? '0' : formatDuration(tick)}
            </text>
          </g>
        ))}

        {run.messages
          .filter((message) => message.role === 'user')
          .map((message) => {
            const time = at(message.createdAt);
            if (time === null) return null;
            const disclosure = factsBySequence.get(message.sequence);
            const cx = x(time);
            const cy = laneY(0) + LANE_HEIGHT / 2;
            const kind = disclosure?.kind ?? (message.sequence === 1 ? 'opening' : 'answer');
            return (
              <g
                key={message.sequence}
                className={`athlete-mark athlete-${kind}`}
                onMouseMove={(event) =>
                  show(
                    event,
                    <>
                      <div className="tooltip-title">Athlete · message {message.sequence}</div>
                      {kind === 'opening' && <div className="tooltip-hint">Opening request</div>}
                      {disclosure && disclosure.factIds.length > 0 && (
                        <TooltipRow
                          label="Disclosed"
                          value={disclosure.factIds.map(humanize).join(', ')}
                        />
                      )}
                      {kind === 'nudge' && (
                        <div className="tooltip-hint">Asked the coach to go ahead</div>
                      )}
                      {kind === 'unknown' && (
                        <div className="tooltip-hint">Could not answer the question</div>
                      )}
                    </>,
                  )
                }
              >
                <path d={`M${cx},${cy - 6}L${cx + 6},${cy}L${cx},${cy + 6}L${cx - 6},${cy}Z`} />
                {disclosure && disclosure.factIds.length > 0 && (
                  <text x={cx} y={cy - 9} textAnchor="middle" className="point-label">
                    {disclosure.factIds.length}
                  </text>
                )}
              </g>
            );
          })}

        {run.turns.map((turn) => {
          const created = at(turn.createdAt);
          const started = at(turn.startedAt) ?? created;
          const finished = at(turn.finishedAt);
          if (started === null || finished === null) return null;
          const y = laneY(1) + 7;
          const h = LANE_HEIGHT - 14;
          const x0 = x(created ?? started);
          const x1 = x(started);
          const x2 = Math.max(x(finished), x1 + 2);
          const selected = selectedTurn === turn.index;
          return (
            <g
              key={turn.runId}
              className={`turn-bar${selected ? ' selected' : ''}${turn.status !== 'completed' ? ' failed' : ''}`}
              onClick={() => onSelectTurn(turn)}
              onMouseMove={(event) =>
                show(
                  event,
                  <>
                    <div className="tooltip-title">Coach · turn {turn.index}</div>
                    <TooltipRow label="Duration" value={formatDuration(turn.durationMs)} />
                    {turn.queueWaitMs !== null && (
                      <TooltipRow label="Queue wait" value={formatDuration(turn.queueWaitMs)} />
                    )}
                    <TooltipRow label="Model calls" value={turn.modelMs.length} />
                    <TooltipRow
                      label="Tokens"
                      value={`${formatTokens(turn.inputTokens)} in · ${formatTokens(turn.outputTokens)} out`}
                    />
                    <TooltipRow label="Tools" value={turn.tools.length} />
                    <div className="tooltip-hint">Click to inspect</div>
                  </>,
                )
              }
            >
              {x1 - x0 > 0.5 && (
                <rect x={x0} y={y} width={x1 - x0} height={h} className="turn-queue" rx={2} />
              )}
              <rect x={x1} y={y} width={x2 - x1} height={h} rx={3} className="turn-run" />
              {x2 - x1 > 22 && (
                <text
                  x={(x1 + x2) / 2}
                  y={y + h / 2 + 4}
                  textAnchor="middle"
                  className="turn-label"
                >
                  T{turn.index}
                </text>
              )}
            </g>
          );
        })}

        {run.turns.flatMap((turn) =>
          turn.tools.map((tool) => {
            const time = at(tool.at);
            if (time === null) return null;
            const cx = x(time);
            const y = laneY(2) + LANE_HEIGHT / 2;
            return (
              <g
                key={tool.operationId}
                className={`tool-mark tool-${tool.kind}${tool.status === 'failed' ? ' failed' : ''}`}
                onClick={() => onSelectTurn(turn)}
                onMouseMove={(event) =>
                  show(
                    event,
                    <>
                      <div className="tooltip-title">{tool.name}</div>
                      <div className="tooltip-hint">{tool.summary}</div>
                      <TooltipRow label="Turn" value={turn.index} />
                      <TooltipRow label="Status" value={tool.status} />
                      {tool.elapsedMs !== null && (
                        <TooltipRow label="Elapsed" value={`${Math.round(tool.elapsedMs)} ms`} />
                      )}
                    </>,
                  )
                }
              >
                <rect x={cx - 2} y={y - 8} width={4} height={16} rx={1.5} />
              </g>
            );
          }),
        )}

        {run.decisions
          .filter(
            (decision) =>
              decision.status === 'completed' && !/^(read|preview|check)_/.test(decision.tool),
          )
          .map((decision, index) => {
            const time = at(decision.at);
            if (time === null) return null;
            const cx = x(time);
            const y = laneY(3) + LANE_HEIGHT / 2;
            return (
              <g
                key={`${decision.at}-${index}`}
                className={`plan-mark plan-${decision.tool}`}
                onMouseMove={(event) =>
                  show(
                    event,
                    <>
                      <div className="tooltip-title">{decision.title}</div>
                      {decision.changes.length > 0 && (
                        <TooltipRow
                          label="Fields changed"
                          value={decision.changes.map((change) => change.field).join(', ')}
                        />
                      )}
                    </>,
                  )
                }
              >
                <circle cx={cx} cy={y} r={decision.tool === 'apply_schedule_changes' ? 6 : 4} />
              </g>
            );
          })}
      </svg>
      <div className="legend">
        <span>
          <i className="legend-swatch athlete" /> Athlete message (number = facts disclosed)
        </span>
        <span>
          <i className="legend-swatch queue" /> Queued
        </span>
        <span>
          <i className="legend-swatch run" /> Coach working
        </span>
        <span>
          <i className="legend-swatch write" /> Write tool
        </span>
        <span>
          <i className="legend-swatch read" /> Read tool
        </span>
        <span>
          <i className="legend-swatch plan" /> Plan change
        </span>
      </div>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
