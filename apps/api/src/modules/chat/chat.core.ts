import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/generated.js';

export class ChatError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 404 | 409 | 503 = 409,
  ) {
    super(message);
  }
}
export const activeStatuses = ['queued', 'running', 'cancelling'] as const;
export async function assertPlanIdle(db: Transaction<DB>, planId: string) {
  const run = await db
    .selectFrom('agent_runs')
    .select('id')
    .where((eb) => eb.or([eb('plan_id', '=', planId), eb('execution_plan_id', '=', planId)]))
    .where('status', 'in', activeStatuses)
    .executeTakeFirst();
  if (run) throw new ChatError('RUN_ACTIVE', 'Stop the active chat run before changing this plan.');
}
export async function createConversationRow(
  db: Transaction<DB>,
  owner: string,
  planId: string | null,
  title = 'New conversation',
) {
  const id = randomUUID();
  await db
    .insertInto('conversations')
    .values({ id, owner_id: owner, plan_id: planId, title })
    .execute();
  return id;
}
