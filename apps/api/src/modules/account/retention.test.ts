import { expect, it } from 'vitest';
import { parseDeletionLog } from './journal.js';

it('reads journal entries from pino JSON lines in sequence order, once each', () => {
  const planId = '00000000-0000-4000-8000-000000000010';
  const athleteId = '00000000-0000-4000-8000-000000000001';
  const entry = (sequence: number, event: string, subjectId: string) =>
    JSON.stringify({
      level: 30,
      msg: `Data deletion: ${event}`,
      deletion: { sequence, event, subjectId, at: '2026-10-19T09:00:00.000Z' },
    });
  const log = [
    JSON.stringify({ level: 30, msg: 'Askesis API started', port: 3000 }),
    entry(2, 'account.deletion_cancelled', athleteId),
    'not json "deletion"',
    JSON.stringify({ level: 30, deletion: { sequence: 3, event: 'plan.deleted', subjectId: 'x' } }),
    entry(1, 'plan.deleted', planId),
    // Shipping is at least once.
    entry(2, 'account.deletion_cancelled', athleteId),
    JSON.stringify({ level: 30, deletionCheckpoint: { sequence: 2, at: '2026-10-19T09:15:00Z' } }),
    JSON.stringify({ level: 30, deletionCheckpoint: { sequence: 1, at: '2026-10-19T09:00:00Z' } }),
  ].join('\n');
  const parsed = parseDeletionLog(log);
  expect(parsed.events.map((event) => [event.sequence, event.event])).toEqual([
    [1, 'plan.deleted'],
    [2, 'account.deletion_cancelled'],
  ]);
  expect(parsed.checkpoint).toBe(2);
  expect(parseDeletionLog('').checkpoint).toBeNull();
});
