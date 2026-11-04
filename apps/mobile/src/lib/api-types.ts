// The web and mobile clients share the API contract generated from the server's OpenAPI document.
// Type-only imports are erased when bundling, so Metro never resolves this path.
import type { components, paths } from '../../../../packages/api-client/src/schema';

export type { components, paths };

export type WorkoutSummary = components['schemas']['WorkoutSummary'];
export type WorkoutDetail = components['schemas']['WorkoutDetail'];
export type WorkoutStep = components['schemas']['WorkoutStep'];
export type StepTarget = components['schemas']['StepTarget'];
export type TrainingBlock = components['schemas']['TrainingBlock'];
export type BlockPhase = NonNullable<TrainingBlock['phase']>;
export type TrainingWeek = components['schemas']['TrainingWeek'];
export type RacePriority = NonNullable<WorkoutSummary['racePriority']>;
export type PerformanceState = components['schemas']['PerformanceState'];
export type CalibrationEntry = components['schemas']['CalibrationEntry'];
export type CalibrationZone = components['schemas']['CalibrationZone'];
