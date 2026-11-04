import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/generated.js';

export class ChatError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 503 = 409,
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
/**
 * New coaching runs share-lock the athlete, so a deletion request (which takes the row lock)
 * either sees the run and cancels it, or the run sees the pending deletion and is refused.
 */
export async function assertAccountOpen(db: Transaction<DB>, owner: string, lock = true) {
  let query = db.selectFrom('athletes').select('deletion_requested_at').where('id', '=', owner);
  if (lock) query = query.forShare();
  const athlete = await query.executeTakeFirst();
  if (athlete?.deletion_requested_at)
    throw new ChatError(
      'ACCOUNT_DELETION_PENDING',
      'This account is scheduled for deletion. Cancel the deletion to continue.',
      403,
    );
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
