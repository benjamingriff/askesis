import type { WorkoutSummary } from '../workouts/workout.schemas.js';
import type { WorkoutLog } from './training-log.schemas.js';
export function summarizeTraining(workouts: WorkoutSummary[], logs: WorkoutLog[], today: string) {
  const lookup = new Map(logs.map((l) => [`${l.planId}/${l.lineageId}`, l]));
  const due = workouts.filter((w) => w.scheduledDate <= today);
  const bySport = new Map<
    string,
    {
      discipline: string;
      plannedSeconds: number;
      actualSeconds: number;
      plannedMetres: number;
      actualMetres: number;
    }
  >();
  const sport = (discipline: string) => {
    if (!bySport.has(discipline))
      bySport.set(discipline, {
        discipline,
        plannedSeconds: 0,
        actualSeconds: 0,
        plannedMetres: 0,
        actualMetres: 0,
      });
    return bySport.get(discipline)!;
  };
  for (const w of workouts) {
    const s = sport(w.discipline);
    s.plannedSeconds += w.estimatedDurationSeconds ?? 0;
    s.plannedMetres += w.estimatedDistanceMetres ?? 0;
  }
  let load = 0,
    known = 0,
    unknown = 0;
  for (const l of logs) {
    if (l.status === 'skipped') continue;
    const s = sport(l.discipline);
    s.actualSeconds += l.actualDurationSeconds ?? 0;
    s.actualMetres += l.actualDistanceMetres ?? 0;
    if (l.rpe != null && l.actualDurationSeconds != null) {
      load += (l.rpe * l.actualDurationSeconds) / 60;
      known++;
    } else unknown++;
  }
  const key = logs
    .filter((l) => l.keySession && l.status !== 'skipped' && l.rpe != null && l.plannedRpe != null)
    .sort(
      (a, b) =>
        a.performedOn.localeCompare(b.performedOn) || a.createdAt.localeCompare(b.createdAt),
    )
    .slice(-3);
  return {
    due: due.length,
    done: logs.filter((l) => l.status === 'done').length,
    changed: logs.filter((l) => l.status === 'changed').length,
    skipped: logs.filter((l) => l.status === 'skipped').length,
    unlogged: due.filter((w) => !lookup.has(`${w.planId}/${w.lineageId}`)).length,
    bySport: [...bySport.values()],
    load: known ? Math.round(load) : null,
    unknownLoadSessions: unknown,
    harderKeySessions: key.filter((l) => l.rpe! - l.plannedRpe! >= 2).length,
    easierKeySessions: key.filter((l) => l.plannedRpe! - l.rpe! >= 3).length,
    recentKeySessions: key.length,
    tiredSessions: logs.filter((l) => l.feel != null && l.feel >= 4).length,
    easyHighEffortSessions: logs.filter(
      (l) =>
        l.status !== 'skipped' &&
        (l.sessionType === 'easy' || l.sessionType === 'recovery') &&
        (l.rpe ?? 0) >= 5,
    ).length,
  };
}
