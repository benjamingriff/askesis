import { sql, type Transaction } from 'kysely';
import { getDatabase } from '../../database/client.js';
import type { DB } from '../../database/generated.js';
import { logger } from '../../logger.js';
import { activeStatuses, ChatError } from '../chat/chat.core.js';
import { transition } from '../chat/chat.service.js';
import { readAggregate } from '../plans/plan.aggregate.js';
import { readEntries } from '../performance/performance.service.js';
import { purgeAccountRows, purgePlanRows } from './purge.js';
import {
  ACCOUNT_GRACE_DAYS,
  DAY_MS,
  IDEMPOTENCY_RETENTION_DAYS,
  LIVE_EVENT_RETENTION_DAYS,
  logDeletionEvent,
  PLAN_RESTORE_DAYS,
  type DeletionEvent,
} from './retention.js';

type Tx = Transaction<DB>;
const iso = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString();

export async function getAccount(athleteId: string) {
  const athlete = await getDatabase()
    .selectFrom('athletes')
    .select(['deletion_requested_at', 'purge_after'])
    .where('id', '=', athleteId)
    .executeTakeFirstOrThrow();
  return {
    deletion: athlete.deletion_requested_at
      ? { requestedAt: iso(athlete.deletion_requested_at)!, purgeAfter: iso(athlete.purge_after)! }
      : null,
  };
}

/** Stops coaching for the athlete; nothing can start while deletion is pending. */
async function cancelActiveRuns(db: Tx, athleteId: string) {
  const runs = await db
    .selectFrom('agent_runs')
    .selectAll()
    .where('owner_id', '=', athleteId)
    .where('status', 'in', activeStatuses)
    .forUpdate()
    .execute();
  for (const run of runs) {
    if (run.status === 'queued') await transition(db, run, 'cancelled', 'cancelled');
    else if (run.status === 'running') await transition(db, run, 'cancelling', 'cancel_requested');
  }
}

export async function requestAccountDeletion(athleteId: string, now = new Date()) {
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      // Runs before the athlete, the order coaching tools use, so the two cannot deadlock.
      await cancelActiveRuns(db, athleteId);
      const athlete = await db
        .selectFrom('athletes')
        .select('deletion_requested_at')
        .where('id', '=', athleteId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (athlete.deletion_requested_at) return;
      await db
        .updateTable('athletes')
        .set({
          deletion_requested_at: now,
          purge_after: new Date(now.getTime() + ACCOUNT_GRACE_DAYS * DAY_MS),
          updated_at: now,
        })
        .where('id', '=', athleteId)
        .execute();
      // A message accepted while this waited for the athlete lock has committed its run.
      await cancelActiveRuns(db, athleteId);
    });
  const account = await getAccount(athleteId);
  if (account.deletion)
    logDeletionEvent({
      event: 'account.deletion_requested',
      athleteId,
      at: account.deletion.requestedAt,
    });
  return account;
}

export async function cancelAccountDeletion(athleteId: string) {
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      const athlete = await db
        .selectFrom('athletes')
        .select(['deletion_requested_at', 'purge_started_at'])
        .where('id', '=', athleteId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (!athlete.deletion_requested_at) return;
      if (athlete.purge_started_at)
        throw new ChatError('ACCOUNT_PURGE_STARTED', 'This account is already being deleted.');
      await db
        .updateTable('athletes')
        .set({
          deletion_requested_at: null,
          purge_after: null,
          updated_at: new Date(),
        })
        .where('id', '=', athleteId)
        .execute();
    });
  logDeletionEvent({ event: 'account.deletion_cancelled', athleteId });
  return getAccount(athleteId);
}

/** The identity was deleted in Clerk, so there is no account left to return to. */
export async function scheduleImmediatePurge(clerkUserId: string, now = new Date()) {
  const identity = await getDatabase()
    .selectFrom('athlete_identities')
    .select('athlete_id')
    .where('provider', '=', 'clerk')
    .where('provider_subject', '=', clerkUserId)
    .executeTakeFirst();
  if (!identity) return false;
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      await db
        .updateTable('athletes')
        .set({
          deletion_requested_at: sql`coalesce(deletion_requested_at, ${now})`,
          purge_after: now,
          updated_at: now,
        })
        .where('id', '=', identity.athlete_id)
        .execute();
      await cancelActiveRuns(db, identity.athlete_id);
    });
  logDeletionEvent({
    event: 'account.deletion_requested',
    athleteId: identity.athlete_id,
    at: now.toISOString(),
  });
  return true;
}

/** Deletes the sign-in identity. Resolves when it is gone, including when it already was. */
export type DeleteIdentity = (clerkUserId: string) => Promise<void>;

export type RetentionResult = {
  plans: number;
  accounts: number;
  idempotencyKeys: number;
  liveEvents: number;
};

