import { z } from '@hono/zod-openapi';
import { Id } from '../plans/plan.schemas.js';
import { GenerationSchema } from '../plans/schedule-generation.js';

export const ContextSchema = z.object({
  versionId: Id,
  state: z.enum(['draft', 'locked']),
  versionNumber: z.number().int().nullable(),
  editNumber: z.number().int().positive(),
});
export const TargetSchema = z.object({
  versionId: Id,
  editNumber: z.number().int().positive(),
});
export const SendSchema = z.object({
  content: z.string().trim().min(1).max(32000),
  target: TargetSchema.nullable().default(null),
});
export const CreateConversationSchema = z.object({
  planId: Id.optional(),
  initialMessage: SendSchema.optional(),
});
export const ConversationSchema = z.object({
  id: Id,
  title: z.string(),
  planId: Id.nullable(),
  planName: z.string().nullable(),
  archived: z.boolean(),
  planArchived: z.boolean(),
  stateVersion: z.number().int(),
  createdAt: z.string(),
  activityAt: z.string(),
  context: ContextSchema.nullable(),
});
export const RunSchema = z.object({
  id: Id,
  conversationId: Id,
  planId: Id.nullable(),
  userMessageId: Id,
  status: z.enum(['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled']),
  context: ContextSchema.nullable(),
  failureCode: z.string().nullable(),
  generation: GenerationSchema.nullable().optional(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export const MessageSchema = z.object({
  id: Id,
  conversationId: Id,
  sequence: z.number().int(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  producingRunId: Id.nullable(),
  context: ContextSchema.nullable(),
  createdAt: z.string(),
});
export const EventSchema = z.object({
  sequence: z.number().int(),
  type: z.string(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
export const ConversationDetailSchema = ConversationSchema.extend({
  activeRun: RunSchema.nullable(),
  latestRun: RunSchema.nullable(),
});
export const AcceptedSchema = z.object({ message: MessageSchema, run: RunSchema });
export const CreatedSchema = z.object({
  conversation: ConversationSchema,
  accepted: AcceptedSchema.nullable(),
});
export const ListQuerySchema = z.object({
  collection: z.enum(['open', 'archive']).default('open'),
  planId: Id.optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type Target = z.infer<typeof TargetSchema> | null;
export type Send = z.infer<typeof SendSchema>;
export type Context = z.infer<typeof ContextSchema> | null;
