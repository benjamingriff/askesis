import { useState } from 'react';
import { Tooltip, TooltipRow, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

export interface HeatCell {
  passed: number;
  total: number;
}

export interface HeatRow {
  key: string;
  label: string;
  color: string;
  cells: (HeatCell | null)[];
}

/** Pass-rate matrix on a single-hue sequential ramp. */
export function Heatmap({ columns, rows }: { columns: string[]; rows: HeatRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  return (
    <div className="chart-canvas heatmap-wrap" ref={ref} onMouseLeave={() => setTooltip(null)}>
      <div
        className="heatmap"
        style={{
          gridTemplateColumns: `minmax(130px, 1.3fr) repeat(${columns.length}, minmax(52px, 1fr))`,
        }}
      >
        <div />
        {columns.map((column) => (
          <div key={column} className="heat-head">
            {column}
          </div>
        ))}
        {rows.map((row) => (
          <div className="heat-row" key={row.key}>
            <div className="heat-label">
              <i className="model-dot" style={{ background: row.color }} />
              {row.label}
            </div>
            {row.cells.map((cell, index) => {
              const rate = cell && cell.total > 0 ? cell.passed / cell.total : null;
              const column = columns[index] ?? '';
              return (
                <div
                  key={column}
                  className="heat-cell"
                  data-empty={rate === null}
                  data-strong={rate !== null && rate >= 0.6}
                  style={rate === null ? undefined : { ['--rate' as string]: rate }}
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
                            label={column}
                            value={
                              rate === null
                                ? 'Not assessed'
                                : `${cell?.passed}/${cell?.total} passed`
                            }
                          />
                        </>
                      ),
                    });
                  }}
                >
                  {rate === null ? '—' : Math.round(rate * 100)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
