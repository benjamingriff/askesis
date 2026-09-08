import { z } from '@hono/zod-openapi';

export const Id = z.uuid();
export const PlanParams = z.object({ planId: Id });
export const FindingSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  path: z.string(),
});
export const VersionSchema = z.object({
  id: Id,
  state: z.enum(['draft', 'locked']),
  versionNumber: z.number().int().nullable(),
  editNumber: z.number().int(),
  description: z.string().nullable(),
  startDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
  basedOnVersionId: Id.nullable(),
  supersedesVersionId: Id.nullable(),
  lockedAt: z.string().nullable(),
});
export const PlanSchema = z.object({
  id: Id,
  displayName: z.string(),
  stateVersion: z.number().int(),
  active: z.boolean(),
  archived: z.boolean(),
  draft: VersionSchema.nullable(),
  locked: VersionSchema.nullable(),
});
export const SummarySchema = z.object({
  headerChanges: z.array(z.string()),
  entities: z.record(
    z.string(),
    z.object({ added: z.number(), changed: z.number(), removed: z.number() }),
  ),
});
export const PreviewSchema = z.object({
  draftId: Id,
  editNumber: z.number().int(),
  stateVersion: z.number().int(),
  contentHash: z.string(),
  validationDigest: z.string(),
  findings: z.array(FindingSchema),
  hasChanges: z.boolean(),
  summary: SummarySchema,
});
export const CommandSchema = z
  .object({
    expectedStateVersion: z.number().int().positive(),
    expectedDraftId: Id.optional(),
    expectedEditNumber: z.number().int().positive().optional(),
    expectedContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    expectedValidationDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    acknowledgedWarningCodes: z.array(z.string()).optional(),
  })
  .strict();
export const CreateSchema = z.object({ displayName: z.string().trim().min(1).max(200) }).strict();
export const DraftPatchSchema = z
  .object({
    expectedDraftId: Id,
    expectedEditNumber: z.number().int().positive(),
    description: z.string().max(20000).nullable(),
    startDate: z.iso.date().nullable(),
    endDate: z.iso.date().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.startDate === null || value.endDate === null || value.endDate >= value.startDate,
    'End date must not precede start date.',
  );
export const RenameSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    expectedStateVersion: z.number().int().positive(),
  })
  .strict();
export type Command = z.infer<typeof CommandSchema>;
export type Plan = z.infer<typeof PlanSchema>;
