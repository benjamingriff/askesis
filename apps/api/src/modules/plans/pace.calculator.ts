/** Askesis run-pace-v1. See docs/run-pace-v1.md for equations and range policy. */
export const CALCULATOR_VERSION = 'run-pace-v1';
export const MILE_METRES = 1609.344;
export type PaceInput =
  | { method: 'race_result'; distanceMetres: number; durationSeconds: number }
  | { method: 'threshold_pace'; secondsPerKilometre: number };
export const ZONE_KEYS = ['easy', 'marathon', 'threshold', 'interval', 'repetition'] as const;
export type PaceZone = {
  key: (typeof ZONE_KEYS)[number];
  fast: number;
  target: number;
  slow: number;
};
const oxygen = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;
const fraction = (t: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
const velocity = (cost: number) =>
  (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (cost + 4.6))) / (2 * 0.000104);
const rounded = (value: number) => Math.round(value * 1000) / 1000;

export function calculatePaces(input: PaceInput): {
  calculatorVersion: string;
  fitness: number;
  zones: PaceZone[];
} {
  let fitness: number;
  if (input.method === 'race_result') {
    if (
      !Number.isFinite(input.distanceMetres) ||
      input.distanceMetres < MILE_METRES ||
      input.distanceMetres > 42195 ||
      !Number.isInteger(input.durationSeconds) ||
      input.durationSeconds <= 0
    ) {
      throw new Error('Enter a race from one mile through marathon and a positive finish time.');
    }
    const minutes = input.durationSeconds / 60;
    fitness = oxygen(input.distanceMetres / minutes) / fraction(minutes);
  } else {
    if (!Number.isFinite(input.secondsPerKilometre) || input.secondsPerKilometre <= 0)
      throw new Error('Enter a positive threshold pace.');
    fitness = oxygen(60000 / input.secondsPerKilometre) / fraction(60);
  }
  if (!Number.isFinite(fitness) || fitness < 10 || fitness > 100)
    throw new Error(
      'This input is outside the supported running pace range. Check the units and time.',
    );
  // Marathon is the equivalent current-fitness race speed, found by bounded bisection.
  let low = 60;
  let high = 1500;
  for (let i = 0; i < 80; i++) {
    const t = (low + high) / 2;
    if (oxygen(42195 / t) / fraction(t) > fitness) low = t;
    else high = t;
  }
  const targets = [
    60000 / velocity(fitness * 0.67),
    (((low + high) / 2) * 60) / 42.195,
    60000 / velocity(fitness * fraction(60)),
    60000 / velocity(fitness),
    60000 / velocity(fitness * 1.1),
  ];
  const widths = [0.06, 0.02, 0.015, 0.01, 0.0075];
  return {
    calculatorVersion: CALCULATOR_VERSION,
    fitness: rounded(fitness),
    zones: ZONE_KEYS.map((key, i) => ({
      key,
      fast: rounded(targets[i]! / (1 + widths[i]!)),
      target: rounded(targets[i]!),
      slow: rounded(targets[i]! / (1 - widths[i]!)),
    })),
  };
}

export function planToday(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
