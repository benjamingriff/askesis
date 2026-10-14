import { z } from '@hono/zod-openapi';
import { DatabaseIdSchema } from '../workouts/workout.schemas.js';
import { ACTIVITY_SPORTS } from './strava.mapping.js';

const instant = z.string().openapi({ format: 'date-time' });

export const StravaConnectionSchema = z
  .object({
    status: z.enum(['active', 'reauthorization_required']),
    displayName: z.string().nullable(),
    connectedAt: instant,
    lastSyncedAt: instant.nullable(),
    /** A stable code for the last failed sync, cleared by the next success. */
    lastSyncError: z.string().nullable(),
    syncing: z.boolean(),
    activityCount: z.number().int().nonnegative(),
  })
  .openapi('StravaConnection');

export const IntegrationsStateSchema = z
  .object({
    strava: z.object({
      /** The server has Strava credentials configured. */
      available: z.boolean(),
      connection: StravaConnectionSchema.nullable(),
    }),
  })
  .openapi('IntegrationsState');

export const StartStravaConnectionSchema = z
  .object({
    /** Where Strava returns: this web origin's `/connections/strava/callback`. */
    redirectUri: z.string().url().max(500),
  })
  .openapi('StartStravaConnection');

export const CompleteStravaConnectionSchema = z
  .object({
    code: z.string().min(1).max(500),
    state: z.string().min(1).max(1000),
    /** Scopes the athlete granted, as returned to the callback. */
    scope: z.string().max(500).default(''),
  })
  .openapi('CompleteStravaConnection');

export const StravaSyncResultSchema = z
  .object({
    imported: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    lapsFetched: z.number().int().nonnegative(),
    integrations: IntegrationsStateSchema,
  })
  .openapi('StravaSyncResult');

export const ActivitySchema = z
  .object({
    id: DatabaseIdSchema,
    source: z.literal('strava'),
    /** Link back to the activity on Strava. */
    sourceUrl: z.string().url(),
    name: z.string(),
    sport: z.enum(ACTIVITY_SPORTS),
    sourceSportType: z.string(),
    date: z.iso.date(),
    startedAt: instant,
    elapsedSeconds: z.number().int(),
    movingSeconds: z.number().int().nullable(),
    distanceMetres: z.number().nullable(),
    elevationGainMetres: z.number().nullable(),
    averageSpeed: z.number().nullable(),
    averageWatts: z.number().nullable(),
    trainer: z.boolean(),
    manual: z.boolean(),
    race: z.boolean(),
  })
  .openapi('Activity');

const VolumeSchema = z.object({
  sessions: z.number().int().nonnegative(),
  seconds: z.number().nonnegative(),
  metres: z.number().nonnegative(),
});

export const WorkoutOutcomeSchema = z
  .object({
    workoutId: DatabaseIdSchema,
    status: z.enum(['completed', 'partial', 'missed', 'planned']),
    activityIds: z.array(DatabaseIdSchema),
    matchedBy: z.enum(['auto', 'manual']).nullable(),
    /** Actual over planned volume; null when the workout has nothing to compare. */
    completion: z.number().nullable(),
    /** Days from the plan date to the activity: negative when done early. */
    dayOffset: z.number().int().nullable(),
    actualSeconds: z.number().nonnegative(),
    actualMetres: z.number().nonnegative(),
  })
  .openapi('WorkoutOutcome');

export const WeekAdherenceSchema = z
  .object({
    weekNumber: z.number().int().positive(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    planned: VolumeSchema,
    /** Workouts due by today plus later ones already done early. */
    due: VolumeSchema,
    /** Linked workouts plus extra activities in the plan's sports. */
    actual: VolumeSchema,
    completed: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    missed: z.number().int().nonnegative(),
    extra: z.number().int().nonnegative(),
  })
  .openapi('WeekAdherence');

export const AdherenceSchema = z
  .object({
    planVersionId: DatabaseIdSchema,
    today: z.iso.date(),
    connected: z.boolean(),
    lastSyncedAt: instant.nullable(),
    workouts: z.array(WorkoutOutcomeSchema),
    activities: z.array(ActivitySchema),
    /** Activities no workout claimed, with the volume each adds when it counts. */
    extra: z.array(
      z.object({
        activityId: DatabaseIdSchema,
        countsTowardPlan: z.boolean(),
        seconds: z.number().nonnegative(),
        metres: z.number().nonnegative(),
      }),
    ),
    weeks: z.array(WeekAdherenceSchema),
    toDate: z.object({ due: VolumeSchema, actual: VolumeSchema }),
  })
  .openapi('Adherence');

const BandSchema = z.object({
  metric: z.enum(['speed', 'power']),
  low: z.number(),
  high: z.number(),
});

export const EffortSegmentSchema = z
  .object({
    stepId: z.string(),
    label: z.string(),
    role: z.string().nullable(),
    measure: z.enum(['duration', 'distance', 'open']),
    amount: z.number().nullable(),
    /** Speed in metres per second, or watts. */
    band: BandSchema.nullable(),
    repeat: z.object({ index: z.number().int(), count: z.number().int() }).nullable(),
    lapIndexes: z.array(z.number().int()),
    actualSeconds: z.number().nullable(),
    actualMetres: z.number().nullable(),
    actualIntensity: z.number().nullable(),
    completion: z.number().nullable(),
    status: z.enum(['done', 'short', 'not_found']),
    intensity: z.enum(['on_target', 'above', 'below']).nullable(),
  })
  .openapi('EffortSegment');

export const EffortAnalysisSchema = z
  .object({
    verdict: z.enum(['aligned', 'no_laps', 'auto_laps', 'unaligned', 'not_applicable']),
    segments: z.array(EffortSegmentSchema),
    work: z.object({
      planned: z.number().int(),
      done: z.number().int(),
      onTarget: z.number().int(),
      checked: z.number().int(),
    }),
  })
  .openapi('EffortAnalysis');

export const WorkoutActualSchema = z
  .object({
    workoutId: DatabaseIdSchema,
    connected: z.boolean(),
    outcome: WorkoutOutcomeSchema,
    activities: z.array(
      ActivitySchema.extend({
        /**
         * Reps can be checked once laps arrive: an endurance activity on a workout with repeats
         * whose laps the next sync will fetch.
         */
        lapsPending: z.boolean(),
        lapCount: z.number().int().nonnegative(),
        efforts: EffortAnalysisSchema.nullable(),
      }),
    ),
    /** Other activities within a week either side that could be linked instead. */
    candidates: z.array(ActivitySchema.extend({ linkedWorkoutId: DatabaseIdSchema.nullable() })),
  })
  .openapi('WorkoutActual');

export const ActivityLinkDecisionSchema = z
  .object({
    activityId: DatabaseIdSchema,
    /** Link the activity to this workout, or say it is not this workout. */
    decision: z.enum(['link', 'reject']),
  })
  .openapi('ActivityLinkDecision');

export type IntegrationsState = z.infer<typeof IntegrationsStateSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type Adherence = z.infer<typeof AdherenceSchema>;
export type WorkoutActual = z.infer<typeof WorkoutActualSchema>;
