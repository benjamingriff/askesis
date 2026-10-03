import { useState } from 'react';

/**
 * A selection that follows `fallback` (such as today or the current week) until the user
 * picks something else. Picking the fallback again resumes following it.
 */
export function useFollowingState<T>(fallback: T): [T, (value: T) => void] {
  const [chosen, setChosen] = useState<{ value: T } | null>(null);
  const select = (value: T) => setChosen(Object.is(value, fallback) ? null : { value });
  return [chosen ? chosen.value : fallback, select];
}
