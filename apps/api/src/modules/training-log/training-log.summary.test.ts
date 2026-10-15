import { expect, it } from 'vitest';
import { summarizeTraining } from './training-log.summary.js';
import { LogSchema } from './training-log.schemas.js';
import type { WorkoutSummary } from '../workouts/workout.schemas.js';
const id = '00000000-0000-4000-8000-000000000001';
const log = LogSchema.parse({
  id,
  planId: id,
  lineageId: id,
  loggedVersionId: id,
  scheduledOn: '2026-10-13',
  title: 'Easy run',
  discipline: 'run',
  sessionType: 'easy',
  keySession: false,
  plannedDurationSeconds: 1800,
  plannedDistanceMetres: 5000,
  plannedRpe: 3,
  status: 'done',
  performedOn: '2026-10-13',
  actualDurationSeconds: null,
  actualDistanceMetres: 5000,
  rpe: null,
  feel: null,
  reasons: [],
  answers: {},
  answersSchemaVersion: 1,
  note: null,
  source: 'manual',
  createdAt: '2026-10-13T12:00:00Z',
  updatedAt: '2026-10-13T12:00:00Z',
});
const workout: WorkoutSummary = {
  id,
  lineageId: id,
  planId: id,
  planVersionId: id,
  planTitle: 'Plan',
  weekNumber: 1,
  scheduledDate: '2026-10-13',
  title: 'Easy run',
  description: null,
  purpose: null,
  discipline: 'run',
  sessionType: 'easy',
  plannedRpe: 3,
  priority: 'medium',
  racePriority: null,
  estimatedDurationSeconds: 1800,
  estimatedDistanceMetres: 5000,
};
it('distinguishes unknown load and no log from skipping', () => {
  expect(summarizeTraining([workout], [], '2026-10-14')).toMatchObject({
    due: 1,
    unlogged: 1,
    skipped: 0,
    load: null,
  });
  expect(summarizeTraining([workout], [log], '2026-10-14')).toMatchObject({
    unlogged: 0,
    done: 1,
    load: null,
    unknownLoadSessions: 1,
  });
  expect(
    summarizeTraining(
      [workout],
      [{ ...log, status: 'skipped', actualDistanceMetres: null }],
      '2026-10-14',
    ),
  ).toMatchObject({ done: 0, skipped: 1, load: null, unknownLoadSessions: 0 });
});
it('calculates load from actuals and uses only the last three rated key sessions for patterns', () => {
  const logs = Array.from({ length: 4 }, (_, i) => ({
    ...log,
    id: String(i),
    lineageId: String(i),
    performedOn: `2026-10-${10 + i}`,
    keySession: true,
    rpe: i === 3 ? 3 : 7,
    actualDurationSeconds: 1800,
  }));
  expect(summarizeTraining([workout], logs, '2026-10-14')).toMatchObject({
    load: 720,
    harderKeySessions: 2,
    recentKeySessions: 3,
  });
});

it('separates performed-date actuals from scheduled-workout logging membership', () => {
  const moved = { ...log, performedOn: '2026-10-19', actualDurationSeconds: 1800 };
  expect(summarizeTraining([workout], [], '2026-10-14', [moved])).toMatchObject({
    due: 1,
    unlogged: 0,
    done: 0,
  });
  expect(summarizeTraining([], [moved], '2026-10-19', [moved])).toMatchObject({
    due: 0,
    unlogged: 0,
    done: 1,
    bySport: [
      {
        discipline: 'run',
        actualSeconds: 1800,
        actualMetres: 5000,
        plannedSeconds: 0,
        plannedMetres: 0,
      },
    ],
  });
});
