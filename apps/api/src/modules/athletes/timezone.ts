/**
 * A device-reported IANA timezone, or null when it is not one. The name is kept as reported:
 * ICU builds disagree about canonical aliases, and any valid alias gives the same dates.
 */
export function validTimezone(value: string | null | undefined): string | null {
  if (!value || value.length > 100 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** The athlete's calendar date: "today" for effective dates and coaching context. */
export function localDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
