import { z } from '@hono/zod-openapi';

export const DatabaseIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i)
  .openapi({ format: 'uuid' });

export const WorkoutPrioritySchema = z.enum(['low', 'medium', 'high']).openapi('WorkoutPriority');
export const WorkoutStepKindSchema = z
  .enum(['sequence', 'repeat', 'effort'])
  .openapi('WorkoutStepKind');

export const WorkoutSummarySchema = z
  .object({
    id: DatabaseIdSchema,
    planId: DatabaseIdSchema,
    planVersionId: DatabaseIdSchema,
    planTitle: z.string(),
    weekNumber: z.number().int().positive(),
    scheduledDate: z.iso.date(),
    title: z.string(),
    description: z.string().nullable(),
    purpose: z.string().nullable(),
    discipline: z.string(),
    priority: WorkoutPrioritySchema,
    estimatedDurationSeconds: z.number().int().positive().nullable(),
    estimatedDistanceMetres: z.number().positive().nullable(),
  })
  .openapi('WorkoutSummary');

export const WorkoutListSchema = z
  .object({
    workouts: z.array(WorkoutSummarySchema),
  })
  .openapi('WorkoutList');

export const WorkoutListQuerySchema = z.object({
  planVersionId: DatabaseIdSchema,
});

export const StepCompletionSchema = z
  .object({
    type: z.enum([
      'duration',
      'distance',
      'repetitions',
      'energy',
      'until_lap',
      'until_condition',
      'open',
    ]),
    value: z.number().positive().nullable(),
    unit: z.string().nullable(),
    conditionType: z.string().nullable(),
    conditionValue: z.string().nullable(),
  })
  .openapi('StepCompletion');

export const ResolvedZoneSchema = z
  .object({
    profileId: DatabaseIdSchema,
    method: z.string(),
    fitnessValue: z.number().nullable(),
    metric: z.string(),
    minimumValue: z.number().nullable(),
    targetValue: z.number().nullable(),
    maximumValue: z.number().nullable(),
    unit: z.string(),
  })
  .openapi('ResolvedZone');

export const StepTargetSchema = z
  .object({
    type: z.enum([
      'zone',
      'pace',
      'speed',
      'heart_rate',
      'power',
      'cadence',
      'rpe',
      'load',
      'percentage_1rm',
      'rir',
      'tempo',
      'instruction',
    ]),
    minimumValue: z.number().nullable(),
    targetValue: z.number().nullable(),
    maximumValue: z.number().nullable(),
    unit: z.string().nullable(),
    zoneSystem: z.string().nullable(),
    zoneKey: z.string().nullable(),
    text: z.string().nullable(),
    resolvedZone: ResolvedZoneSchema.nullable(),
  })
  .openapi('StepTarget');

export type WorkoutStep = {
  id: string;
  kind: 'sequence' | 'repeat' | 'effort';
  role: string | null;
  discipline: string | null;
  repeatCount: number | null;
  label: string | null;
  instructions: string | null;
  movement: { id: string; name: string; category: string } | null;
  completion: z.infer<typeof StepCompletionSchema> | null;
  targets: z.infer<typeof StepTargetSchema>[];
  steps: WorkoutStep[];
};

export const WorkoutStepSchema: z.ZodType<WorkoutStep> = z
  .lazy(() =>
    z.object({
      id: DatabaseIdSchema,
      kind: WorkoutStepKindSchema,
      role: z.string().nullable(),
      discipline: z.string().nullable(),
      repeatCount: z.number().int().positive().nullable(),
      label: z.string().nullable(),
      instructions: z.string().nullable(),
      movement: z
        .object({
          id: DatabaseIdSchema,
          name: z.string(),
          category: z.string(),
        })
        .nullable(),
      completion: StepCompletionSchema.nullable(),
      targets: z.array(StepTargetSchema),
      steps: z.array(WorkoutStepSchema),
    }),
  )
  .openapi('WorkoutStep');

export const WorkoutDetailSchema = z
  .object({
    workout: WorkoutSummarySchema,
    tags: z.array(z.string()),
    prescription: WorkoutStepSchema,
  })
  .openapi('WorkoutDetail');

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .openapi('Error');

export type WorkoutSummary = z.infer<typeof WorkoutSummarySchema>;
export type WorkoutDetail = z.infer<typeof WorkoutDetailSchema>;
export type StepTarget = z.infer<typeof StepTargetSchema>;
