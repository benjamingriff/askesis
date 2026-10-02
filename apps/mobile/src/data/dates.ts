// Dates are handled as local ISO strings (yyyy-mm-dd) and parsed at noon to dodge DST edges.

const DAY_MS = 86_400_000;

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
export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(iso: string, days: number): string {
  return toISO(new Date(parseISO(iso).getTime() + days * DAY_MS));
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(iso: string): number {
  return (parseISO(iso).getDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function dayNumber(iso: string): number {
  return parseISO(iso).getDate();
}

export function formatShort(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function formatLong(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAYS_LONG[weekdayIndex(iso)]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

export function formatRange(fromISO: string, toISO_: string): string {
  const a = parseISO(fromISO);
  const b = parseISO(toISO_);
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Calendar grid (Mon-first) for the month containing `iso`; always whole weeks. */
export function monthGrid(iso: string): string[][] {
  const d = parseISO(iso);
  const first = toISO(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  const last = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  const weeks: string[][] = [];
  let cursor = startOfWeek(first);
  while (cursor <= last) {
    weeks.push(weekDates(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function shiftMonth(iso: string, delta: number): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + delta, 1, 12));
}

export function monthTitle(iso: string): string {
  const d = parseISO(iso);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;
  return formatShort(toISO(new Date(ts)));
}
