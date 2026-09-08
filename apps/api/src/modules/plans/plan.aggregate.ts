import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../database/generated.js';
import { canonicalDecimal, canonicalJson, type SemanticValue } from './plan.canonical.js';
import type { ValidationPlan } from './plan.validation.js';

export type Database = Kysely<DB> | Transaction<DB>;
type Row = Record<string, string | number | Date | null>;
export const contentTables = [
  'plan_goals',
  'plan_constraints',
  'calibration_profiles',
  'calibration_zones',
  'plan_calibration_periods',
  'training_blocks',
  'training_weeks',
  'week_targets',
  'workouts',
  'workout_tags',
  'workout_steps',
  'step_completions',
  'step_targets',
] as const;
type Table = (typeof contentTables)[number];
export type Aggregate = {
  semantic: SemanticValue;
  validation: ValidationPlan;
  entities: Record<string, { lineage: string; value: SemanticValue }[]>;
};
const excluded = new Set(['id', 'lineage_id', 'plan_version_id', 'created_at', 'updated_at']);
const numeric = new Set([
  'numeric_value',
  'minimum_value',
  'target_value',
  'maximum_value',
  'fitness_value',
  'distance_value',
  'estimated_distance_metres',
]);
const date = (value: Row[string] | undefined): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value);

export async function readAggregate(db: Database, versionId: string): Promise<Aggregate> {
  const version = await db
    .selectFrom('plan_versions')
    .selectAll()
    .where('id', '=', versionId)
    .executeTakeFirstOrThrow();
  const entries = await Promise.all(
    contentTables.map(async (table) => {
      const result =
        await sql<Row>`SELECT * FROM ${sql.table(table)} WHERE plan_version_id = ${versionId}::uuid`.execute(
          db,
        );
      return [table, result.rows] as const;
    }),
  );
  const rows = Object.fromEntries(entries) as Record<Table, Row[]>;
  const movementRows = await sql<Row>`SELECT DISTINCT m.* FROM movement_definitions m
    JOIN workout_steps s ON s.movement_id = m.id WHERE s.plan_version_id = ${versionId}::uuid`.execute(
    db,
  );
  const movements = new Map(movementRows.rows.map((row) => [String(row.id), row]));
  const entities: Aggregate['entities'] = {};
  function fields(row: Row): Record<string, SemanticValue> {
    return Object.fromEntries(
      Object.entries(row)
        .filter(
          ([key]) => !excluded.has(key) && !key.endsWith('_id') && key !== 'definition_number',
        )
        .map(([key, value]) => [
          key,
          value instanceof Date
            ? date(value)
            : numeric.has(key) && value !== null
              ? canonicalDecimal(String(value))
              : value,
        ]),
    );
  }
  function ordered(values: SemanticValue[]) {
    return values.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), 'en'));
  }
  function children(table: Table, key: string, id: Row[string] | undefined): Row[] {
    return rows[table].filter((row) => row[key] === id);
  }
  const ancestry = new Map(
    entries.flatMap(([, values]) => values.map((row) => [row.id, row.lineage_id] as const)),
  );
  function capture(table: string, row: Row, value: SemanticValue) {
    const relationships = Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => key.endsWith('_id') && !excluded.has(key) && key !== 'movement_id')
        .map(([key, id]) => [key, id === null ? null : String(ancestry.get(id) ?? id)]),
    );
    (entities[table] ??= []).push({
      lineage: String(row.lineage_id),
      value: { content: value, relationships },
    });
    return value;
  }
  function leaf(table: Table, row: Row): SemanticValue {
    return capture(table, row, fields(row));
  }
  function step(row: Row, visiting: Set<string>): SemanticValue {
    const id = String(row.id);
    if (visiting.has(id)) throw new Error('Cyclic workout prescription');
    const next = new Set(visiting).add(id);
    const movement = movements.get(String(row.movement_id));
    return capture('workout_steps', row, {
      ...fields(row),
      movement: movement === undefined ? null : fields(movement),
      completion: children('step_completions', 'step_id', row.id).map(fields)[0] ?? null,
      targets: ordered(
        children('step_targets', 'step_id', row.id).map((target) => leaf('step_targets', target)),
      ),
      steps: ordered(
        children('workout_steps', 'parent_step_id', row.id).map((child) => step(child, next)),
      ),
    });
  }
  function workout(row: Row): SemanticValue {
    const allSteps = children('workout_steps', 'workout_id', row.id);
    const roots = allSteps.filter((item) => item.parent_step_id === null);
    // Walking every node catches disconnected cycles as well as cycles beneath a root.
    for (const item of allSteps) {
      const visited = new Set<string>();
      let current: Row | undefined = item;
      while (current !== undefined) {
        if (visited.has(String(current.id))) throw new Error('Cyclic workout prescription');
        visited.add(String(current.id));
        current = allSteps.find((candidate) => candidate.id === current?.parent_step_id);
      }
    }
    return capture('workouts', row, {
      ...fields(row),
      tags: children('workout_tags', 'workout_id', row.id)
        .map((tag) => String(tag.tag))
        .sort(),
      prescription: ordered(roots.map((root) => step(root, new Set()))),
    });
  }
  const blocks = rows.training_blocks.map((block) =>
    capture('training_blocks', block, {
      ...fields(block),
      weeks: ordered(
        children('training_weeks', 'block_id', block.id).map((week) =>
          capture('training_weeks', week, {
            ...fields(week),
            targets: ordered(
              children('week_targets', 'week_id', week.id).map((target) =>
                leaf('week_targets', target),
              ),
            ),
            workouts: ordered(children('workouts', 'week_id', week.id).map(workout)),
          }),
        ),
      ),
    }),
  );
  return {
    semantic: {
      description: version.description,
      startDate: version.start_date === null ? null : date(version.start_date),
      endDate: version.end_date === null ? null : date(version.end_date),
      goals: ordered(rows.plan_goals.map((row) => leaf('plan_goals', row))),
      constraints: ordered(rows.plan_constraints.map((row) => leaf('plan_constraints', row))),
      blocks: ordered(blocks),
      calibrations: ordered(
        rows.calibration_profiles.map((profile) =>
          capture('calibration_profiles', profile, {
            ...fields(profile),
            zones: ordered(
              children('calibration_zones', 'profile_id', profile.id).map((row) =>
                leaf('calibration_zones', row),
              ),
            ),
            periods: ordered(
              children('plan_calibration_periods', 'profile_id', profile.id).map((row) =>
                leaf('plan_calibration_periods', row),
              ),
            ),
          }),
        ),
      ),
    },
    entities,
    validation: {
      startDate: version.start_date === null ? null : date(version.start_date),
      endDate: version.end_date === null ? null : date(version.end_date),
      blocks: rows.training_blocks.map((row) => ({
        id: String(row.id),
        startDate: date(row.start_date),
        endDate: date(row.end_date),
      })),
      weeks: rows.training_weeks.map((row) => ({
        id: String(row.id),
        blockId: String(row.block_id),
        startDate: date(row.start_date),
        endDate: date(row.end_date),
      })),
      workouts: rows.workouts.map((row) => ({
        id: String(row.id),
        weekId: String(row.week_id),
        scheduledDate: date(row.scheduled_date),
      })),
    },
  };
}

