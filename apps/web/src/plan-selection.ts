import { createContext, useContext } from 'react';
import { readStorage, writeStorage } from './lib/storage';

export const PlanPreferenceScope = createContext('anonymous');
export type PlanSelection = { planId: string; view: 'locked' | 'draft' };
export function usePlanPreferences() {
  const accountId = useContext(PlanPreferenceScope);
  const key = `askesis-plan-selection:${accountId}`;
  return {
    read(): PlanSelection | null {
      try {
        const value: unknown = JSON.parse(readStorage(key) ?? 'null');
        if (
          value &&
          typeof value === 'object' &&
          'planId' in value &&
          typeof value.planId === 'string' &&
          'view' in value &&
          (value.view === 'locked' || value.view === 'draft')
        )
          return { planId: value.planId, view: value.view };
      } catch {
        /* A malformed stored preference is ignored. */
      }
      return null;
    },
    write(value: PlanSelection) {
      writeStorage(key, JSON.stringify(value));
    },
  };
}
