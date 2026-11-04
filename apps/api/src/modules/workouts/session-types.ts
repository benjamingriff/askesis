export const SESSION_TYPES = [
  'recovery',
  'easy',
  'long',
  'steady',
  'tempo',
  'intervals',
  'speed',
  'strength',
  'mobility',
  'brick',
  'race',
  'test',
  'rest',
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
/** Legacy fallback only; new prescriptions should set session_type explicitly. */
export function inferSessionType(w: {
  title: string;
  discipline: string;
  racePriority?: string | null;
}): SessionType {
  const title = w.title.toLowerCase();
  if (w.racePriority) return 'race';
  if (/time trial|\btest\b|benchmark/.test(title)) return 'test';
  if (/^rest\b|rest day/.test(title)) return 'rest';
  if (/mobility|yoga|stretch|flexibility/.test(title)) return 'mobility';
  if (w.discipline === 'strength') return 'strength';
  if (/brick|hyrox|simulation/.test(title)) return 'brick';
  if (/recovery|shake ?out/.test(title)) return 'recovery';
  if (/\blong\b/.test(title)) return 'long';
  if (/sprint|repetition|anaerobic|neuromuscular|\bspeed\b|all[- ]out/.test(title)) return 'speed';
  if (/threshold|cruise|sweet ?spot|\bcss\b|lactate/.test(title)) return 'tempo';
  if (/tempo/.test(title) && /interval|repeats?/.test(title)) return 'intervals';
  if (/tempo/.test(title)) return w.discipline === 'run' ? 'tempo' : 'steady';
  if (/interval|vo2|track|hill|fartlek|repeats?\b|\d+\s?[x×]\s?\d/.test(title)) return 'intervals';
  if (/steady|marathon pace|progression|moderate|race pace/.test(title)) return 'steady';
  return 'easy';
}
