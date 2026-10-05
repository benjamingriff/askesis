import { useState } from 'react';
import type { WorkoutSummary } from '@askesis/api-client';

export type WorkoutSelection = ReturnType<typeof useWorkoutSelection>;

/** Resolve an open workout against its current version and summary, never a saved snapshot. */
export function useWorkoutSelection(workouts: WorkoutSummary[], versionId?: string | null) {
  const [selection, setSelection] = useState<{ id: string; versionId: string } | null>(null);
  const workout =
    workouts.find(
      (item) =>
        selection !== null &&
        item.id === selection.id &&
        item.planVersionId === selection.versionId &&
        (versionId == null || item.planVersionId === versionId),
    ) ?? null;
  return {
    workout,
    /** The open workout no longer exists in the current saved version. */
    missing: selection !== null && selection.versionId === versionId && !workout,
    open: (item: WorkoutSummary) => setSelection({ id: item.id, versionId: item.planVersionId }),
    close: () => setSelection(null),
  };
}
