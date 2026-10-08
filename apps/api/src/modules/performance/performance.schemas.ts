import { z } from '@hono/zod-openapi';
import { Id } from '../plans/plan.common.js';

export const PaceInputSchema = z
  .discriminatedUnion('method', [
    z
      .object({
        method: z.literal('race_result'),
        distanceMetres: z.number().min(1609.344).max(42195),
        durationSeconds: z.number().int().positive(),
      })
      .strict(),
    z
      .object({ method: z.literal('threshold_pace'), secondsPerKilometre: z.number().positive() })
      .strict(),
  ])
  .openapi('PaceInput');
/** Cycling power: a known FTP, a 20-minute test (× 0.95) or a ramp test's best minute (× 0.75). */
export const PowerInputSchema = z
  .discriminatedUnion('method', [
    z.object({ method: z.literal('ftp'), watts: z.number().positive().max(2000) }).strict(),
    z
      .object({
        method: z.literal('twenty_minute_test'),
        averageWatts: z.number().positive().max(2000),
      })
      .strict(),
    z
      .object({ method: z.literal('ramp_test'), bestMinuteWatts: z.number().positive().max(3000) })
      .strict(),
  ])
  .openapi('PowerInput');
/** Swimming: an all-out 400 and 200 (critical swim speed test), or a known CSS pace per 100 m. */
export const SwimInputSchema = z
  .discriminatedUnion('method', [
    z
      .object({
        method: z.literal('css_test'),
        t400Seconds: z.number().positive().max(3600),
        t200Seconds: z.number().positive().max(1800),
      })
      .strict(),
    z
      .object({
        method: z.literal('css_pace'),
        secondsPer100Metres: z.number().positive().max(600),
      })
      .strict(),
  ])
  .openapi('SwimInput');
export const CalibrationMethodInputSchema = z
  .union([PaceInputSchema, PowerInputSchema, SwimInputSchema])
  .openapi('CalibrationMethodInput');
export const PerformanceSystemSchema = z
  .enum(['run_pace', 'cycle_power', 'swim_pace'])
  .openapi('PerformanceSystem');
export type PerformanceSystem = z.infer<typeof PerformanceSystemSchema>;
export const ProvenanceSchema = z.enum(['user_supplied', 'user_estimate', 'agent_estimate']);
const evidence = {
  provenance: ProvenanceSchema.optional(),
  estimateBasis: z.string().trim().min(1).max(4000).optional(),
  /** The day of the race or test; it may be in the past. Paces still apply from today. */
  observedOn: z.iso.date().optional(),
};
/** One variant per system; each system's input is validated by its own calculator. */
export const CalibrationInputSchema = z.discriminatedUnion('system', [
  z.object({ system: z.literal('run_pace'), input: PaceInputSchema, ...evidence }).strict(),
  z.object({ system: z.literal('cycle_power'), input: PowerInputSchema, ...evidence }).strict(),
  z.object({ system: z.literal('swim_pace'), input: SwimInputSchema, ...evidence }).strict(),
]);
export type CalibrationInput = z.infer<typeof CalibrationInputSchema>;
const idempotencyKey = z.string().min(1).max(200).optional();
export const RecordCalibrationSchema = z
  .discriminatedUnion('system', [
    z
      .object({
        system: z.literal('run_pace'),
        input: PaceInputSchema,
        ...evidence,
        idempotencyKey,
      })
      .strict(),
    z
      .object({
        system: z.literal('cycle_power'),
        input: PowerInputSchema,
        ...evidence,
        idempotencyKey,
      })
      .strict(),
    z
      .object({
        system: z.literal('swim_pace'),
        input: SwimInputSchema,
        ...evidence,
        idempotencyKey,
      })
      .strict(),
  ])
  .openapi('RecordCalibration');
export const RetractCalibrationSchema = z.object({ idempotencyKey }).strict();
export const PreviewCalibrationSchema = z
  .discriminatedUnion('system', [
    z.object({ system: z.literal('run_pace'), input: PaceInputSchema }).strict(),
    z.object({ system: z.literal('cycle_power'), input: PowerInputSchema }).strict(),
    z.object({ system: z.literal('swim_pace'), input: SwimInputSchema }).strict(),
  ])
  .openapi('PreviewCalibration');

export const ZoneSchema = z
  .object({
    key: z.string(),
    metric: z.string(),
    unit: z.string(),
    minimum: z.number(),
    target: z.number(),
    maximum: z.number(),
  })
  .openapi('CalibrationZone');
export const CalibrationEntrySchema = z
  .object({
    id: Id,
    system: PerformanceSystemSchema,
    method: z.string(),
    input: CalibrationMethodInputSchema,
    calculatorVersion: z.string(),
    provenance: ProvenanceSchema,
    estimateBasis: z.string().nullable(),
    observedOn: z.string().nullable(),
    effectiveFrom: z.string(),
    recordedAt: z.string(),
    recordedBy: z.enum(['athlete', 'coach']),
    conversationId: Id.nullable(),
    retractedAt: z.string().nullable(),
    zones: z.array(ZoneSchema),
  })
  .openapi('CalibrationEntry');
export type CalibrationEntry = z.infer<typeof CalibrationEntrySchema>;
export const PerformanceStateSchema = z
  .object({
    timezone: z.string(),
    today: z.string(),
    /** The entry in effect today for each calibrated system. */
    current: z.array(CalibrationEntrySchema),
    /** Every entry, newest first, including retracted ones. */
    entries: z.array(CalibrationEntrySchema),
    /**
     * Systems whose sport appears in one of the athlete's unarchived plans (its brief or its
     * workouts), calibrated or not. Other sports can still be added but need not be shown.
     */
    usedByPlans: z.array(PerformanceSystemSchema),
  })
  .openapi('PerformanceState');
export type PerformanceState = z.infer<typeof PerformanceStateSchema>;
export const CalibrationPreviewResultSchema = z
  .object({
    system: PerformanceSystemSchema,
    method: z.string(),
    calculatorVersion: z.string(),
    zones: z.array(ZoneSchema),
    /**
     * The entry in effect today; absent before any is recorded. Optional rather than nullable:
     * a nullable named schema loses its null in the generated client types.
     */
    current: CalibrationEntrySchema.optional(),
  })
  .openapi('CalibrationPreview');
