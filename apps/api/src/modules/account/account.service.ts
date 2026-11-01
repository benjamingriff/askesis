import { sql, type Transaction } from 'kysely';
import { getApiConfig } from '../../config.js';
import { getDatabase } from '../../database/client.js';
import type { DB } from '../../database/generated.js';
import { logger } from '../../logger.js';
import { activeStatuses, ChatError } from '../chat/chat.core.js';
import { transition } from '../chat/chat.service.js';
import { readAggregate } from '../plans/plan.aggregate.js';
import { readEntries } from '../performance/performance.service.js';
import { purgeAccountRows, purgePlanRows } from './purge.js';
import {
  appendDeletion,
  shipCheckpoint,
  shipDeletions,
  shipSoon,
  type DeletionEvent,
  type DeletionLog,
} from './journal.js';
import {
  ACCOUNT_GRACE_DAYS,
  DAY_MS,
  IDEMPOTENCY_RETENTION_DAYS,
  LIVE_EVENT_RETENTION_DAYS,
  PLAN_RESTORE_DAYS,
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
    features: { inAppCoach: getApiConfig().IN_APP_COACH === 'enabled' },
    deletion: athlete.deletion_requested_at
      ? { requestedAt: iso(athlete.deletion_requested_at)!, purgeAfter: iso(athlete.purge_after)! }
      : null,
  };
}

/** Stops coaching for the athlete. Holds run locks only, never the athlete's. */
async function cancelActiveRuns(athleteId: string) {
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      const runs = await db
        .selectFrom('agent_runs')
        .selectAll()
        .where('owner_id', '=', athleteId)
        .where('status', 'in', activeStatuses)
        .orderBy('id')
        .forUpdate()
        .execute();
      for (const run of runs) {
        if (run.status === 'queued') await transition(db, run, 'cancelled', 'cancelled');
        else if (run.status === 'running')
          await transition(db, run, 'cancelling', 'cancel_requested');
      }
    });
}

/**
 * Marks the account and then stops coaching, in separate transactions. Once the marker commits,
 * no run can be accepted (acceptance share-locks the athlete and checks it) and worker calls for
 * the account are refused, so the second step sees every run that will ever exist. Neither step
 * holds the athlete lock while waiting for a run, which coaching tools lock first.
 */
async function markForDeletion(athleteId: string, now: Date, purgeAfter: Date) {
  const marked = await getDatabase()
    .transaction()
    .execute(async (db) => {
      // NO KEY UPDATE: it still excludes run acceptance's share lock, but not the foreign-key
      // checks a concurrent plan deletion makes at commit while holding the journal head.
      const athlete = await db
        .selectFrom('athletes')
        .select(['deletion_requested_at', 'purge_after'])
        .where('id', '=', athleteId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!athlete) return false;
      const requested = athlete.deletion_requested_at === null;
      if (!requested && new Date(athlete.purge_after!).getTime() <= purgeAfter.getTime())
        return false;
      await db
        .updateTable('athletes')
        .set({
          deletion_requested_at: athlete.deletion_requested_at ?? now,
          purge_after: purgeAfter,
          updated_at: now,
        })
        .where('id', '=', athleteId)
        .execute();
      if (requested) await appendDeletion(db, 'account.deletion_requested', athleteId, now);
      // Replay assumes the standard grace period; record any earlier deadline explicitly.
      if (purgeAfter.getTime() < now.getTime() + ACCOUNT_GRACE_DAYS * DAY_MS)
        await appendDeletion(db, 'account.purge_due', athleteId, purgeAfter);
      return true;
    });
  await cancelActiveRuns(athleteId);
  if (marked) shipSoon();
}

export async function requestAccountDeletion(athleteId: string, now = new Date()) {
  await markForDeletion(athleteId, now, new Date(now.getTime() + ACCOUNT_GRACE_DAYS * DAY_MS));
  return getAccount(athleteId);
}

