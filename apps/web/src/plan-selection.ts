import { createContext, useContext } from 'react';

export const PlanPreferenceScope = createContext('anonymous');
export type PlanSelection = { planId: string; view: 'locked' | 'draft' };
export function usePlanPreferences() {
  const accountId = useContext(PlanPreferenceScope);
  const key = `askesis-plan-selection:${accountId}`;
  return {
    read(): PlanSelection | null {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
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
        /* Preferences are optional, including when storage is unavailable. */
      }
      return null;
    },
    write(value: PlanSelection) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Optional preference. */
      }
    },
  };
}
