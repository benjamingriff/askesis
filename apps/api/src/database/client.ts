import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { getApiConfig } from '../config.js';
import type { DB } from './generated.js';

let database: Kysely<DB> | undefined;

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
