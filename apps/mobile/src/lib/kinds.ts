import type { IconName } from '../components/ui';
import type { WorkoutKind } from '../data/types';
import { KIND_COLORS } from '../theme/palette';

export const KIND_META: Record<WorkoutKind, { label: string; icon: IconName; color: string }> = {
  easy: { label: 'Easy run', icon: 'footsteps', color: KIND_COLORS.easy },
  recovery: { label: 'Recovery', icon: 'leaf', color: KIND_COLORS.recovery },
  long: { label: 'Long run', icon: 'trail-sign', color: KIND_COLORS.long },
  tempo: { label: 'Tempo', icon: 'speedometer', color: KIND_COLORS.tempo },
  intervals: { label: 'Intervals', icon: 'flash', color: KIND_COLORS.intervals },
  strength: { label: 'Strength', icon: 'barbell', color: KIND_COLORS.strength },
  race: { label: 'Race', icon: 'trophy', color: KIND_COLORS.race },
  rest: { label: 'Rest', icon: 'moon', color: KIND_COLORS.rest },
};
