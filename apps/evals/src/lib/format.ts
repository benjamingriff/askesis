import type { Verdict } from '../types';

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return String(Math.round(value));
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 10) return `${trim(minutes)}m`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
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

export function formatDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatDistance(metres: number | null): string {
  if (metres === null) return '';
  return `${trim(metres / 1000)} km`;
}

export function humanize(id: string): string {
  const text = id.replace(/[_-]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function trim(value: number): string {
  return value >= 100
    ? value.toFixed(0)
    : value >= 10
      ? value.toFixed(1).replace(/\.0$/, '')
      : value.toFixed(2).replace(/\.?0+$/, '');
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  acceptable: 'Acceptable',
  needs_revision: 'Needs revision',
  incomplete: 'Incomplete',
  assessment_unavailable: 'No assessment',
  running: 'Unfinished',
};

export const VERDICT_GLYPH: Record<Verdict, string> = {
  acceptable: '✓',
  needs_revision: '!',
  incomplete: '✕',
  assessment_unavailable: '?',
  running: '•',
};

export const VERDICT_ORDER: Verdict[] = [
  'acceptable',
  'needs_revision',
  'incomplete',
  'assessment_unavailable',
  'running',
];

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
