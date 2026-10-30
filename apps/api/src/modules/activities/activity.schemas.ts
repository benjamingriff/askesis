import { z } from '@hono/zod-openapi';
import { Id } from '../plans/plan.common.js';

const instant = z.string().openapi({ format: 'date-time' });
const sports = ['run', 'cycle', 'swim', 'strength', 'row', 'other'] as const;

export const StravaConnectionSchema = z
  .object({
    status: z.enum(['active', 'reauthorization_required']),
    displayName: z.string().nullable(),
    connectedAt: instant,
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
export type IntegrationsState = z.infer<typeof IntegrationsStateSchema>;

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

/** Provider activity ids: Strava's are 64-bit integers. */
export const ProviderActivityIdSchema = z.string().regex(/^\d{1,20}$/);

/**
 * An activity read live from Strava for display only. Askesis doesn't store these; the
 * response exists for this request and the athlete's browser session.
 */
export const ActivitySummarySchema = z
  .object({
    provider: z.literal('strava'),
    id: ProviderActivityIdSchema,
    /** "View on Strava". */
    url: z.string().url(),
    name: z.string(),
    sport: z.enum(sports),
    sportType: z.string(),
    /** The calendar day and wall-clock time where the activity happened. */
    date: z.iso.date(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    elapsedSeconds: z.number().int(),
    movingSeconds: z.number().int().nullable(),
    distanceMetres: z.number().nullable(),
    elevationGainMetres: z.number().nullable(),
  })
  .openapi('ActivitySummary');
export type ActivitySummary = z.infer<typeof ActivitySummarySchema>;

export const ActivityLapSchema = z
  .object({
    index: z.number().int(),
    name: z.string().nullable(),
    elapsedSeconds: z.number().int(),
    movingSeconds: z.number().int().nullable(),
    distanceMetres: z.number().nullable(),
    /** Metres per second. */
    averageSpeed: z.number().nullable(),
    averageHeartrate: z.number().int().nullable(),
    averageCadence: z.number().nullable(),
    averageWatts: z.number().int().nullable(),
  })
  .openapi('ActivityLap');

export const ActivityDetailSchema = ActivitySummarySchema.extend({
  description: z.string().nullable(),
  deviceName: z.string().nullable(),
  averageSpeed: z.number().nullable(),
  maxSpeed: z.number().nullable(),
  averageHeartrate: z.number().int().nullable(),
  maxHeartrate: z.number().int().nullable(),
  averageCadence: z.number().nullable(),
  averageWatts: z.number().int().nullable(),
  calories: z.number().int().nullable(),
  trainer: z.boolean(),
  manual: z.boolean(),
  laps: z.array(ActivityLapSchema),
}).openapi('ActivityDetail');
export type ActivityDetail = z.infer<typeof ActivityDetailSchema>;

export const ActivityListSchema = z
  .object({
    /** The days searched, inclusive. */
    from: z.iso.date(),
    to: z.iso.date(),
    activities: z.array(ActivitySummarySchema),
  })
  .openapi('ActivityList');

export const ActivityListQuerySchema = z.object({
  /** Search the week either side of this day. */
  around: z.iso.date(),
});

/**
 * The athlete's link between a planned workout and a recorded activity. Only identifiers are
 * stored: activity details are fetched from the provider whenever they are shown.
 */
export const ActivityLinkSchema = z
  .object({
    lineageId: Id,
    provider: z.literal('strava'),
    activityId: ProviderActivityIdSchema,
    url: z.string().url(),
    linkedAt: instant,
  })
  .openapi('ActivityLink');
export type ActivityLink = z.infer<typeof ActivityLinkSchema>;

export const ActivityLinksSchema = z
  .object({ links: z.array(ActivityLinkSchema) })
  .openapi('ActivityLinks');

export const ActivityLinkInputSchema = z
  .object({ provider: z.literal('strava'), activityId: ProviderActivityIdSchema })
  .openapi('ActivityLinkInput');
