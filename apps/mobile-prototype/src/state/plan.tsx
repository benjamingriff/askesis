import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { buildPlanMeta, buildSeedWorkouts } from '../data/seed';
import { todayISO, weekdayIndex, WEEKDAYS_SHORT } from '../data/dates';
import type { PlanChange, PlanMeta, PlanStatus, Workout } from '../data/types';

type PlanState = {
  meta: PlanMeta;
  workouts: Workout[];
  status: PlanStatus;
  /** Version number of the draft (when unlocked) or the locked version. */
  version: number;
};

export type EditResult = { workouts: Workout[]; changes: PlanChange[] };

type PlanContextValue = PlanState & {
  today: string;
  getWorkout: (id: string) => Workout | undefined;
  /** Always returns the latest state, even from inside a timer. */
  getSnapshot: () => PlanState;
  moveWorkout: (id: string, toDate: string) => { ok: boolean; reason?: string };
  applyEdit: (edit: (workouts: Workout[]) => EditResult) => PlanChange[];
  lock: () => void;
  unlock: () => void;
};

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const today = useMemo(() => todayISO(), []);
  const [state, setState] = useState<PlanState>(() => ({
    meta: buildPlanMeta(today),
    workouts: buildSeedWorkouts(today),
    status: 'draft',
    version: 3,
  }));
  const ref = useRef(state);
  ref.current = state;

  const commit = useCallback((next: PlanState) => {
    ref.current = next;
    setState(next);
  }, []);

  const getSnapshot = useCallback(() => ref.current, []);

  const getWorkout = useCallback((id: string) => ref.current.workouts.find((w) => w.id === id), []);

  const moveWorkout = useCallback(
    (id: string, toDate: string) => {
      const cur = ref.current;
      if (cur.status === 'locked') return { ok: false, reason: 'locked' };
      const moving = cur.workouts.find((w) => w.id === id);
      if (!moving) return { ok: false, reason: 'missing' };
      if (toDate < today || moving.date < today) return { ok: false, reason: 'past' };
      if (toDate === moving.date) return { ok: true };
      const other = cur.workouts.find((w) => w.date === toDate);
      const fromDate = moving.date;
      const note = (date: string) =>
        `Moved from ${WEEKDAYS_SHORT[weekdayIndex(date)]} to ${WEEKDAYS_SHORT[weekdayIndex(toDate)]}.`;
      const workouts = cur.workouts.map((w) => {
        if (w.id === id) {
          return {
            ...w,
            date: toDate,
            change: w.change ?? 'changed',
            changeNote: w.changeNote ?? note(fromDate),
          };
        }
        if (other && w.id === other.id) {
          return {
            ...w,
            date: fromDate,
            change: w.kind === 'rest' ? w.change : (w.change ?? 'changed'),
            changeNote:
              w.kind === 'rest'
                ? w.changeNote
                : (w.changeNote ??
                  `Moved from ${WEEKDAYS_SHORT[weekdayIndex(toDate)]} to ${WEEKDAYS_SHORT[weekdayIndex(fromDate)]}.`),
          };
        }
        return w;
      });
      commit({ ...cur, workouts: workouts.sort((a, b) => a.date.localeCompare(b.date)) });
      return { ok: true };
    },
    [commit, today],
  );

  const applyEdit = useCallback(
    (edit: (workouts: Workout[]) => EditResult) => {
      const cur = ref.current;
      const result = edit(cur.workouts);
      commit({
        ...cur,
        workouts: [...result.workouts].sort((a, b) => a.date.localeCompare(b.date)),
      });
      return result.changes;
    },
    [commit],
  );

  const lock = useCallback(() => {
    const cur = ref.current;
    commit({
      ...cur,
      status: 'locked',
      workouts: cur.workouts.map(({ change: _c, changeNote: _n, ...rest }) => rest),
    });
  }, [commit]);

  const unlock = useCallback(() => {
    const cur = ref.current;
    commit({ ...cur, status: 'draft', version: cur.version + 1 });
  }, [commit]);

  const value = useMemo<PlanContextValue>(
    () => ({
      ...state,
      today,
      getWorkout,
      getSnapshot,
      moveWorkout,
      applyEdit,
      lock,
      unlock,
    }),
    [state, today, getWorkout, getSnapshot, moveWorkout, applyEdit, lock, unlock],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used inside PlanProvider');
  return ctx;
}
