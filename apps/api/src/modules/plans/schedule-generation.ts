import type { Selectable } from 'kysely';
import { z } from '@hono/zod-openapi';
import type { DB } from '../../database/generated.js';
import { Id } from './plan.common.js';

export const GenerationSchema = z.object({
  runId: Id,
  startDate: z.string(),
  endDate: z.string(),
  prescribedThrough: z.string().nullable(),
  status: z.enum(['in_progress', 'completed', 'interrupted']),
});

export function generationState(run: Selectable<DB['agent_runs']>) {
  if (!run.generation_start_date || !run.generation_end_date) return null;
  const date = (value: Date | string) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  const startDate = date(run.generation_start_date);
  const endDate = date(run.generation_end_date);
  const prescribedThrough = run.generation_prescribed_through
    ? date(run.generation_prescribed_through)
    : null;
  return GenerationSchema.parse({
    runId: run.id,
    startDate,
    endDate,
    prescribedThrough,
    status:
      prescribedThrough === endDate
        ? 'completed'
        : ['queued', 'running', 'cancelling'].includes(run.status)
          ? 'in_progress'
          : 'interrupted',
  });
}
