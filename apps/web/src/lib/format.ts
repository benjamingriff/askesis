import type { Units } from '../settings';

export const METRES_PER_MILE = 1609.344;
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

// ---- Dates (ISO yyyy-mm-dd, interpreted as calendar dates in UTC) ------------------------------

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const value = utc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return iso(value);
}

/** Monday = 0. */
export function weekdayIndex(date: string): number {
  return (utc(date).getUTCDay() + 6) % 7;
}

export function startOfWeek(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

export function dayNumber(date: string): number {
  return utc(date).getUTCDate();
}

const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const shortFormat = formatter({ day: 'numeric', month: 'short' });
const shortYearFormat = formatter({ day: 'numeric', month: 'short', year: 'numeric' });
const longFormat = formatter({ weekday: 'long', day: 'numeric', month: 'long' });
const monthFormat = formatter({ month: 'long', year: 'numeric' });

export const formatShort = (date: string) => shortFormat.format(utc(date));
export const formatShortYear = (date: string) => shortYearFormat.format(utc(date));
export const formatLong = (date: string) => longFormat.format(utc(date));
export const formatMonth = (date: string) => monthFormat.format(utc(date));

export function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'No dates set';
  if (!start || !end)
    return start ? `From ${formatShortYear(start)}` : `Until ${formatShortYear(end!)}`;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? formatShort(start) : formatShortYear(start)} – ${formatShortYear(end)}`;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function relativeTime(value: string): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return formatShort(new Date(value).toISOString().slice(0, 10));
}

export function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function monthGrid(month: string): string[][] {
  const first = `${month.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => addDays(start, row * 7 + column)),
  );
}

export function shiftMonth(month: string, delta: number): string {
  const value = utc(`${month.slice(0, 7)}-01`);
  value.setUTCMonth(value.getUTCMonth() + delta);
  return iso(value);
}

// ---- Distance, duration and pace -------------------------------------------------------------

export function distanceValue(metres: number, units: Units): number {
  return units === 'mi' ? metres / METRES_PER_MILE : metres / 1000;
}

export function formatDistance(metres: number | null, units: Units, withUnit = true): string {
  if (metres === null) return '—';
  const value = distanceValue(metres, units);
  const text = value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  return withUnit ? `${text} ${units}` : text;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${String(rest).padStart(2, '0')}` : `${hours}h`;
}

export function formatClock(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Seconds per kilometre → "m:ss/km" or "m:ss/mi". */
export function formatPace(secondsPerKm: number, units: Units, withUnit = true): string {
  const seconds = Math.round(secondsPerKm * (units === 'mi' ? METRES_PER_MILE / 1000 : 1));
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return withUnit ? `${text}/${units}` : text;
}

export function briefUnits(unit: 'kilometres' | 'miles' | undefined | null): Units {
  return unit === 'miles' ? 'mi' : 'km';
}
