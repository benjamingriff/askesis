import { useState } from 'react';

/** Collapsed-by-default JSON payload, for tool inputs and results. */
export function JsonView({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="json-view">
      <button
        type="button"
        className="json-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {label}
        <small>
          {text.length > 1024 ? `${(text.length / 1024).toFixed(1)} kB` : `${text.length} B`}
        </small>
      </button>
      {open && <pre>{text}</pre>}
    </div>
  );
}
