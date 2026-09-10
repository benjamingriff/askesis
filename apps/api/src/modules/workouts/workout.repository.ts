import type { Selectable } from 'kysely';
import { getDatabase } from '../../database/client.js';
import type { Workouts } from '../../database/generated.js';
import {
  StepCompletionSchema,
  StepTargetSchema,
  WorkoutPrioritySchema,
  WorkoutStepKindSchema,
  type WorkoutDetail,
  type WorkoutStep,
  type WorkoutSummary,
} from './workout.schemas.js';

function formatDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

type TreeNode = Omit<WorkoutStep, 'steps'> & {
  steps: TreeNode[];
  position: number;
  parentId: string | null;
};

type WorkoutRow = Pick<
  Selectable<Workouts>,
  | 'id'
  | 'plan_version_id'
  | 'scheduled_date'
  | 'title'
  | 'description'
  | 'purpose'
  | 'primary_discipline'
  | 'priority'
  | 'estimated_duration_seconds'
  | 'estimated_distance_metres'
> & {
  plan_id: string;
  plan_title: string;
  week_number: number;
};

function toWorkoutSummary(row: WorkoutRow): WorkoutSummary {
  return {
    id: row.id,
    planId: row.plan_id,
    planVersionId: row.plan_version_id,
    planTitle: row.plan_title,
    weekNumber: row.week_number,
    scheduledDate: formatDate(row.scheduled_date),
    title: row.title,
    description: row.description,
    purpose: row.purpose,
    discipline: row.primary_discipline,
    priority: WorkoutPrioritySchema.parse(row.priority),
    estimatedDurationSeconds: row.estimated_duration_seconds,
    estimatedDistanceMetres:
      row.estimated_distance_metres === null ? null : Number(row.estimated_distance_metres),
  };
}

export async function listWorkouts(
  athleteId: string,
  planVersionId: string,
): Promise<WorkoutSummary[]> {
  const database = getDatabase();
  const query = database
    .selectFrom('workouts')
    .innerJoin('plan_versions', 'plan_versions.id', 'workouts.plan_version_id')
    .innerJoin('plans', 'plans.id', 'plan_versions.plan_id')
    .innerJoin('training_weeks', 'training_weeks.id', 'workouts.week_id')
    .select([
      'workouts.id',
      'plan_versions.plan_id',
      'workouts.plan_version_id',
      'workouts.scheduled_date',
      'workouts.title',
      'workouts.description',
      'workouts.purpose',
      'workouts.primary_discipline',
      'workouts.priority',
      'workouts.estimated_duration_seconds',
      'workouts.estimated_distance_metres',
      'plans.display_name as plan_title',
      'training_weeks.week_number',
    ])
    .where('plans.owner_id', '=', athleteId);

  const rows = await query
    .where('workouts.plan_version_id', '=', planVersionId)
    .orderBy('workouts.scheduled_date', 'asc')
    .orderBy('workouts.position', 'asc')
    .execute();

  return rows.map(toWorkoutSummary);
}

function optionalNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export async function getWorkoutDetail(
  athleteId: string,
  workoutId: string,
): Promise<WorkoutDetail | null> {
  const database = getDatabase();
  const workoutRow = await database
    .selectFrom('workouts')
    .innerJoin('plan_versions', 'plan_versions.id', 'workouts.plan_version_id')
    .innerJoin('plans', 'plans.id', 'plan_versions.plan_id')
    .innerJoin('training_weeks', 'training_weeks.id', 'workouts.week_id')
    .select([
      'workouts.id',
      'plan_versions.plan_id',
      'workouts.plan_version_id',
      'workouts.scheduled_date',
      'workouts.title',
      'workouts.description',
      'workouts.purpose',
      'workouts.primary_discipline',
      'workouts.priority',
      'workouts.estimated_duration_seconds',
      'workouts.estimated_distance_metres',
      'plans.display_name as plan_title',
      'training_weeks.week_number',
    ])
    .where('workouts.id', '=', workoutId)
    .where('plans.owner_id', '=', athleteId)
    .executeTakeFirst();

  if (workoutRow === undefined) return null;
  const brief = await database
    .selectFrom('plan_briefs')
    .select('distance_unit')
    .where('plan_version_id', '=', workoutRow.plan_version_id)
    .executeTakeFirst();
  const paceFactor = brief?.distance_unit === 'miles' ? 1.609344 : 1;

  const [stepRows, targetRows, tagRows, calibrationRows] = await Promise.all([
    database
      .selectFrom('workout_steps')
      .leftJoin('step_completions', 'step_completions.step_id', 'workout_steps.id')
      .leftJoin('movement_definitions', 'movement_definitions.id', 'workout_steps.movement_id')
      .select([
        'workout_steps.id',
        'workout_steps.parent_step_id',
        'workout_steps.position',
        'workout_steps.kind',
        'workout_steps.role',
        'workout_steps.discipline',
        'workout_steps.repeat_count',
        'workout_steps.label',
        'workout_steps.instructions',
        'movement_definitions.id as movement_id',
        'movement_definitions.name as movement_name',
        'movement_definitions.category as movement_category',
        'step_completions.completion_type',
        'step_completions.numeric_value as completion_value',
        'step_completions.unit as completion_unit',
        'step_completions.condition_type',
        'step_completions.condition_value',
      ])
      .where('workout_steps.workout_id', '=', workoutId)
      .execute(),
    database
      .selectFrom('step_targets')
      .innerJoin('workout_steps', 'workout_steps.id', 'step_targets.step_id')
      .select([
        'step_targets.step_id',
        'step_targets.position',
        'step_targets.target_type',
        'step_targets.minimum_value',
        'step_targets.target_value',
        'step_targets.maximum_value',
        'step_targets.unit',
        'step_targets.zone_system',
        'step_targets.zone_key',
        'step_targets.text_value',
      ])
      .where('workout_steps.workout_id', '=', workoutId)
      .orderBy('step_targets.position')
      .execute(),
    database
      .selectFrom('workout_tags')
      .select('tag')
      .where('workout_id', '=', workoutId)
      .orderBy('tag')
      .execute(),
    database
      .selectFrom('plan_calibration_periods')
      .innerJoin(
        'calibration_profiles',
        'calibration_profiles.id',
        'plan_calibration_periods.profile_id',
      )
      .innerJoin('calibration_zones', 'calibration_zones.profile_id', 'calibration_profiles.id')
      .select([
        'plan_calibration_periods.system',
        'calibration_profiles.id as profile_id',
        'calibration_profiles.method',
        'calibration_profiles.fitness_value',
        'calibration_zones.zone_key',
        'calibration_zones.metric',
        'plan_calibration_periods.effective_from',
        'calibration_profiles.calculator_version',
        'calibration_zones.minimum_value',
        'calibration_zones.target_value',
        'calibration_zones.maximum_value',
        'calibration_zones.unit',
      ])
      .where('plan_calibration_periods.plan_version_id', '=', workoutRow.plan_version_id)
      .where('plan_calibration_periods.effective_from', '<=', workoutRow.scheduled_date)
      .where((expression) =>
        expression.or([
          expression('plan_calibration_periods.effective_until', 'is', null),
          expression('plan_calibration_periods.effective_until', '>', workoutRow.scheduled_date),
        ]),
      )
      .execute(),
  ]);

  const resolvedZones = new Map(
    calibrationRows.map((row) => [
      `${row.system}:${row.zone_key}`,
      {
        profileId: row.profile_id,
        effectiveFrom: String(row.effective_from).slice(0, 10),
        calculatorVersion: row.calculator_version,
        method: row.method,
        fitnessValue: null,
        metric: row.metric,
        minimumValue: row.minimum_value === null ? null : Number(row.minimum_value) * paceFactor,
        targetValue: row.target_value === null ? null : Number(row.target_value) * paceFactor,
        maximumValue: row.maximum_value === null ? null : Number(row.maximum_value) * paceFactor,
        unit: paceFactor === 1 ? row.unit : 'seconds_per_mile',
      },
    ]),
  );

  const targetsByStep = new Map<string, ReturnType<typeof StepTargetSchema.parse>[]>();
  for (const row of targetRows) {
    const targets = targetsByStep.get(row.step_id) ?? [];
    const targetFactor = row.unit === 'seconds_per_kilometre' ? paceFactor : 1;
    const displayValue = (value: string | number | null) =>
      value === null ? null : Number(value) * targetFactor;
    const resolvedZone =
      row.zone_system === null || row.zone_key === null
        ? null
        : (resolvedZones.get(`${row.zone_system}:${row.zone_key}`) ?? null);

    targets.push(
      StepTargetSchema.parse({
        type: row.target_type,
        minimumValue: displayValue(row.minimum_value),
        targetValue: displayValue(row.target_value),
        maximumValue: displayValue(row.maximum_value),
        unit: targetFactor === 1 ? row.unit : 'seconds_per_mile',
        zoneSystem: row.zone_system,
        zoneKey: row.zone_key,
        text: row.text_value,
        resolvedZone,
      }),
    );
    targetsByStep.set(row.step_id, targets);
  }

  const nodes = new Map<string, TreeNode>();
  for (const row of stepRows) {
    const completion =
      row.completion_type === null
        ? null
        : StepCompletionSchema.parse({
            type: row.completion_type,
            value: optionalNumber(row.completion_value),
            unit: row.completion_unit,
            conditionType: row.condition_type,
            conditionValue: row.condition_value,
          });

    nodes.set(row.id, {
      id: row.id,
      kind: WorkoutStepKindSchema.parse(row.kind),
      role: row.role,
      discipline: row.discipline,
      repeatCount: row.repeat_count,
      label: row.label,
      instructions: row.instructions,
      movement:
        row.movement_id === null
          ? null
          : {
              id: row.movement_id,
              name: row.movement_name ?? '',
              category: row.movement_category ?? '',
            },
      completion,
      targets: targetsByStep.get(row.id) ?? [],
      steps: [],
      position: row.position,
      parentId: row.parent_step_id,
    });
  }

  let root: TreeNode | undefined;
  for (const node of nodes.values()) {
    if (node.parentId === null) {
      root = node;
    } else {
      const parent = nodes.get(node.parentId);
      if (parent === undefined) throw new Error(`Missing parent step ${node.parentId}`);
      parent.steps.push(node);
    }
  }

  if (root === undefined) throw new Error(`Workout ${workoutId} has no prescription root`);
  for (const node of nodes.values()) {
    node.steps.sort((left, right) => left.position - right.position);
  }

  const toPublicStep = (node: TreeNode): WorkoutStep => ({
    id: node.id,
    kind: node.kind,
    role: node.role,
    discipline: node.discipline,
    repeatCount: node.repeatCount,
    label: node.label,
    instructions: node.instructions,
    movement: node.movement,
    completion: node.completion,
    targets: node.targets,
    steps: node.steps.map(toPublicStep),
  });

  return {
    workout: toWorkoutSummary(workoutRow),
    tags: tagRows.map(({ tag }) => tag),
    prescription: toPublicStep(root),
  };
}
