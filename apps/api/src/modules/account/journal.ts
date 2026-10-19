import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { getDatabase } from '../../database/client.js';
import type { DB } from '../../database/generated.js';
import { logger } from '../../logger.js';

/**
 * The deletion journal records every deletion transition in the transaction that makes it, under
 * a gapless sequence that follows commit order. Entries are then shipped to the logs, which outlive
 * database backups: replaying them onto a restored backup re-applies later deletions, and a gap in
 * the sequence shows that some are missing.
 */
type Tx = Transaction<DB>;
export const DELETION_EVENTS = [
  'plan.deleted',
  'plan.restored',
  'plan.purged',
  'account.deletion_requested',
  /** The purge was brought forward (the Clerk user was deleted); `at` is the new deadline. */
  'account.purge_due',
  'account.deletion_cancelled',
  'account.purged',
] as const;
export type DeletionEventName = (typeof DELETION_EVENTS)[number];
export type DeletionEvent = {
  sequence: number;
  event: DeletionEventName;
  subjectId: string;
  at: string;
};

/** Ships regardless of LOG_LEVEL: only an explicitly silent logger (tests) suppresses it. */
let shipping: typeof logger | undefined;
const shippingLogger = () =>
  (shipping ??= logger.child(
    { stream: 'deletion-journal' },
    { level: logger.level === 'silent' ? 'silent' : 'info' },
  ));

/**
 * Appends one transition. Callers hold the subject's row lock, so one subject's entries are in
 * commit order; the head row serialises every deletion transition, keeping the sequence gapless.
 */
export async function appendDeletion(
  db: Tx,
  event: DeletionEventName,
  subjectId: string,
  at: Date,
  replayed?: number,
) {
  const head = await sql<{ sequence: string }>`
    UPDATE deletion_journal_head SET sequence = ${replayed ?? sql`sequence + 1`}
    RETURNING sequence`.execute(db);
  await db
    .insertInto('deletion_journal')
    .values({
      sequence: head.rows[0]!.sequence,
      event,
      subject_id: subjectId,
      occurred_at: at,
      // A replayed entry is already in the logs it came from.
      shipped_at: replayed === undefined ? null : new Date(),
    })
    .execute();
}

/** Logs unshipped entries in order. Safe to run concurrently and to repeat. */
export async function shipDeletions() {
  let shipped = 0;
  for (;;) {
    const batch = await getDatabase()
      .transaction()
      .execute(async (db) => {
        const rows = await db
          .selectFrom('deletion_journal')
          .selectAll()
          .where('shipped_at', 'is', null)
          .orderBy('sequence')
          .limit(200)
          .forUpdate()
          .skipLocked()
          .execute();
        for (const row of rows)
          shippingLogger().info(
            {
              deletion: {
                sequence: Number(row.sequence),
                event: row.event,
                subjectId: row.subject_id,
                at: new Date(row.occurred_at).toISOString(),
              },
            },
            `Data deletion: ${row.event}`,
          );
        if (rows.length)
          await db
            .updateTable('deletion_journal')
            .set({ shipped_at: new Date() })
            .where(
              'sequence',
              'in',
              rows.map((row) => row.sequence),
            )
            .execute();
        return rows.length;
      });
    shipped += batch;
    if (batch < 200) return shipped;
  }
}

/**
 * Logs the checkpoint: the highest sequence up to which every entry has been shipped. Emitted on
 * every retention pass, it tells a replay where the journal ended, so a log export that lost its
 * last entries (or all of them) is detected rather than silently replayed short.
 */
export async function shipCheckpoint() {
  const [head, unshipped] = await Promise.all([
    getDatabase().selectFrom('deletion_journal_head').select('sequence').executeTakeFirstOrThrow(),
    getDatabase()
      .selectFrom('deletion_journal')
      .select(({ fn }) => fn.min('sequence').as('sequence'))
      .where('shipped_at', 'is', null)
      .executeTakeFirst(),
  ]);
  const sequence =
    unshipped?.sequence == null ? Number(head.sequence) : Number(unshipped.sequence) - 1;
  shippingLogger().info(
    { deletionCheckpoint: { sequence, at: new Date().toISOString() } },
    'Data deletion checkpoint',
  );
  return sequence;
}

/** Ships right after a transition commits; the retention pass retries anything left behind. */
export function shipSoon() {
  void shipDeletions().catch(() => logger.error('Deletion journal shipping failed; will retry.'));
}

const EventSchema = z.object({
  sequence: z.number().int().positive(),
  event: z.enum(DELETION_EVENTS),
  subjectId: z.guid(),
  at: z.iso.datetime({ offset: true }),
});

const CheckpointSchema = z.object({ sequence: z.number().int().nonnegative() });

export type DeletionLog = {
  /** Journal entries, deduplicated and in sequence order. */
  events: DeletionEvent[];
  /** The latest shipped checkpoint, if the log has one. */
  checkpoint: number | null;
};

/** The journal entries and checkpoints in pino JSON log lines; other lines are ignored. */
export function parseDeletionLog(text: string): DeletionLog {
  const events = new Map<number, DeletionEvent>();
  let checkpoint: number | null = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"deletion')) continue;
    let record: { deletion?: unknown; deletionCheckpoint?: unknown };
    try {
      record = JSON.parse(line) as typeof record;
    } catch {
      continue;
    }
    const event = EventSchema.safeParse(record.deletion);
    if (event.success) events.set(event.data.sequence, event.data);
    const mark = CheckpointSchema.safeParse(record.deletionCheckpoint);
    if (mark.success) checkpoint = Math.max(checkpoint ?? 0, mark.data.sequence);
  }
  return { events: [...events.values()].sort((a, b) => a.sequence - b.sequence), checkpoint };
}
