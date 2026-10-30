export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return String(Math.round(value));
}

export function formatPercent(value: number | null, digits = 0): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function trim(value: number): string {
  return value >= 100
    ? value.toFixed(0)
    : value >= 10
      ? value.toFixed(1).replace(/\.0$/, '')
      : value.toFixed(2).replace(/\.?0+$/, '');
}
