import type { z } from '@hono/zod-openapi';
import { PlanError } from '../plans/plan.common.js';
import type { StepDiscipline } from '../plans/disciplines.js';
import { calculatePower, POWER_ZONE_KEYS } from './cycle-power.calculator.js';
import { calculatePaces, ZONE_KEYS } from './run-pace.calculator.js';
import { calculateSwim, SWIM_ZONE_KEYS } from './swim-pace.calculator.js';
import type {
  CalibrationInput,
  PaceInputSchema,
  PerformanceSystem,
  PowerInputSchema,
  SwimInputSchema,
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
  /** The sport whose workouts resolve zones in this system and need it calibrated to lock. */
  discipline: StepDiscipline;
  /** Zones from easiest to hardest, the order they are presented in. */
  zoneKeys: readonly string[];
  /** What the athlete is asked for when a plan cannot lock without this system. */
  requirement: string;
  calculate(input: Input): Calculation;
};

/**
 * Each performance system turns its evidence into named zones with a deterministic, versioned
 * calculator. Workouts reference zones symbolically as (system, key); new sports add a system.
 */
export const CALIBRATORS: {
  run_pace: Calibrator<z.infer<typeof PaceInputSchema>>;
  cycle_power: Calibrator<z.infer<typeof PowerInputSchema>>;
  swim_pace: Calibrator<z.infer<typeof SwimInputSchema>>;
} = {
  run_pace: {
    discipline: 'run',
    zoneKeys: ZONE_KEYS,
    requirement: 'Add a race result or estimated threshold pace on the Performance page.',
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
  cycle_power: {
    discipline: 'cycle',
    zoneKeys: POWER_ZONE_KEYS,
    requirement: 'Add an FTP, a power test or an estimated FTP on the Performance page.',
    calculate(input) {
      const result = calculatePower(input);
      return {
        method: input.method,
        calculatorVersion: result.calculatorVersion,
        fitness: result.ftp,
        zones: result.zones.map((zone) => ({ ...zone, metric: 'power', unit: 'watts' })),
      };
    },
  },
  swim_pace: {
    discipline: 'swim',
    zoneKeys: SWIM_ZONE_KEYS,
    requirement: 'Add a CSS test or an estimated CSS pace on the Performance page.',
    calculate(input) {
      const result = calculateSwim(input);
      return {
        method: input.method,
        calculatorVersion: result.calculatorVersion,
        fitness: result.cssPace,
        zones: result.zones.map((zone) => ({
          key: zone.key,
          metric: 'pace',
          unit: 'seconds_per_100_metres',
          minimum: zone.fast,
          target: zone.target,
          maximum: zone.slow,
        })),
      };
    },
  },
};

export const PERFORMANCE_SYSTEMS = Object.keys(CALIBRATORS) as PerformanceSystem[];

/** The system a sport resolves its zones in, if it has one. Strength and ergs have none. */
export function systemForDiscipline(discipline: string | null): PerformanceSystem | null {
  return (
    PERFORMANCE_SYSTEMS.find((system) => CALIBRATORS[system].discipline === discipline) ?? null
  );
}

export function calibrate(input: Pick<CalibrationInput, 'system' | 'input'>): Calculation {
  try {
    // The discriminated input guarantees each system receives its own input shape.
    const calibrator = CALIBRATORS[input.system] as Calibrator<typeof input.input>;
    return calibrator.calculate(input.input);
  } catch (error) {
    throw new PlanError('CALIBRATION_INVALID', (error as Error).message, 422);
  }
}
