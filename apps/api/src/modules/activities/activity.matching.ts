import type { ActivitySport } from './strava.mapping.js';

/**
 * Planned-versus-actual reconciliation. A pure function of the schedule, recorded activities,
 * the athlete's link/reject decisions and today's date, so it is recomputed on every read and
 * follows plan edits without stored match state going stale.
 */

/**
 * What a workout can be filled by. A brick has a cycle and a run slot; a mixed gym session's
 * strength and erg work share one gym slot. A pure strength session takes lifting only.
 */
export type SlotKind = 'run' | 'cycle' | 'swim' | 'strength' | 'gym';

export type PlannedWorkout = {
  id: string;
  lineageId: string;
  date: string;
  weekNumber: number;
  sport: string;
  slots: SlotKind[];
  durationSeconds: number | null;
  distanceMetres: number | null;
};

export type RecordedActivity = {
  id: string;
  connectionId: string;
  sourceActivityId: string;
  sport: ActivitySport;
  date: string;
  elapsedSeconds: number;
  movingSeconds: number | null;
  distanceMetres: number | null;
};

export type MatchOverride = {
  workoutLineageId: string;
  connectionId: string;
  sourceActivityId: string;
  decision: 'link' | 'reject';
};

export type PlanWeek = { weekNumber: number; startDate: string; endDate: string };

export type WorkoutStatus = 'completed' | 'partial' | 'missed' | 'planned';

export type WorkoutOutcome = {
  workoutId: string;
  status: WorkoutStatus;
  activityIds: string[];
  matchedBy: 'auto' | 'manual' | null;
  /** Actual over planned on the workout's main measure; null when nothing is planned to compare. */
  completion: number | null;
  /** Days between the plan date and the activity: negative when done early. */
  dayOffset: number | null;
  actualSeconds: number;
  actualMetres: number;
};

export type Volume = { sessions: number; seconds: number; metres: number };

export type WeekAdherence = PlanWeek & {
  planned: Volume;
  /** Workouts due by today, plus later ones already done early. */
  due: Volume;
  /** Linked workouts plus extra activities in the plan's sports. */
  actual: Volume;
  completed: number;
  partial: number;
  missed: number;
  extra: number;
};

export type Reconciliation = {
  workouts: WorkoutOutcome[];
  /** Activities in the plan dates that no workout claimed, with the volume each adds. */
  extra: { activityId: string; countsTowardPlan: boolean; seconds: number; metres: number }[];
  weeks: WeekAdherence[];
  toDate: { due: Volume; actual: Volume };
};

/** A workout is complete at 85% of its planned volume; below that it was shortened. */
export const COMPLETE_AT = 0.85;
/** How far apart an activity and a workout may be for automatic matching, by score. */
const DAY_SCORE = [1, 0.55, 0.3, 0.15];
/** Manual links may reach a week either side, beyond that it is a different session. */
export const MANUAL_WINDOW_DAYS = 7;

const ACCEPTS: Record<SlotKind, ActivitySport[]> = {
  run: ['run'],
  cycle: ['cycle'],
  swim: ['swim'],
  strength: ['strength'],
  gym: ['strength', 'row'],
};

/** Slots for a workout: one per endurance sport in a mixed session, gym work as one. */
export function slotsFor(sport: string, stepDisciplines: string[] = []): SlotKind[] {
  if (sport === 'run' || sport === 'cycle' || sport === 'swim' || sport === 'strength')
    return [sport];
  const slots = new Set<SlotKind>();
  for (const discipline of stepDisciplines)
    if (discipline === 'run' || discipline === 'cycle' || discipline === 'swim')
      slots.add(discipline);
    else if (['strength', 'row', 'ski_erg'].includes(discipline)) slots.add('gym');
  return slots.size ? [...slots] : ['gym'];
}

