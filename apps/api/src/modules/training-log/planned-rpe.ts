import type { WorkoutStep } from '../workouts/workout.schemas.js';
import type { Database } from '../plans/plan.aggregate.js';
import { readEntries, resolveCalibration } from '../performance/performance.service.js';
/** Approximate session effort, not a measure of fitness or actual training load. */
const ZONE_RPE: Record<string, number> = {
  recovery: 2,
  easy: 3,
  endurance: 3,
  marathon: 5,
  tempo: 5,
  sweet_spot: 6,
  threshold: 7,
  interval: 8,
  vo2max: 8,
  speed: 9,
  repetition: 9,
  anaerobic: 9,
};
const DEFAULT_PACE: Record<string, number> = {
  run: 360,
  cycle: 120,
  swim: 1200,
  row: 240,
  ski_erg: 270,
};
export type EffortNode = {
  id: string;
  parentId: string | null;
  kind: string;
  repeatCount: number | null;
  discipline: string | null;
  completion: { value: number | null; unit: string | null } | null;
  rpe: number | null;
  zoneKey: string | null;
  pacePerKm: number | null;
};
export function plannedRpe(nodes: EffortNode[]): number | null {
  const children = new Map<string | null, EffortNode[]>();
  for (const node of nodes)
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  let weighted = 0,
    total = 0;
  const visit = (parent: string | null, multiplier: number, seen: Set<string>) => {
    for (const node of children.get(parent) ?? []) {
      if (seen.has(node.id)) continue;
      const next = new Set(seen).add(node.id);
      if (node.kind !== 'effort') {
        visit(node.id, multiplier * (node.kind === 'repeat' ? (node.repeatCount ?? 1) : 1), next);
        continue;
      }
      const rpe = node.rpe ?? (node.zoneKey ? ZONE_RPE[node.zoneKey] : undefined);
      if (rpe == null) continue;
      const value = node.completion?.value;
      const unit = node.completion?.unit;
      const pace = node.pacePerKm ?? DEFAULT_PACE[node.discipline ?? 'run'] ?? 360;
      const seconds =
        value == null
          ? 60
          : unit === 'seconds'
            ? value
            : unit === 'minutes'
              ? value * 60
              : unit === 'hours'
                ? value * 3600
                : unit === 'metres'
                  ? (value * pace) / 1000
                  : unit === 'kilometres'
                    ? value * pace
                    : unit === 'miles'
                      ? value * 1.609344 * pace
                      : unit === 'repetitions'
                        ? value * 3
                        : 60;
      weighted += rpe * seconds * multiplier;
      total += seconds * multiplier;
    }
  };
  visit(null, 1, new Set());
  return total > 0 ? Math.round((weighted / total) * 10) / 10 : null;
}
export async function loadPlannedRpe(
  db: Database,
  athleteId: string,
  workouts: { id: string; date: string; discipline: string }[],
) {
  if (!workouts.length) return new Map<string, number | null>();
  const ids = workouts.map((w) => w.id);
  const [steps, targets, entries] = await Promise.all([
    db
      .selectFrom('workout_steps as s')
      .leftJoin('step_completions as c', 'c.step_id', 's.id')
      .select([
        's.id',
        's.workout_id',
        's.parent_step_id',
        's.kind',
        's.repeat_count',
        's.discipline',
        'c.numeric_value',
        'c.unit',
      ])
      .where('s.workout_id', 'in', ids)
      .execute(),
    db
      .selectFrom('step_targets as t')
      .innerJoin('workout_steps as s', 's.id', 't.step_id')
      .select([
        't.step_id',
        't.target_type',
        't.target_value',
        't.minimum_value',
        't.maximum_value',
        't.zone_key',
        't.zone_system',
        't.unit',
      ])
      .where('s.workout_id', 'in', ids)
      .execute(),
    readEntries(db, athleteId),
  ]);
  const byStep = new Map<string, typeof targets>();
  for (const target of targets)
    byStep.set(target.step_id, [...(byStep.get(target.step_id) ?? []), target]);
  const paceKm = (v: number | null, u: string | null) =>
    v == null
      ? null
      : u === 'seconds_per_kilometre'
        ? v
        : u === 'seconds_per_mile'
          ? v / 1.609344
          : u === 'seconds_per_100_metres'
            ? v * 10
            : null;
  const numeric = (v: string | null) => (v == null ? null : Number(v));
  const byWorkout = new Map<string, typeof steps>();
  for (const step of steps)
    byWorkout.set(step.workout_id, [...(byWorkout.get(step.workout_id) ?? []), step]);
  return new Map(
    workouts.map((w) => [
      w.id,
      plannedRpe(
        (byWorkout.get(w.id) ?? []).map((s) => {
          const ts = byStep.get(s.id) ?? [];
          const rpe = ts.find((t) => t.target_type === 'rpe');
          const zone = ts.find((t) => t.target_type === 'zone');
          const explicit = ts.find(
            (t) => t.target_type === 'pace' || t.target_type === 'swim_pace',
          );
          const calibrated = zone?.zone_system
            ? resolveCalibration(entries, zone.zone_system, w.date)?.zones.find(
                (z) => z.key === zone.zone_key,
              )
            : undefined;
          return {
            id: s.id,
            parentId: s.parent_step_id,
            kind: s.kind,
            repeatCount: s.repeat_count,
            discipline: s.discipline ?? w.discipline,
            completion: { value: numeric(s.numeric_value), unit: s.unit },
            rpe: rpe
              ? (numeric(rpe.target_value) ??
                (rpe.minimum_value && rpe.maximum_value
                  ? (Number(rpe.minimum_value) + Number(rpe.maximum_value)) / 2
                  : null))
              : null,
            zoneKey: zone?.zone_key ?? null,
            pacePerKm:
              paceKm(numeric(explicit?.target_value ?? null), explicit?.unit ?? null) ??
              paceKm(calibrated?.target ?? null, calibrated?.unit ?? null),
          };
        }),
      ),
    ]),
  );
}

/** Reuse the already resolved prescription on detail reads, avoiding a second database traversal. */
export function prescriptionRpe(root: WorkoutStep, discipline: string): number | null {
  const nodes: EffortNode[] = [];
  const paceKm = (v: number | null, u: string | null) =>
    v == null
      ? null
      : u === 'seconds_per_kilometre'
        ? v
        : u === 'seconds_per_mile'
          ? v / 1.609344
          : u === 'seconds_per_100_metres'
            ? v * 10
            : null;
  const visit = (step: WorkoutStep, parentId: string | null) => {
    const rpe = step.targets.find((t) => t.type === 'rpe');
    const zone = step.targets.find((t) => t.type === 'zone');
    const pace = step.targets.find((t) => t.type === 'pace');
    nodes.push({
      id: step.id,
      parentId,
      kind: step.kind,
      repeatCount: step.repeatCount,
      discipline: step.discipline ?? discipline,
      completion: step.completion,
      rpe:
        rpe?.targetValue ??
        (rpe?.minimumValue != null && rpe.maximumValue != null
          ? (rpe.minimumValue + rpe.maximumValue) / 2
          : null),
      zoneKey: zone?.zoneKey ?? null,
      pacePerKm:
        paceKm(pace?.targetValue ?? null, pace?.unit ?? null) ??
        paceKm(zone?.resolvedZone?.targetValue ?? null, zone?.resolvedZone?.unit ?? null),
    });
    for (const child of step.steps) visit(child, step.id);
  };
  visit(root, null);
  return plannedRpe(nodes);
}
