import { z } from '@hono/zod-openapi';

// PostgreSQL accepts UUIDs without RFC version/variant bits (including local fixtures).
export const Id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const PlanParams = z.object({ planId: Id });
export const PlanListQuery = z.object({
  collection: z.enum(['library', 'active', 'archive']).default('library'),
});
export const StateCommandSchema = z
  .object({ expectedStateVersion: z.number().int().positive() })
  .strict();
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
  affectedWorkouts: z
    .array(
      z.object({
        change: z.enum(['added', 'changed', 'removed']),
        title: z.string(),
        date: z.iso.date(),
        previousDate: z.iso.date().nullable(),
      }),
    )
    .optional(),
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

export const RevisionParams = PlanParams.extend({ revisionId: Id });
export const RevisionSchema = VersionSchema.extend({
  state: z.literal('locked'),
  versionNumber: z.number().int().positive(),
  contentHash: z.string(),
  contentSchemaVersion: z.number().int(),
  validatorVersion: z.number().int(),
  findings: z.array(FindingSchema),
  acknowledgedWarningCodes: z.array(z.string()),
  summary: SummarySchema,
});
export const RevisionDetailSchema = z.object({
  revision: RevisionSchema,
  // A read-only semantic projection; normalized database rows remain authoritative.
  content: z.record(z.string(), z.unknown()),
});
export const RestorePreviewSchema = z.object({
  sourceRevisionId: Id,
  currentVersionId: Id,
  stateVersion: z.number().int(),
  sourceHash: z.string(),
  summary: SummarySchema,
});
export const RestoreCommandSchema = StateCommandSchema.extend({
  expectedCurrentVersionId: Id,
  expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const DraftDetailSchema = z.object({
  version: VersionSchema,
  content: z.record(z.string(), z.unknown()),
  findings: z.array(FindingSchema),
});
