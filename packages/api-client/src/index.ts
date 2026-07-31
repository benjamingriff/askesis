import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type WorkoutSummary = components['schemas']['WorkoutSummary'];
export type WorkoutDetail = components['schemas']['WorkoutDetail'];
export type WorkoutStep = components['schemas']['WorkoutStep'];
export type StepTarget = components['schemas']['StepTarget'];
export type ApiError = components['schemas']['Error'];

export function createAskesisClient(baseUrl = '') {
  return createClient<paths>({ baseUrl });
}