export async function cancelAccountDeletion(athleteId: string, now = new Date()) {
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      const athlete = await db
        .selectFrom('athletes')
        .select(['deletion_requested_at', 'purge_started_at'])
        .where('id', '=', athleteId)
        .forNoKeyUpdate()
        .executeTakeFirstOrThrow();
      if (!athlete.deletion_requested_at) return;
      if (athlete.purge_started_at)
        throw new ChatError('ACCOUNT_PURGE_STARTED', 'This account is already being deleted.');
      await db
        .updateTable('athletes')
        .set({ deletion_requested_at: null, purge_after: null, updated_at: now })
        .where('id', '=', athleteId)
        .execute();
      await appendDeletion(db, 'account.deletion_cancelled', athleteId, now);
    });
  shipSoon();
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
  await markForDeletion(identity.athlete_id, now, now);
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
        if (!due || !(await purgePlanRows(db, id))) return false;
        await appendDeletion(db, 'plan.purged', id, now);
        return true;
      });
      if (purged) result.plans += 1;
    } catch {
      logger.error({ planId: id }, 'Plan purge failed; it will be retried.');
    }
  }

  const pending = await database
    .selectFrom('athletes')
    .select(['id', 'purge_after'])
    .where('deletion_requested_at', 'is not', null)
    .orderBy('purge_after')
    .execute();
  for (const { id, purge_after } of pending) {
    try {
      // Backstop for a request interrupted between marking and stopping coaching.
      await cancelActiveRuns(id);
      if (new Date(purge_after!).getTime() > now.getTime()) continue;
      if (await purgeAccount(id, now, options.deleteIdentity)) result.accounts += 1;
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
  await shipDeletions();
  await shipCheckpoint();
  return result;
}

/** The logs cannot show that every deletion since the backup is present. */
export class ReplayGapError extends Error {}

/**
 * Re-applies shipped journal entries to a database restored from an older backup, before it takes
 * traffic. Entries at or below the restored journal head are already reflected. The rest must run
 * without gaps up to the journal's end: `through` when the operator knows it (the damaged
 * database's head), otherwise the latest checkpoint in the logs. Missing entries, or no known end,
 * refuse the replay before anything changes unless `allowGaps` accepts the loss. Each entry
 * commits with its journal row, so an interrupted replay can simply be run again.
 */
export async function replayDeletionEvents(
  log: DeletionLog,
  options: { through?: number | undefined; allowGaps?: boolean } = {},
) {
  const head = await getDatabase()
    .selectFrom('deletion_journal_head')
    .select('sequence')
    .executeTakeFirstOrThrow();
  const start = Number(head.sequence) + 1;
  const pending = log.events.filter((event) => event.sequence >= start);
  const end =
    options.through ??
    (log.checkpoint === null && !pending.length
      ? null
      : Math.max(log.checkpoint ?? 0, pending.at(-1)?.sequence ?? 0));
  if (!options.allowGaps) {
    if (end === null || (options.through === undefined && log.checkpoint === null))
      throw new ReplayGapError(
        "The logs have no deletion checkpoint, so missing entries cannot be ruled out. Pass --through with the damaged database's deletion_journal_head, or --allow-gaps to accept the risk.",
      );
    let expected = start;
    for (const event of pending) {
      if (event.sequence !== expected) break;
      expected += 1;
    }
    if (expected <= end)
      throw new ReplayGapError(
        `Deletion journal entries from ${expected} to ${end} are missing from the logs.`,
      );
  }
  for (const event of pending) {
    if (end !== null && event.sequence > end && !options.allowGaps) break;
    await getDatabase()
      .transaction()
      .execute(async (db) => {
        await applyDeletion(db, event);
        await appendDeletion(db, event.event, event.subjectId, new Date(event.at), event.sequence);
      });
  }
  return { from: start, to: pending.at(-1)?.sequence ?? start - 1, applied: pending.length };
}

async function applyDeletion(db: Tx, { event, subjectId, at }: DeletionEvent) {
  const when = new Date(at);
  switch (event) {
    case 'plan.deleted': {
      const plan = await db
        .selectFrom('plans')
        .select(['archived_at', 'deleted_at'])
        .where('id', '=', subjectId)
        .forUpdate()
        .executeTakeFirst();
      if (!plan || plan.deleted_at) return;
      // The backup may hold coaching that was still queued or running for this plan. Deletion
      // required it idle, so it ended before; end it here rather than leave it hidden.
      const runs = await db
        .selectFrom('agent_runs')
        .selectAll()
        .where('conversation_id', 'in', (eb) =>
          eb.selectFrom('conversations').select('id').where('plan_id', '=', subjectId),
        )
        .where('status', 'in', activeStatuses)
        .orderBy('id')
        .forUpdate()
        .execute();
      for (const run of runs) await transition(db, run, 'failed', 'failed', 'PLAN_DELETED');
      await db
        .updateTable('plans')
        .set({
          ...(plan.archived_at ? {} : { archived_at: when, activated_at: null }),
          deleted_at: when,
          state_version: sql`state_version + 1`,
        })
        .where('id', '=', subjectId)
        .execute();
      return;
    }
    case 'plan.restored':
      await db
        .updateTable('plans')
        .set({ deleted_at: null, state_version: sql`state_version + 1` })
        .where('id', '=', subjectId)
        .where('deleted_at', 'is not', null)
        .execute();
      return;
    case 'plan.purged':
      await purgePlanRows(db, subjectId, true);
      return;
    case 'account.deletion_requested':
      // Coaching is not running against a database that has not taken traffic yet.
      await db
        .updateTable('athletes')
        .set({
          deletion_requested_at: when,
          purge_after: new Date(when.getTime() + ACCOUNT_GRACE_DAYS * DAY_MS),
        })
        .where('id', '=', subjectId)
        .where('deletion_requested_at', 'is', null)
        .execute();
      return;
    case 'account.purge_due':
      await db
        .updateTable('athletes')
        .set({ purge_after: sql`least(purge_after, ${when})` })
        .where('id', '=', subjectId)
        .where('deletion_requested_at', 'is not', null)
        .execute();
      return;
    case 'account.deletion_cancelled':
      await db
        .updateTable('athletes')
        .set({ deletion_requested_at: null, purge_after: null, purge_started_at: null })
        .where('id', '=', subjectId)
        .execute();
      return;
    case 'account.purged':
      // The sign-in identity was deleted when the entry was first recorded.
      await purgeAccountRows(db, subjectId, true);
      return;
  }
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
  const purged = await database.transaction().execute(async (db) => {
    if (!(await purgeAccountRows(db, athleteId))) return false;
    await appendDeletion(db, 'account.purged', athleteId, now);
    return true;
  });
  return purged;
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
            .select([
              'id',
              'conversation_id',
              'sequence',
              'role',
              'content',
              'references',
              'producing_run_id',
              'created_at',
            ])
            .where(
              'conversation_id',
              'in',
              conversations.map((conversation) => conversation.id),
            )
            .orderBy('conversation_id')
            .orderBy('sequence')
            .execute()
        : [];
      // Each message's coaching run: visible text beyond the final reply, including the partial
      // reply of a run that was stopped or failed, as the chat shows it.
      const runs = await db
        .selectFrom('agent_runs')
        .select(['id', 'user_message_id', 'status', 'failure_code'])
        .where('owner_id', '=', athleteId)
        .execute();
      const outputs = runs.length
        ? await db
            .selectFrom('agent_run_outputs')
            .select(['run_id', 'content', 'is_final'])
            .where(
              'run_id',
              'in',
              runs.map((run) => run.id),
            )
            .orderBy('run_id')
            .orderBy('position')
            .execute()
        : [];
      const coaching = (messageId: string) => {
        const run = runs.find((candidate) => candidate.user_message_id === messageId);
        if (!run) return undefined;
        const reply = messages.find((message) => message.producing_run_id === run.id)?.content;
        const shown = outputs
          .filter((item) => item.run_id === run.id && item.content.trim())
          .filter((item) => !(reply && (item.is_final || reply.startsWith(item.content))))
          .map((item) => item.content);
        return { status: run.status, failureCode: run.failure_code, shownText: shown };
      };
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
              // Feedback attached to a message keeps the snapshot sent, even if the log changed.
              references: message.references ?? [],
              createdAt: iso(message.created_at),
              ...(message.role === 'user' ? { coaching: coaching(message.id) ?? null } : {}),
            })),
        })),
        trainingLog: logs.map(({ athlete_id: _owner, recorded_by_run_id: _run, ...log }) => log),
        checkIns: checkIns.map(({ athlete_id: _owner, ...checkIn }) => checkIn),
        calibrations: await readEntries(db, athleteId),
        // Export connection metadata and the athlete's chosen links, never usable credentials.
        activityConnections: await db
          .selectFrom('integration_connections')
          .select([
            'id',
            'provider',
            'provider_athlete_id',
            'display_name',
            'scopes',
            'status',
            'connected_at',
          ])
          .where('athlete_id', '=', athleteId)
          .orderBy('connected_at')
          .execute(),
        activityLinks: await db
          .selectFrom('workout_activity_links')
          .select([
            'plan_id',
            'workout_lineage_id',
            'connection_id',
            'provider_activity_id',
            'linked_at',
          ])
          .where('athlete_id', '=', athleteId)
          .orderBy('linked_at')
          .execute(),
      };
    });
}
