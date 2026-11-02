import type { ReactNode } from 'react';

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

export function Tooltip({ state, width }: { state: TooltipState | null; width: number }) {
  if (!state) return null;
  const flip = state.x > width - 240;
  return (
    <div
      className="chart-tooltip"
      style={{
        left: flip ? undefined : state.x + 14,
        right: flip ? width - state.x + 14 : undefined,
        top: Math.max(0, state.y - 12),
      }}
      role="status"
    >
      {state.content}
    </div>
  );
}

export function TooltipRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="tooltip-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
