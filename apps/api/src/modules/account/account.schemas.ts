import { z } from '@hono/zod-openapi';

export const AccountSchema = z.object({
  features: z.object({ inAppCoach: z.boolean() }),
  /** Set while a requested deletion can still be cancelled; the account is purged after purgeAfter. */
  deletion: z.object({ requestedAt: z.string(), purgeAfter: z.string() }).nullable(),
});
export const AccountExportSchema = z.record(z.string(), z.unknown());
