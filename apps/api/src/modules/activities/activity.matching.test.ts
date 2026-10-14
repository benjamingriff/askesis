import { describe, expect, it } from 'vitest';
import {
  pairScore,
  reconcile,
  slotsFor,
  type MatchOverride,
  type PlannedWorkout,
  type RecordedActivity,
} from './activity.matching.js';

const weeks = [
  { weekNumber: 1, startDate: '2026-10-05', endDate: '2026-10-11' },
  { weekNumber: 2, startDate: '2026-10-12', endDate: '2026-10-18' },
];
const weekOf = (date: string) => (date <= '2026-10-11' ? 1 : 2);

function workout(
  id: string,
  date: string,
  sport: string,
  minutes: number,
  extra = {},
): PlannedWorkout {
  return {
    id,
    lineageId: `lineage-${id}`,
    date,
    weekNumber: weekOf(date),
    sport,
    slots: slotsFor(sport),
    durationSeconds: minutes * 60,
    distanceMetres: null,
    ...extra,
  };
}
function activity(id: string, date: string, sport: RecordedActivity['sport'], minutes: number) {
  return {
    id,
    connectionId: 'strava',
    sourceActivityId: `s-${id}`,
    sport,
    date,
    elapsedSeconds: minutes * 60 + 60,
    movingSeconds: minutes * 60,
    distanceMetres: sport === 'run' ? minutes * 200 : null,
  } satisfies RecordedActivity;
}
const run =
  (overrides: MatchOverride[] = [], today = '2026-10-13') =>
  (workouts: PlannedWorkout[], activities: RecordedActivity[]) =>
    reconcile({
      workouts,
      activities,
      overrides,
      weeks,
      startDate: '2026-10-05',
      endDate: '2026-10-18',
      today,
    });

describe('matching activities to workouts', () => {
  it('fills same-day sessions, then moved ones, and reports what is missed and still planned', () => {
    const result = run()(
      [
        workout('mon', '2026-10-05', 'run', 40),
        workout('tue', '2026-10-06', 'cycle', 60),
        workout('thu', '2026-10-08', 'run', 30),
        workout('sat', '2026-10-10', 'run', 90),
        workout('wed2', '2026-10-14', 'run', 40),
      ],
      [
        activity('a', '2026-10-05', 'run', 41),
        activity('b', '2026-10-07', 'cycle', 58), // a day late
        activity('c', '2026-10-09', 'other', 60), // a walk: never matched
      ],
    );
    const status = Object.fromEntries(result.workouts.map((w) => [w.workoutId, w]));
    expect(status.mon).toMatchObject({ status: 'completed', matchedBy: 'auto', dayOffset: 0 });
    expect(status.tue).toMatchObject({ status: 'completed', dayOffset: 1 });
    expect(status.thu!.status).toBe('missed');
    expect(status.sat!.status).toBe('missed');
    expect(status.wed2!.status).toBe('planned');
    expect(result.extra).toEqual([{ activityId: 'c', countsTowardPlan: false }]);
  });

  it('prefers the same-day workout and marks a short session partial', () => {
    const result = run()(
      [workout('mon', '2026-10-05', 'run', 90), workout('tue', '2026-10-06', 'run', 30)],
      [activity('a', '2026-10-06', 'run', 31), activity('b', '2026-10-05', 'run', 50)],
    );
    expect(result.workouts.map((w) => [w.workoutId, w.activityIds, w.status])).toEqual([
      ['mon', ['b'], 'partial'],
      ['tue', ['a'], 'completed'],
    ]);
    expect(result.workouts[0]!.completion).toBeCloseTo(50 / 90);
  });

  it('allows two or three days only inside the same training week', () => {
    const sunday = workout('sun', '2026-10-11', 'run', 60);
    expect(pairScore(sunday, activity('x', '2026-10-09', 'run', 60), weeks)).not.toBeNull();
    expect(pairScore(sunday, activity('y', '2026-10-13', 'run', 60), weeks)).toBeNull();
    expect(pairScore(sunday, activity('z', '2026-10-12', 'run', 60), weeks)).not.toBeNull();
    // A day either side needs a plausible volume: a 10-minute jog is not the long run.
    expect(pairScore(sunday, activity('j', '2026-10-12', 'run', 10), weeks)).toBeNull();
    expect(pairScore(sunday, activity('k', '2026-10-15', 'run', 60), weeks)).toBeNull();
  });

  it('fills a brick with a ride and a run, and stays partial with only one', () => {
    const brick = {
      ...workout('brick', '2026-10-10', 'mixed', 80),
      slots: slotsFor('mixed', ['cycle', 'other', 'run']),
    };
    expect(brick.slots).toEqual(['cycle', 'run']);
    const both = run()(
      [brick],
      [activity('r', '2026-10-10', 'cycle', 60), activity('s', '2026-10-10', 'run', 15)],
    );
    expect(both.workouts[0]).toMatchObject({ status: 'completed', activityIds: ['r', 's'] });
    const half = run()([brick], [activity('r', '2026-10-10', 'cycle', 60)]);
    expect(half.workouts[0]!.status).toBe('partial');
  });

  it('applies the athlete’s links and rejections before automatic matching', () => {
    const workouts = [
      workout('mon', '2026-10-05', 'run', 40),
      workout('tue', '2026-10-06', 'run', 40),
    ];
    const activities = [
      activity('a', '2026-10-05', 'run', 40),
      activity('t', '2026-10-05', 'strength', 40),
    ];
    const result = run([
      {
        workoutLineageId: 'lineage-mon',
        connectionId: 'strava',
        sourceActivityId: 's-a',
        decision: 'reject',
      },
      // A treadmill session logged as a gym workout still counts when the athlete says so.
      {
        workoutLineageId: 'lineage-tue',
        connectionId: 'strava',
        sourceActivityId: 's-t',
        decision: 'link',
      },
    ])(workouts, activities);
    expect(result.workouts.map((w) => [w.workoutId, w.activityIds, w.matchedBy])).toEqual([
      ['mon', [], null],
      ['tue', ['t'], 'manual'],
    ]);
    expect(result.extra).toEqual([{ activityId: 'a', countsTowardPlan: true }]);
  });

  it('totals planned, due and actual volume by week, counting early sessions as ahead', () => {
    const result = run([], '2026-10-13')(
      [
        workout('mon', '2026-10-12', 'run', 30),
        workout('tue', '2026-10-13', 'cycle', 60),
        workout('thu', '2026-10-15', 'run', 60),
      ],
      [
        activity('a', '2026-10-12', 'run', 30),
        activity('b', '2026-10-13', 'run', 60), // Thursday's long run, done early
        activity('c', '2026-10-12', 'run', 20), // extra
      ],
    );
    const week = result.weeks[1]!;
    expect(week.planned).toEqual({ sessions: 3, seconds: 9000, metres: 0 });
    expect(result.workouts.find((w) => w.workoutId === 'thu')).toMatchObject({
      status: 'completed',
      dayOffset: -2,
    });
    // Monday was due and Thursday was done early; Tuesday's ride is still open today.
    expect(week.due.seconds).toBe(30 * 60 + 60 * 60);
    expect(week.actual.seconds).toBe(30 * 60 + 60 * 60 + 20 * 60);
    expect(week).toMatchObject({ completed: 2, missed: 0, extra: 1 });
    expect(result.toDate.actual.seconds - result.toDate.due.seconds).toBe(20 * 60);
  });
});