export function accepts(slot: SlotKind, sport: ActivitySport) {
  return ACCEPTS[slot].includes(sport);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Gym sessions are timed by the clock; endurance sessions by moving time. */
export function activitySeconds(
  activity: Pick<RecordedActivity, 'sport' | 'elapsedSeconds' | 'movingSeconds'>,
) {
  return ['strength', 'row', 'other'].includes(activity.sport)
    ? activity.elapsedSeconds
    : (activity.movingSeconds ?? activity.elapsedSeconds);
}

/** Actual over planned: distance when both sides have one, otherwise time. */
export function completionRatio(
  workout: Pick<PlannedWorkout, 'durationSeconds' | 'distanceMetres'>,
  activities: RecordedActivity[],
): number | null {
  const metres = activities.reduce((sum, a) => sum + (a.distanceMetres ?? 0), 0);
  if (workout.distanceMetres && metres > 0) return metres / workout.distanceMetres;
  const seconds = activities.reduce((sum, a) => sum + activitySeconds(a), 0);
  if (workout.durationSeconds) return seconds / workout.durationSeconds;
  return null;
}

/** 1 when volumes agree, falling to 0 at three times more or less. */
function volumeScore(workout: PlannedWorkout, activity: RecordedActivity) {
  if (workout.slots.length > 1) return 0.5;
  const ratio = completionRatio(workout, [activity]);
  if (ratio === null) return 0.5;
  if (ratio <= 0) return 0;
  return Math.max(0, 1 - Math.abs(Math.log(ratio)) / Math.log(3));
}

const weekOf = (weeks: PlanWeek[], date: string) =>
  weeks.find((week) => date >= week.startDate && date <= week.endDate)?.weekNumber ?? null;

/**
 * Score an automatic pairing, or null when it is not eligible. Same day is preferred; a day
 * either side needs a plausible volume; two or three days only inside the same training week,
 * so a missed Sunday long run is not quietly filled by Wednesday's run of the next week.
 */
export function pairScore(
  workout: PlannedWorkout,
  activity: RecordedActivity,
  weeks: PlanWeek[],
): number | null {
  const days = Math.abs(daysBetween(workout.date, activity.date));
  const day = DAY_SCORE[days];
  if (day === undefined) return null;
  const volume = volumeScore(workout, activity);
  if (days >= 1 && volume < 0.3) return null;
  if (days >= 2 && weekOf(weeks, activity.date) !== workout.weekNumber) return null;
  const score = 0.65 * day + 0.35 * volume;
  return score >= 0.3 ? score : null;
}

const activityKey = (connectionId: string, sourceActivityId: string) =>
  `${connectionId}:${sourceActivityId}`;

export function reconcile(input: {
  workouts: PlannedWorkout[];
  activities: RecordedActivity[];
  overrides: MatchOverride[];
  weeks: PlanWeek[];
  startDate: string | null;
  endDate: string | null;
  today: string;
}): Reconciliation {
  const { workouts, activities, overrides, weeks, today } = input;
  const byKey = new Map(
    activities.map((a) => [activityKey(a.connectionId, a.sourceActivityId), a]),
  );
  const rejected = new Set(
    overrides
      .filter((o) => o.decision === 'reject')
      .map((o) => `${o.workoutLineageId}|${activityKey(o.connectionId, o.sourceActivityId)}`),
  );
  const assigned = new Map<string, { activities: RecordedActivity[]; manual: boolean }>();
  const used = new Set<string>();
  const fill = (workout: PlannedWorkout, activity: RecordedActivity, manual: boolean) => {
    const entry = assigned.get(workout.id) ?? { activities: [], manual: false };
    entry.activities.push(activity);
    entry.manual ||= manual;
    assigned.set(workout.id, entry);
    used.add(activity.id);
  };

  // The athlete's links come first and may cross sports or dates the matcher would not.
  for (const override of overrides) {
    if (override.decision !== 'link') continue;
    const workout = workouts.find((w) => w.lineageId === override.workoutLineageId);
    const activity = byKey.get(activityKey(override.connectionId, override.sourceActivityId));
    if (!workout || !activity || used.has(activity.id)) continue;
    fill(workout, activity, true);
  }

  // Then the best remaining pairings, slot by slot, each activity used once.
  const pairs: {
    workout: PlannedWorkout;
    slot: number;
    activity: RecordedActivity;
    score: number;
  }[] = [];
  for (const workout of workouts) {
    if (assigned.get(workout.id)?.manual) continue;
    workout.slots.forEach((slot, index) => {
      for (const activity of activities) {
        if (used.has(activity.id) || !accepts(slot, activity.sport)) continue;
        const key = `${workout.lineageId}|${activityKey(activity.connectionId, activity.sourceActivityId)}`;
        if (rejected.has(key)) continue;
        const score = pairScore(workout, activity, weeks);
        if (score !== null) pairs.push({ workout, slot: index, activity, score });
      }
    });
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(daysBetween(a.workout.date, a.activity.date)) -
        Math.abs(daysBetween(b.workout.date, b.activity.date)) ||
      a.workout.date.localeCompare(b.workout.date),
  );
  const filledSlots = new Set<string>();
  for (const { workout, slot, activity } of pairs) {
    const slotKey = `${workout.id}:${slot}`;
    if (used.has(activity.id) || filledSlots.has(slotKey)) continue;
    filledSlots.add(slotKey);
    fill(workout, activity, false);
  }

  const outcomes = workouts.map((workout): WorkoutOutcome => {
    const entry = assigned.get(workout.id);
    if (!entry)
      return {
        workoutId: workout.id,
        status: workout.date < today ? 'missed' : 'planned',
        activityIds: [],
        matchedBy: null,
        completion: null,
        dayOffset: null,
        actualSeconds: 0,
        actualMetres: 0,
      };
    const linked = entry.activities;
    const completion = completionRatio(workout, linked);
    const slotsMissing =
      !entry.manual && workout.slots.some((slot) => !linked.some((a) => accepts(slot, a.sport)));
    const offsets = linked.map((a) => daysBetween(workout.date, a.date));
    return {
      workoutId: workout.id,
      status:
        slotsMissing || (completion !== null && completion < COMPLETE_AT) ? 'partial' : 'completed',
      activityIds: linked.map((a) => a.id),
      matchedBy: entry.manual ? 'manual' : 'auto',
      completion,
      dayOffset: offsets.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0),
      actualSeconds: linked.reduce((sum, a) => sum + activitySeconds(a), 0),
      actualMetres: linked.reduce((sum, a) => sum + (a.distanceMetres ?? 0), 0),
    };
  });

  const planSports = new Set(workouts.flatMap((w) => w.slots.flatMap((slot) => ACCEPTS[slot])));
  const inPlan = (date: string) =>
    (!input.startDate || date >= input.startDate) && (!input.endDate || date <= input.endDate);
  const extra = activities
    .filter((a) => !used.has(a.id) && inPlan(a.date))
    .map((a) => ({
      activityId: a.id,
      countsTowardPlan: planSports.has(a.sport),
      seconds: activitySeconds(a),
      metres: a.distanceMetres ?? 0,
    }));

  const empty = (): Volume => ({ sessions: 0, seconds: 0, metres: 0 });
  const add = (volume: Volume, seconds: number, metres: number) => {
    volume.sessions += 1;
    volume.seconds += seconds;
    volume.metres += metres;
  };
  const outcomeOf = new Map(outcomes.map((o) => [o.workoutId, o]));
  const activityOf = new Map(activities.map((a) => [a.id, a]));
  const weekRows = weeks.map((week): WeekAdherence => {
    const row: WeekAdherence = {
      ...week,
      planned: empty(),
      due: empty(),
      actual: empty(),
      completed: 0,
      partial: 0,
      missed: 0,
      extra: 0,
    };
    // Linked activities count in the week of the workout they fulfilled.
    for (const workout of workouts.filter((w) => w.weekNumber === week.weekNumber)) {
      const outcome = outcomeOf.get(workout.id)!;
      const seconds = workout.durationSeconds ?? 0;
      const metres = workout.distanceMetres ?? 0;
      add(row.planned, seconds, metres);
      if (workout.date < today || outcome.activityIds.length) add(row.due, seconds, metres);
      if (outcome.activityIds.length) add(row.actual, outcome.actualSeconds, outcome.actualMetres);
      if (outcome.status === 'completed') row.completed += 1;
      if (outcome.status === 'partial') row.partial += 1;
      if (outcome.status === 'missed') row.missed += 1;
    }
    for (const { activityId, countsTowardPlan, seconds, metres } of extra) {
      const { date } = activityOf.get(activityId)!;
      if (date < week.startDate || date > week.endDate) continue;
      row.extra += 1;
      if (countsTowardPlan) add(row.actual, seconds, metres);
    }
    return row;
  });
  const toDate = { due: empty(), actual: empty() };
  for (const week of weekRows) {
    if (week.startDate > today) continue;
    for (const key of ['due', 'actual'] as const) {
      toDate[key].sessions += week[key].sessions;
      toDate[key].seconds += week[key].seconds;
      toDate[key].metres += week[key].metres;
    }
  }
  return { workouts: outcomes, extra, weeks: weekRows, toDate };
}