/**
 * One retention pass. Each purge is its own transaction, claimed with SKIP LOCKED so
 * concurrent API instances share the work; a purge that fails is retried on the next pass.
 */
export async function runRetention(
  options: { now?: Date; deleteIdentity?: DeleteIdentity | undefined } = {},
): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const database = getDatabase();
  const result: RetentionResult = { plans: 0, accounts: 0, idempotencyKeys: 0, liveEvents: 0 };

  const planCutoff = new Date(now.getTime() - PLAN_RESTORE_DAYS * DAY_MS);
  const plans = await database
    .selectFrom('plans')
    .select('id')
    .where('deleted_at', '<=', planCutoff)
    .orderBy('deleted_at')
    .execute();
  for (const { id } of plans) {
    try {
      const purged = await database.transaction().execute(async (db) => {
        const due = await db
          .selectFrom('plans')
          .select('id')
          .where('id', '=', id)
          .where('deleted_at', '<=', planCutoff)
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        return due ? purgePlanRows(db, id) : false;
      });
      if (purged) {
        result.plans += 1;
        logDeletionEvent({ event: 'plan.purged', planId: id, at: now.toISOString() });
      }
    } catch {
      logger.error({ planId: id }, 'Plan purge failed; it will be retried.');
    }
  }

  const accounts = await database
    .selectFrom('athletes')
    .select('id')
    .where('purge_after', '<=', now)
    .orderBy('purge_after')
    .execute();
  for (const { id } of accounts) {
    try {
      if (await purgeAccount(id, now, options.deleteIdentity)) {
        result.accounts += 1;
        logDeletionEvent({ event: 'account.purged', athleteId: id, at: now.toISOString() });
      }
    } catch {
      // Clerk and database errors can carry personal details; the id is enough to retry.
      logger.error({ athleteId: id }, 'Account purge failed; it will be retried.');
    }
  }

  const keys = await database
    .deleteFrom('api_idempotency_keys')
    .where('created_at', '<', new Date(now.getTime() - IDEMPOTENCY_RETENTION_DAYS * DAY_MS))
    .executeTakeFirst();
  result.idempotencyKeys = Number(keys.numDeletedRows);
  // The journal trigger only prunes busy accounts; quiet ones are pruned here.
  const events = await database
    .deleteFrom('live_events')
    .where('created_at', '<', new Date(now.getTime() - LIVE_EVENT_RETENTION_DAYS * DAY_MS))
    .executeTakeFirst();
  result.liveEvents = Number(events.numDeletedRows);
  return result;
}

/**
 * Re-applies logged deletion events, in order, to a database restored from a backup taken
 * before them. Run it before the restored API takes traffic. Events for rows the backup never
 * had, or that are already gone, change nothing.
 */
export async function replayDeletionEvents(events: DeletionEvent[]) {
  let applied = 0;
  for (const event of events) {
    const changed = await getDatabase()
      .transaction()
      .execute(async (db): Promise<boolean> => {
        switch (event.event) {
          case 'plan.deleted': {
            const plan = await db
              .selectFrom('plans')
              .select(['archived_at', 'deleted_at'])
              .where('id', '=', event.planId)
              .forUpdate()
              .executeTakeFirst();
            if (!plan || plan.deleted_at) return false;
            await db
              .updateTable('plans')
              .set({
                ...(plan.archived_at
                  ? {}
                  : { archived_at: new Date(event.at), activated_at: null }),
                deleted_at: new Date(event.at),
                state_version: sql`state_version + 1`,
              })
              .where('id', '=', event.planId)
              .execute();
            return true;
          }
          case 'plan.restored': {
            const restored = await db
              .updateTable('plans')
              .set({ deleted_at: null, state_version: sql`state_version + 1` })
              .where('id', '=', event.planId)
              .where('deleted_at', 'is not', null)
              .executeTakeFirst();
            return restored.numUpdatedRows > 0n;
          }
          case 'plan.purged':
            return purgePlanRows(db, event.planId, new Date(event.at));
          case 'account.deletion_requested': {
            const requested = await db
              .updateTable('athletes')
              .set({
                deletion_requested_at: new Date(event.at),
                purge_after: new Date(Date.parse(event.at) + ACCOUNT_GRACE_DAYS * DAY_MS),
              })
              .where('id', '=', event.athleteId)
              .where('deletion_requested_at', 'is', null)
              .executeTakeFirst();
            if (requested.numUpdatedRows === 0n) return false;
            await cancelActiveRuns(db, event.athleteId);
            return true;
          }
          case 'account.deletion_cancelled': {
            const cancelled = await db
              .updateTable('athletes')
              .set({ deletion_requested_at: null, purge_after: null })
              .where('id', '=', event.athleteId)
              .where('deletion_requested_at', 'is not', null)
              .where('purge_started_at', 'is', null)
              .executeTakeFirst();
            return cancelled.numUpdatedRows > 0n;
          }
          case 'account.purged':
            // The sign-in identity was deleted when the event was first recorded.
            return purgeAccountRows(db, event.athleteId, new Date(event.at));
        }
      });
    if (changed) applied += 1;
  }
  return applied;
}

