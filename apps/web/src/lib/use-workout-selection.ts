import { useState } from 'react';
import type { WorkoutSummary } from '@askesis/api-client';

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
    open: (item: WorkoutSummary) => setSelection({ id: item.id, versionId: item.planVersionId }),
    close: () => setSelection(null),
  };
}
