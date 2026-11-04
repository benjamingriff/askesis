import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type PlanView = 'locked' | 'draft';
export type PlanSelection = { planId: string; view: PlanView };

type Value = { selection: PlanSelection | null; select: (next: PlanSelection) => void };
const PlanSelectionContext = createContext<Value>({ selection: null, select: () => undefined });

function parse(raw: string | null): PlanSelection | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
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
}

/** Which active plan Today and the Plan tab follow, and whether its draft is shown; per account. */
export function PlanSelectionProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const key = `askesis-plan-selection:${accountId}`;
  const [selection, setSelection] = useState<PlanSelection | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(key)
      .then((raw) => setSelection((current) => current ?? parse(raw)))
      .catch(() => undefined);
  }, [key]);
  const select = useCallback(
    (next: PlanSelection) => {
      setSelection(next);
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
    },
    [key],
  );
  const value = useMemo(() => ({ selection, select }), [selection, select]);
  return <PlanSelectionContext.Provider value={value}>{children}</PlanSelectionContext.Provider>;
}

export const usePlanSelection = () => useContext(PlanSelectionContext);