async function purgeAccount(athleteId: string, now: Date, deleteIdentity?: DeleteIdentity) {
  const database = getDatabase();
  // Claiming closes cancellation, so the identity is never deleted under a cancelled request.
  const subjects = await database.transaction().execute(async (db) => {
    const claimed = await db
      .updateTable('athletes')
      .set({ purge_started_at: sql`coalesce(purge_started_at, ${now})` })
      .where('id', '=', athleteId)
      .where('purge_after', '<=', now)
      .returning('id')
      .executeTakeFirst();
    if (!claimed) return null;
    const identities = await db
      .selectFrom('athlete_identities')
      .select('provider_subject')
      .where('athlete_id', '=', athleteId)
      .where('provider', '=', 'clerk')
      .execute();
    return identities.map((identity) => identity.provider_subject);
  });
  if (subjects === null) return false;
  // Sign-in goes first: otherwise lazy provisioning could recreate the athlete after the purge.
  if (deleteIdentity) for (const subject of subjects) await deleteIdentity(subject);
  return database.transaction().execute((db) => purgeAccountRows(db, athleteId));
}

/** Everything the athlete gave us or the coach wrote for them, as one JSON document. */
export async function exportAccount(athleteId: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const athlete = await db
        .selectFrom('athletes')
        .select(['display_name', 'timezone', 'created_at'])
        .where('id', '=', athleteId)
        .executeTakeFirstOrThrow();
      const plans = await db
        .selectFrom('plans')
        .selectAll()
        .where('owner_id', '=', athleteId)
        .orderBy('created_at')
        .execute();
      const versions = plans.length
        ? await db
            .selectFrom('plan_versions')
            .selectAll()
            .where(
              'plan_id',
              'in',
              plans.map((plan) => plan.id),
            )
            .orderBy('created_at')
            .execute()
        : [];
      const conversations = await db
        .selectFrom('conversations')
        .selectAll()
        .where('owner_id', '=', athleteId)
        .orderBy('created_at')
        .execute();
      const messages = conversations.length
        ? await db
            .selectFrom('conversation_messages')
            .select(['conversation_id', 'sequence', 'role', 'content', 'created_at'])
            .where(
              'conversation_id',
              'in',
              conversations.map((conversation) => conversation.id),
            )
            .orderBy('conversation_id')
            .orderBy('sequence')
            .execute()
        : [];
      const logs = await db
        .selectFrom('workout_logs')
        .selectAll()
        .where('athlete_id', '=', athleteId)
        .orderBy('performed_on')
        .execute();
      const checkIns = await db
        .selectFrom('athlete_check_ins')
        .selectAll()
        .where('athlete_id', '=', athleteId)
        .orderBy('starts_on')
        .execute();
      return {
        exportedAt: new Date().toISOString(),
        athlete: {
          displayName: athlete.display_name,
          timezone: athlete.timezone,
          createdAt: iso(athlete.created_at),
        },
        plans: await Promise.all(
          plans.map(async (plan) => ({
            id: plan.id,
            displayName: plan.display_name,
            createdAt: iso(plan.created_at),
            activatedAt: iso(plan.activated_at),
            archivedAt: iso(plan.archived_at),
            deletedAt: iso(plan.deleted_at),
            versions: await Promise.all(
              versions
                .filter((version) => version.plan_id === plan.id)
                .map(async (version) => ({
                  id: version.id,
                  state: version.state,
                  versionNumber: version.version_number,
                  lockedAt: iso(version.locked_at),
                  description: version.description,
                  startDate: version.start_date,
                  endDate: version.end_date,
                  content: (await readAggregate(db, version.id)).semantic,
                })),
            ),
          })),
        ),
        conversations: conversations.map((conversation) => ({
          id: conversation.id,
          planId: conversation.plan_id,
          title: conversation.title,
          createdAt: iso(conversation.created_at),
          messages: messages
            .filter((message) => message.conversation_id === conversation.id)
            .map((message) => ({
              role: message.role,
              content: message.content,
              createdAt: iso(message.created_at),
            })),
        })),
        trainingLog: logs.map(({ athlete_id: _owner, recorded_by_run_id: _run, ...log }) => log),
        checkIns: checkIns.map(({ athlete_id: _owner, ...checkIn }) => checkIn),
        calibrations: await readEntries(db, athleteId),
      };
    });
}
