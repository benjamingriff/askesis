/** Askesis swim-css-v1. See docs/product/swim-css-v1.md for the test and zone bands. */
export const SWIM_CALCULATOR_VERSION = 'swim-css-v1';
export type SwimInput =
  | { method: 'css_test'; t400Seconds: number; t200Seconds: number }
  | { method: 'css_pace'; secondsPer100Metres: number };
export const SWIM_ZONE_KEYS = ['recovery', 'endurance', 'tempo', 'threshold', 'speed'] as const;
export type SwimZone = {
  key: (typeof SWIM_ZONE_KEYS)[number];
  /** Fastest pace in the band, seconds per 100 metres. */
  fast: number;
  target: number;
  /** Slowest pace in the band. */
  slow: number;
};
/** Fractions of critical swim speed (speed, not pace): slowest, target and fastest. */
const BANDS: Record<SwimZone['key'], [number, number, number]> = {
  recovery: [0.77, 0.82, 0.87],
  endurance: [0.87, 0.9, 0.94],
  tempo: [0.95, 0.965, 0.98],
  threshold: [0.99, 1, 1.04],
  speed: [1.05, 1.08, 1.12],
};
export const MIN_CSS_PACE = 55;
export const MAX_CSS_PACE = 300;
const rounded = (value: number) => Math.round(value * 1000) / 1000;

/** Critical swim speed pace in seconds per 100 metres, before range checks. */
export function cssPaceFrom(input: SwimInput): number {
  if (input.method === 'css_pace') return input.secondsPer100Metres;
  // CSS speed = 200 m / (T400 − T200); its pace per 100 m is half the time difference.
  return (input.t400Seconds - input.t200Seconds) / 2;
}

export function calculateSwim(input: SwimInput): {
  calculatorVersion: string;
  cssPace: number;
  zones: SwimZone[];
} {
  if (input.method === 'css_test') {
    const { t400Seconds: t400, t200Seconds: t200 } = input;
    if (!Number.isFinite(t400) || !Number.isFinite(t200) || t200 <= 0 || t400 <= 0)
      throw new Error('Enter positive 400 and 200 times.');
    // Per 100, the 400 must be slower than the 200; otherwise the 200 was not all-out.
    if (t400 <= 2 * t200)
      throw new Error(
        'The 400 should be slower per 100 than the 200. Swim both all-out with full recovery and try again.',
      );
  } else if (!Number.isFinite(input.secondsPer100Metres) || input.secondsPer100Metres <= 0)
    throw new Error('Enter a positive CSS pace.');
  const cssPace = cssPaceFrom(input);
  if (cssPace < MIN_CSS_PACE || cssPace > MAX_CSS_PACE)
    throw new Error(
      'This CSS pace is outside the supported 0:55–5:00 per 100 m range. Check the times and units.',
    );
  return {
    calculatorVersion: SWIM_CALCULATOR_VERSION,
    cssPace: rounded(cssPace),
    zones: SWIM_ZONE_KEYS.map((key) => {
      const [slowest, target, fastest] = BANDS[key];
      return {
        key,
        fast: rounded(cssPace / fastest),
        target: rounded(cssPace / target),
        slow: rounded(cssPace / slowest),
      };
    }),
  };
}
