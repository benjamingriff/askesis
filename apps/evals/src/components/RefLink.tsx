import type { ReactNode } from 'react';
import { focusRef, refLabel } from '../lib/refs';

/** A clickable evidence reference that scrolls to and highlights its target. */
export function RefLink({
  refId,
  children,
  onSelect,
}: {
  refId: string;
  children?: ReactNode;
  onSelect?: (ref: string) => void;
}) {
  return (
    <button
      type="button"
      className="ref-link"
      title={refId}
      onClick={() => {
        onSelect?.(refId);
        // Let a selection-driven re-render land before scrolling.
        window.requestAnimationFrame(() => focusRef(refId));
      }}
    >
      {children ?? refLabel(refId)}
    </button>
  );
}
