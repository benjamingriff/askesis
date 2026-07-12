import { z } from 'zod';

export const IntervalSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string(),
  intensity: z.string().optional(),
  recovery_or_pace: z.string().optional(),
});

export const SessionSchema = z.object({
  id: z.string(), date: z.string(), day: z.string(), title: z.string(), type: z.string(),
  phase: z.string(), week: z.number(), tags: z.array(z.string()), estimated_distance_km: z.number(),
  priority: z.enum(['low','medium','high']), summary: z.string(), pace_guide: z.string().optional(),
  intervals: z.array(IntervalSchema),
});

export const WeekSchema = z.object({
  id: z.string(), number: z.number(), date_range: z.object({start:z.string(), end:z.string()}),
  phase: z.string(), theme: z.string(), target_volume_km: z.number(), sessions: z.array(z.string()), notes: z.array(z.string()).optional(),
});

export const PhaseSchema = z.object({
  id: z.string(), number: z.number(), title: z.string(), date_range: z.object({start:z.string(), end:z.string()}),
  weeks: z.array(z.number()), goals: z.array(z.string()), accent: z.string().optional(), deload_weeks: z.array(z.number()).optional(),
});

export const PlanSchema = z.object({
  id:z.string(), title:z.string(), athlete:z.string(), race:z.any(), dates:z.any(), goals:z.any(), vdot:z.any(), zones:z.record(z.string(), z.any()), weekly_structure:z.record(z.string(), z.string()), guardrails:z.array(z.string()),
});

export type Session = z.infer<typeof SessionSchema>;
export type Week = z.infer<typeof WeekSchema> & { sessionObjects: Session[] };
export type Phase = z.infer<typeof PhaseSchema>;
export type Plan = z.infer<typeof PlanSchema>;
