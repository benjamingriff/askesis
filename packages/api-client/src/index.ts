import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';
export type { paths } from './schema.js';

export type WorkoutSummary = components['schemas']['WorkoutSummary'];
export type WorkoutDetail = components['schemas']['WorkoutDetail'];
export type WorkoutStep = components['schemas']['WorkoutStep'];
export type StepTarget = components['schemas']['StepTarget'];
export type TrainingBlock = components['schemas']['TrainingBlock'];
export type BlockPhase = NonNullable<TrainingBlock['phase']>;
export type TrainingWeek = components['schemas']['TrainingWeek'];
export type RacePriority = NonNullable<WorkoutSummary['racePriority']>;
export type ApiError = components['schemas']['Error'];
export type PerformanceState = components['schemas']['PerformanceState'];
export type CalibrationEntry = components['schemas']['CalibrationEntry'];
export type CalibrationZone = components['schemas']['CalibrationZone'];
export type RecordCalibration = components['schemas']['RecordCalibration'];
export type SportBaseline = components['schemas']['SportBaseline'];

export function createAskesisClient(baseUrl = '') {
  return createClient<paths>({ baseUrl });
}
