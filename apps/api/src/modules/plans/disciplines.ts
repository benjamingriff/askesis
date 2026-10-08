/**
 * Controlled sport vocabulary, mirrored by database checks. A workout names its sport; a mixed
 * workout (a triathlon brick or a Hyrox simulation) names each effort's sport on its steps.
 */
export const WORKOUT_DISCIPLINES = ['run', 'cycle', 'swim', 'strength', 'mixed'] as const;
export type WorkoutDiscipline = (typeof WORKOUT_DISCIPLINES)[number];

/** Sports an effort step can be. Ergs and transitions only appear inside workouts. */
export const STEP_DISCIPLINES = [
  'run',
  'cycle',
  'swim',
  'strength',
  'row',
  'ski_erg',
  'other',
] as const;
export type StepDiscipline = (typeof STEP_DISCIPLINES)[number];

/** Sports a plan brief can hold a training baseline for. */
export const BRIEF_SPORTS = ['run', 'cycle', 'swim', 'strength'] as const;
export type BriefSport = (typeof BRIEF_SPORTS)[number];

export const SPORT_NAMES: Record<StepDiscipline | 'mixed', string> = {
  run: 'running',
  cycle: 'cycling',
  swim: 'swimming',
  strength: 'strength',
  row: 'rowing',
  ski_erg: 'SkiErg',
  other: 'other',
  mixed: 'mixed',
};
