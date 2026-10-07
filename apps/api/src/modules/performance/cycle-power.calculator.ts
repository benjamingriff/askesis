/** Askesis cycle-power-v1. See docs/product/cycle-power-v1.md for the protocol factors and zones. */
export const CYCLE_CALCULATOR_VERSION = 'cycle-power-v1';
export type PowerInput =
  | { method: 'ftp'; watts: number }
  | { method: 'twenty_minute_test'; averageWatts: number }
  | { method: 'ramp_test'; bestMinuteWatts: number };
export const POWER_ZONE_KEYS = [
  'recovery',
  'endurance',
  'tempo',
  'sweet_spot',
  'threshold',
  'vo2max',
  'anaerobic',
] as const;
export type PowerZone = {
  key: (typeof POWER_ZONE_KEYS)[number];
  minimum: number;
  target: number;
  maximum: number;
};
/** Coggan power levels as fractions of FTP, with a sweet-spot band between tempo and threshold. */
const BANDS: Record<PowerZone['key'], [number, number, number]> = {
  recovery: [0.4, 0.5, 0.55],
  endurance: [0.56, 0.65, 0.75],
  tempo: [0.76, 0.83, 0.9],
  sweet_spot: [0.88, 0.91, 0.94],
  threshold: [0.91, 1, 1.05],
  vo2max: [1.06, 1.13, 1.2],
  anaerobic: [1.21, 1.35, 1.5],
};
export const MIN_FTP = 50;
export const MAX_FTP = 600;

/** Functional threshold power implied by an input, before range checks. */
export function ftpFrom(input: PowerInput): number {
  if (input.method === 'ftp') return input.watts;
  if (input.method === 'twenty_minute_test') return input.averageWatts * 0.95;
  return input.bestMinuteWatts * 0.75;
}

export function calculatePower(input: PowerInput): {
  calculatorVersion: string;
  ftp: number;
  zones: PowerZone[];
} {
  const raw = ftpFrom(input);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('Enter a positive power in watts.');
  const ftp = Math.round(raw);
  if (ftp < MIN_FTP || ftp > MAX_FTP)
    throw new Error(
      `This gives an FTP of ${ftp} W, outside the supported ${MIN_FTP}–${MAX_FTP} W range. Check the test and units.`,
    );
  return {
    calculatorVersion: CYCLE_CALCULATOR_VERSION,
    ftp,
    zones: POWER_ZONE_KEYS.map((key) => {
      const [minimum, target, maximum] = BANDS[key];
      return {
        key,
        minimum: Math.round(ftp * minimum),
        target: Math.round(ftp * target),
        maximum: Math.round(ftp * maximum),
      };
    }),
  };
}
