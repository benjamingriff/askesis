import { useState } from 'react';
import { Tooltip, TooltipRow, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

export interface StackSegment {
  key: string;
  label: string;
  glyph: string;
  value: number;
  className: string;
}

export interface StackRow {
  key: string;
  label: string;
  color: string;
  segments: StackSegment[];
}

/** Horizontal 100% stacks, one row per entity. */
export function StackedBars({ rows, unit }: { rows: StackRow[]; unit: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  return (
    <div className="chart-canvas stacked" ref={ref} onMouseLeave={() => setTooltip(null)}>
      {rows.map((row) => {
        const total = row.segments.reduce((sum, segment) => sum + segment.value, 0);
        return (
          <div className="stack-row" key={row.key}>
            <div className="stack-label">
              <i className="model-dot" style={{ background: row.color }} />
              <span>{row.label}</span>
              <small>{total}</small>
            </div>
            <div className="stack-track">
              {row.segments
                .filter((segment) => segment.value > 0)
                .map((segment) => {
                  const share = Math.round((segment.value / total) * 100);
                  return (
                    <div
                      key={segment.key}
                      className={`stack-segment ${segment.className}`}
                      style={{ flexGrow: segment.value }}
                      onMouseMove={(event) => {
                        const box = ref.current?.getBoundingClientRect();
                        setTooltip({
                          x: event.clientX - (box?.left ?? 0),
                          y: event.clientY - (box?.top ?? 0),
                          content: (
                            <>
                              <div className="tooltip-title">
                                <i style={{ background: row.color }} /> {row.label}
                              </div>
                              <TooltipRow
                                label={`${segment.glyph} ${segment.label}`}
                                value={`${segment.value} ${unit} · ${share}%`}
                              />
                            </>
                          ),
                        });
                      }}
                    >
                      {segment.value / total >= 0.12 && (
                        <span>
                          {segment.glyph} {share}%
                        </span>
                      )}
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