export function summarizeChanges(before: Aggregate | null, after: Aggregate) {
  return Object.fromEntries(
    Object.entries(after.entities)
      .concat(
        Object.keys(before?.entities ?? {})
          .filter((key) => !(key in after.entities))
          .map((key) => [key, []] as [string, Aggregate['entities'][string]]),
      )
      .map(([table, items]) => {
        const previous = new Map(
          (before?.entities[table] ?? []).map((item) => [item.lineage, item.value]),
        );
        const current = new Set(items.map((item) => item.lineage));
        return [
          table,
          {
            added: items.filter((item) => !previous.has(item.lineage)).length,
            changed: items.filter(
              (item) =>
                previous.has(item.lineage) &&
                canonicalJson(previous.get(item.lineage)!) !== canonicalJson(item.value),
            ).length,
            removed: [...previous.keys()].filter((lineage) => !current.has(lineage)).length,
          },
        ];
      }),
  );
}

/** Bulk cloning uses one temporary ID map shared by all tables in this transaction. */
export async function cloneContent(db: Transaction<DB>, source: string, destination: string) {
  await sql`CREATE TEMP TABLE plan_clone_ids(old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP`.execute(
    db,
  );
  const withIds = contentTables.filter(
    (table) => table !== 'workout_tags' && table !== 'step_completions',
  );
  for (const table of withIds) {
    await sql`INSERT INTO plan_clone_ids SELECT id, gen_random_uuid() FROM ${sql.table(table)} WHERE plan_version_id = ${source}::uuid`.execute(
      db,
    );
  }
  for (const table of contentTables) {
    const result = await sql<{
      column_name: string;
    }>`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`.execute(
      db,
    );
    const columns = result.rows
      .map((row) => row.column_name)
      .filter((name) => !['created_at', 'updated_at'].includes(name));
    const expressions = columns.map((column) => {
      if (column === 'plan_version_id') return sql`${destination}::uuid`;
      if (
        column === 'id' ||
        ['block_id', 'week_id', 'workout_id', 'step_id', 'parent_step_id', 'profile_id'].includes(
          column,
        )
      ) {
        return sql`(SELECT new_id FROM plan_clone_ids WHERE old_id = ${sql.ref(`source.${column}`)})`;
      }
      return sql.ref(`source.${column}`);
    });
    await sql`INSERT INTO ${sql.table(table)} (${sql.join(columns.map((column) => sql.ref(column)))})
      SELECT ${sql.join(expressions)} FROM ${sql.table(table)} AS source WHERE plan_version_id = ${source}::uuid`.execute(
      db,
    );
  }
}

export async function deleteDraftContent(db: Transaction<DB>, versionId: string) {
  for (const table of [...contentTables].reverse()) {
    await sql`DELETE FROM ${sql.table(table)} WHERE plan_version_id = ${versionId}::uuid`.execute(
      db,
    );
  }
  await db.deleteFrom('plan_versions').where('id', '=', versionId).execute();
}
