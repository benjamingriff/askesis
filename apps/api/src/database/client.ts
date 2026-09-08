import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { getApiConfig } from '../config.js';
import type { DB } from './generated.js';

let database: Kysely<DB> | undefined;

// PostgreSQL DATE is a calendar day, not a local-midnight instant. Keep it as
// YYYY-MM-DD so UTC serialization cannot shift dates in positive-offset zones.
types.setTypeParser(types.builtins.DATE, (value) => value);

export function getDatabase(): Kysely<DB> {
  database ??= new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: getApiConfig().DATABASE_URL, max: 10 }),
    }),
  });
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (database === undefined) return;
  await database.destroy();
  database = undefined;
}
