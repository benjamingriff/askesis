import { z } from '@hono/zod-openapi';
export const Id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const FindingSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  path: z.string(),
});

/** A domain rejection with its public code and HTTP status. */
export class PlanError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 404 | 409 | 422 = 409,
  ) {
    super(message);
  }
}
