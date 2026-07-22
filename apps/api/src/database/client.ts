import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './generated.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://askesis:askesis@localhost:5432/askesis';

const pool = new Pool({ connectionString, max: 10 });

export const database = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});

export async function closeDatabase(): Promise<void> {
  await database.destroy();
}
