import type { z } from '@hono/zod-openapi';
import { PlanError } from '../plans/plan.common.js';
import { calculatePaces, ZONE_KEYS } from './run-pace.calculator.js';
import type {
  CalibrationInput,
  PaceInputSchema,
  PerformanceSystem,
} from './performance.schemas.js';

export type CalculatedZone = {
  key: string;
  metric: string;
  unit: string;
  minimum: number;
  target: number;
  maximum: number;
};
export type Calculation = {
  method: string;
  calculatorVersion: string;
  fitness: number | null;
  zones: CalculatedZone[];
};
type Calibrator<Input> = {
  /** The workout discipline whose plans need this system calibrated before locking. */
  discipline: string;
  /** Zones from easiest to hardest, the order they are presented in. */
  zoneKeys: readonly string[];
  calculate(input: Input): Calculation;
};

/**
 * Each performance system turns its evidence into named zones with a deterministic, versioned
 * calculator. Workouts reference zones symbolically as (system, key); new sports add a system.
 */
export const CALIBRATORS: {
  run_pace: Calibrator<z.infer<typeof PaceInputSchema>>;
} = {
  run_pace: {
    discipline: 'run',
    zoneKeys: ZONE_KEYS,
    calculate(input) {
      const result = calculatePaces(input);
      return {
        method: input.method,
        calculatorVersion: result.calculatorVersion,
        fitness: result.fitness,
        zones: result.zones.map((zone) => ({
          key: zone.key,
          metric: 'pace',
          unit: 'seconds_per_kilometre',
          minimum: zone.fast,
          target: zone.target,
          maximum: zone.slow,
        })),
      };
    },
  },
};

export function systemsForDiscipline(discipline: string): PerformanceSystem[] {
  return (Object.keys(CALIBRATORS) as PerformanceSystem[]).filter(
    (system) => CALIBRATORS[system].discipline === discipline,
  );
}

export function calibrate(input: Pick<CalibrationInput, 'system' | 'input'>): Calculation {
  try {
    return CALIBRATORS[input.system].calculate(input.input);
  } catch (error) {
    throw new PlanError('CALIBRATION_INVALID', (error as Error).message, 422);
  }
}
