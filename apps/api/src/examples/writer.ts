import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { DB } from '../database/generated.js';
import { buildExample, shiftDay, type Step } from './blueprint.js';

/** Operator writer for schema-supported fields that the coach does not yet expose. */
export async function writeExample(db: Transaction<DB>, versionId: string, anchor: string) {
  const blueprint = buildExample(anchor);
  const movements = new Map<string, string>();
  const blockIds: string[] = [];
  for (const [index, block] of blueprint.blocks.entries()) {
    const id = randomUUID();
    blockIds.push(id);
    await db
      .insertInto('training_blocks')
      .values({
        id,
        plan_version_id: versionId,
        position: index + 1,
        title: block.title,
        phase: block.phase,
        description: block.description,
        start_date: block.startDate,
        end_date: block.endDate,
      })
      .execute();
  }
  for (const week of blueprint.weeks) {
    const weekId = randomUUID();
    await db
      .insertInto('training_weeks')
      .values({
        id: weekId,
        plan_version_id: versionId,
        block_id: blockIds[week.blockIndex]!,
        week_number: week.index + 1,
        position: week.position,
        cutback: week.cutback,
        title: week.title,
        description:
          'Friday is a prescribed rest day. Monday and Sunday demonstrate ordered double sessions.',
        start_date: week.startDate,
        end_date: week.endDate,
      })
      .execute();
    const scale = week.volume;
    const targets = [
      { metric: 'distance', discipline: 'run', target: 25000 * scale, unit: 'metres' },
      { metric: 'distance', discipline: 'swim', target: 3600, unit: 'metres' },
      { metric: 'duration', discipline: 'cycle', target: 9000, unit: 'seconds' },
      { metric: 'hard_session_count', discipline: null, target: 3, unit: 'sessions' },
      { metric: 'strength_session_count', discipline: 'strength', target: 2, unit: 'sessions' },
      { metric: 'training_load', discipline: null, target: 350 * scale, unit: 'arbitrary_units' },
    ];
    for (const target of targets)
      await db
        .insertInto('week_targets')
        .values({
          plan_version_id: versionId,
          week_id: weekId,
          metric: target.metric,
          discipline: target.discipline,
          minimum_value: target.metric.endsWith('_count')
            ? Math.floor(target.target * 0.8)
            : target.target * 0.8,
          target_value: target.target,
          maximum_value: target.metric.endsWith('_count')
            ? Math.ceil(target.target * 1.2)
            : target.target * 1.2,
          unit: target.unit,
        })
        .execute();
    const positions = new Map<number, number>();
    for (const { day, session } of week.sessions) {
      const workoutId = randomUUID();
      const position = (positions.get(day) ?? 0) + 1;
      positions.set(day, position);
      await db
        .insertInto('workouts')
        .values({
          id: workoutId,
          plan_version_id: versionId,
          week_id: weekId,
          scheduled_date: shiftDay(week.startDate, day),
          position,
          title: session.title,
          description:
            'Committed multisport software example. Suggested values illustrate the model; adapt prescriptions before training.',
          purpose: session.purpose,
          primary_discipline: session.sport,
          race_priority: session.race ?? null,
          priority: session.race || day === 5 ? 'high' : day === 0 ? 'low' : 'medium',
          estimated_duration_seconds: session.minutes * 60,
          estimated_distance_metres: session.metres ?? null,
        })
        .execute();
      await db
        .insertInto('workout_tags')
        .values(
          session.tags.map((tag) => ({ workout_id: workoutId, plan_version_id: versionId, tag })),
        )
        .execute();
      async function writeStep(step: Step, parent: string | null, order: number) {
        const id = randomUUID();
        let movementId: string | null = null;
        if (step.movement) {
          movementId = movements.get(step.movement) ?? randomUUID();
          if (!movements.has(step.movement)) {
            await db
              .insertInto('movement_definitions')
              .values({
                id: movementId,
                name: step.movement,
                category: 'supporting_strength',
                primary_discipline: 'strength',
                instructions:
                  'Use a controlled range of motion and the prescribed repetitions in reserve.',
              })
              .execute();
            movements.set(step.movement, movementId);
          }
        }
        await db
          .insertInto('workout_steps')
          .values({
            id,
            plan_version_id: versionId,
            workout_id: workoutId,
            parent_step_id: parent,
            position: order,
            kind: step.kind ?? 'effort',
            role: step.role ?? null,
            discipline: step.kind ? null : (step.sport ?? null),
            movement_id: movementId,
            repeat_count: step.repeat ?? null,
            label: step.label,
            instructions: step.instructions ?? null,
          })
          .execute();
        if (step.completion)
          await db
            .insertInto('step_completions')
            .values({ ...step.completion, step_id: id, plan_version_id: versionId })
            .execute();
        for (const [index, target] of (step.targets ?? []).entries())
          await db
            .insertInto('step_targets')
            .values({ ...target, step_id: id, plan_version_id: versionId, position: index + 1 })
            .execute();
        for (const [index, child] of (step.steps ?? []).entries())
          await writeStep(child, id, index + 1);
      }
      await writeStep({ label: session.title, kind: 'sequence', steps: session.steps }, null, 1);
    }
  }
}
