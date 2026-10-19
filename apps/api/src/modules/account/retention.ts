import { z } from 'zod';
import { logger } from '../../logger.js';

/** How long a deleted plan can be restored before it is purged. */
export const PLAN_RESTORE_DAYS = 30;
/** How long a requested account deletion can be cancelled. */
export const ACCOUNT_GRACE_DAYS = 7;
/** Long enough for any client retry of a command. */
export const IDEMPOTENCY_RETENTION_DAYS = 7;
/** Change notifications only need to bridge a client reconnecting. */
export const LIVE_EVENT_RETENTION_DAYS = 7;

export const DAY_MS = 86_400_000;

export const purgeDate = (from: Date | string, days: number) =>
  new Date(new Date(from).getTime() + days * DAY_MS).toISOString();

/**
 * Deletion events, logged after commit. Logs outlive database backups, so replaying them
 * onto a restored backup re-applies deletions made after it was taken (replayDeletionEvents).
 */
export type DeletionEvent =
  | { event: 'plan.deleted' | 'plan.purged'; planId: string; at: string }
  | { event: 'plan.restored'; planId: string }
  | { event: 'account.deletion_requested' | 'account.purged'; athleteId: string; at: string }
  | { event: 'account.deletion_cancelled'; athleteId: string };
export function logDeletionEvent(event: DeletionEvent) {
  logger.info({ deletion: event }, `Data deletion: ${event.event}`);
}

const Id = z.guid();
const At = z.iso.datetime({ offset: true });
const EventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.enum(['plan.deleted', 'plan.purged']), planId: Id, at: At }),
  z.object({ event: z.literal('plan.restored'), planId: Id }),
  z.object({
    event: z.enum(['account.deletion_requested', 'account.purged']),
    athleteId: Id,
    at: At,
  }),
  z.object({ event: z.literal('account.deletion_cancelled'), athleteId: Id }),
]);

/** The deletion events in a pino JSON log, in order; other lines are ignored. */
export function parseDeletionLog(text: string): DeletionEvent[] {
  return text.split('\n').flatMap((line) => {
    if (!line.includes('"deletion"')) return [];
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return [];
    }
    const parsed = EventSchema.safeParse((record as { deletion?: unknown }).deletion);
    return parsed.success ? [parsed.data] : [];
  });
}
