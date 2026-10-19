import { expect, it } from 'vitest';
import { parseDeletionLog } from './retention.js';

it('reads deletion events from pino JSON lines and ignores everything else', () => {
  const planId = '00000000-0000-4000-8000-000000000010';
  const athleteId = '00000000-0000-4000-8000-000000000001';
  const log = [
    JSON.stringify({ level: 30, msg: 'Askesis API started', port: 3000 }),
    JSON.stringify({
      level: 30,
      msg: 'Data deletion: plan.deleted',
      deletion: { event: 'plan.deleted', planId, at: '2026-10-19T09:00:00.000Z' },
    }),
    'not json "deletion"',
    JSON.stringify({ level: 30, deletion: { event: 'plan.deleted', planId: 'nope' } }),
    JSON.stringify({ level: 30, deletion: { event: 'account.deletion_cancelled', athleteId } }),
  ].join('\n');
  expect(parseDeletionLog(log)).toEqual([
    { event: 'plan.deleted', planId, at: '2026-10-19T09:00:00.000Z' },
    { event: 'account.deletion_cancelled', athleteId },
  ]);
});
