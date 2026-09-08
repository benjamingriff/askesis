import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { z } from '@hono/zod-openapi';
import { getDatabase } from '../../database/client.js';
import type { DB, Json } from '../../database/generated.js';
import {
  cloneContent,
  deleteDraftContent,
  readAggregate,
  summarizeChanges,
  type Database,
} from './plan.aggregate.js';
import { CONTENT_HASH_VERSION, contentHash, type SemanticValue } from './plan.canonical.js';
import {
  PlanSchema,
  SummarySchema,
  type Plan,
  type Command,
  type DraftPatchSchema,
} from './plan.schemas.js';
import { validatePlan, VALIDATOR_VERSION } from './plan.validation.js';

export class PlanError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 404 | 409 | 422 = 409,
  ) {
    super(message);
  }
}
const iso = (value: Date | string | null): string | null =>
  value instanceof Date ? value.toISOString() : value;
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

async function ownerPlan(db: Database, athleteId: string, planId: string, lock = false) {
  let query = db
    .selectFrom('plans')
    .selectAll()
    .where('id', '=', planId)
    .where('owner_id', '=', athleteId);
  if (lock) query = query.forUpdate();
  const plan = await query.executeTakeFirst();
  if (plan === undefined) throw new PlanError('PLAN_NOT_FOUND', 'Plan not found.', 404);
  return plan;
}
async function detail(db: Database, athleteId: string, planId: string): Promise<Plan> {
  const plan = await ownerPlan(db, athleteId, planId);
  const versions = await db
    .selectFrom('plan_versions')
    .selectAll()
    .where('plan_id', '=', planId)
    .execute();
  function version(id: string | null) {
    const row = versions.find((item) => item.id === id);
    return row === undefined
      ? null
      : {
          id: row.id,
          state: row.state,
          versionNumber: row.version_number,
          editNumber: row.edit_number,
          description: row.description,
          startDate: iso(row.start_date)?.slice(0, 10) ?? null,
          endDate: iso(row.end_date)?.slice(0, 10) ?? null,
          basedOnVersionId: row.based_on_version_id,
          supersedesVersionId: row.supersedes_version_id,
          lockedAt: iso(row.locked_at),
        };
  }
  return PlanSchema.parse({
    id: plan.id,
    displayName: plan.display_name,
    stateVersion: plan.state_version,
    active: plan.activated_at !== null,
    archived: plan.archived_at !== null,
    draft: version(plan.current_draft_version_id),
    locked: version(plan.current_locked_version_id),
  });
}
export async function getPlan(athleteId: string, planId: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute((db) => detail(db, athleteId, planId));
}
export async function listPlans(athleteId: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const plans = await db
        .selectFrom('plans')
        .select('id')
        .where('owner_id', '=', athleteId)
        .orderBy('created_at', 'desc')
        .execute();
      return Promise.all(plans.map((plan) => detail(db, athleteId, plan.id)));
    });
}
function editable(plan: Plan) {
  if (plan.archived)
    throw new PlanError('PLAN_ARCHIVED', 'Unarchive this plan before making changes.');
}
function stateMatches(plan: Plan, expected: number) {
  if (plan.stateVersion !== expected)
    throw new PlanError(
      'STALE_PLAN',
      'This plan changed elsewhere. Refresh and review the latest state.',
    );
}
function draftMatches(plan: Plan, id: string | undefined, edit: number | undefined) {
  if (plan.draft === null)
    throw new PlanError('DRAFT_REQUIRED', 'Unlock this plan before editing.');
  if (plan.draft.id !== id || plan.draft.editNumber !== edit)
    throw new PlanError(
      'STALE_DRAFT',
      'The draft changed elsewhere. Refresh and review your changes.',
    );
  return plan.draft;
}
async function bump(db: Transaction<DB>, planId: string) {
  await db
    .updateTable('plans')
    .set({ state_version: sql`state_version + 1`, updated_at: new Date() })
    .where('id', '=', planId)
    .execute();
}
async function idempotent(
  athleteId: string,
  scope: string,
  key: string,
  input: unknown,
  run: (db: Transaction<DB>) => Promise<Plan>,
) {
  const requestHash = contentHash(json(input) as SemanticValue);
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      // Serializes duplicate keys before they can create or mutate resources.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([athleteId, scope, key])}, 0))`.execute(
        db,
      );
      const existing = await db
        .selectFrom('api_idempotency_keys')
        .selectAll()
        .where('athlete_id', '=', athleteId)
        .where('command_scope', '=', scope)
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (existing !== undefined) {
        if (existing.request_hash !== requestHash)
          throw new PlanError(
            'IDEMPOTENCY_CONFLICT',
            'This request key was already used for different input.',
          );
        return PlanSchema.parse(existing.response_body);
      }
      const result = await run(db);
      await db
        .insertInto('api_idempotency_keys')
        .values({
          athlete_id: athleteId,
          command_scope: scope,
          idempotency_key: key,
          request_hash: requestHash,
          response_status: 200,
          response_body: json(result),
        })
        .execute();
      return result;
    });
}
export async function createPlan(athleteId: string, displayName: string, key: string) {
  return idempotent(athleteId, 'plan.create', key, { displayName }, async (db) => {
    const planId = randomUUID();
    const draftId = randomUUID();
    await db
      .insertInto('plans')
      .values({
        id: planId,
        owner_id: athleteId,
        display_name: displayName,
        current_draft_version_id: draftId,
      })
      .execute();
    await db.insertInto('plan_versions').values({ id: draftId, plan_id: planId }).execute();
    return detail(db, athleteId, planId);
  });
}
export async function editDraft(
  athleteId: string,
  planId: string,
  input: z.infer<typeof DraftPatchSchema>,
) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      await ownerPlan(db, athleteId, planId, true);
      const plan = await detail(db, athleteId, planId);
      editable(plan);
      const draft = draftMatches(plan, input.expectedDraftId, input.expectedEditNumber);
      if (
        draft.description !== input.description ||
        draft.startDate !== input.startDate ||
        draft.endDate !== input.endDate
      ) {
        await db
          .updateTable('plan_versions')
          .set({
            description: input.description,
            start_date: input.startDate,
            end_date: input.endDate,
            edit_number: draft.editNumber + 1,
            updated_at: new Date(),
          })
          .where('id', '=', draft.id)
          .execute();
      }
      return detail(db, athleteId, planId);
    });
}
async function preview(db: Database, plan: Plan) {
  if (plan.draft === null) throw new PlanError('DRAFT_REQUIRED', 'There is no editable draft.');
  const aggregate = await readAggregate(db, plan.draft.id);
  const previous = plan.locked === null ? null : await readAggregate(db, plan.locked.id);
  const hash = contentHash(aggregate.semantic);
  const findings = validatePlan(aggregate.validation);
  const headerChanges = ['description', 'startDate', 'endDate'].filter((key) => {
    const field = key as 'description' | 'startDate' | 'endDate';
    return plan.draft![field] !== (plan.locked?.[field] ?? null);
  });
  return {
    draftId: plan.draft.id,
    editNumber: plan.draft.editNumber,
    stateVersion: plan.stateVersion,
    contentHash: hash,
    validationDigest: contentHash(
      json({ validatorVersion: VALIDATOR_VERSION, findings }) as SemanticValue,
    ),
    findings,
    hasChanges: previous === null || contentHash(previous.semantic) !== hash,
    summary: SummarySchema.parse({
      headerChanges,
      entities: summarizeChanges(previous, aggregate),
    }),
  };
}
export async function previewLock(athleteId: string, planId: string) {
  return getDatabase()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => preview(db, await detail(db, athleteId, planId)));
}
export async function lockPlan(athleteId: string, planId: string, input: Command, key: string) {
  return idempotent(athleteId, 'plan.lock', key, { planId, ...input }, async (db) => {
    await ownerPlan(db, athleteId, planId, true);
    const plan = await detail(db, athleteId, planId);
    editable(plan);
    stateMatches(plan, input.expectedStateVersion);
    const draft = draftMatches(plan, input.expectedDraftId, input.expectedEditNumber);
    const result = await preview(db, plan);
    if (
      result.contentHash !== input.expectedContentHash ||
      result.validationDigest !== input.expectedValidationDigest
    )
      throw new PlanError('STALE_VALIDATION', 'Validate the current draft again before locking.');
    if (result.findings.some((finding) => finding.severity === 'error'))
      throw new PlanError('PLAN_INVALID', 'Resolve validation errors before locking.', 422);
    if (
      result.findings.some(
        (finding) =>
          finding.severity === 'warning' && !input.acknowledgedWarningCodes?.includes(finding.code),
      )
    )
      throw new PlanError(
        'WARNINGS_UNACKNOWLEDGED',
        'Acknowledge every warning before locking.',
        422,
      );
    if (!result.hasChanges)
      throw new PlanError(
        'NO_CHANGES',
        'The draft matches the current version. Edit it or discard it.',
      );
    const count = await db
      .selectFrom('plan_versions')
      .select(({ fn }) => fn.max<number>('version_number').as('latest'))
      .where('plan_id', '=', planId)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('plan_versions')
      .set({
        state: 'locked',
        version_number: (count.latest ?? 0) + 1,
        supersedes_version_id: plan.locked?.id ?? null,
        content_hash: result.contentHash,
        content_hash_version: CONTENT_HASH_VERSION,
        validator_version: VALIDATOR_VERSION,
        validation_findings: sql<Json>`${JSON.stringify(result.findings)}::jsonb`,
        acknowledged_warning_codes: [
          ...new Set(
            result.findings
              .filter((finding) => finding.severity === 'warning')
              .map((finding) => finding.code),
          ),
        ],
        change_summary: result.summary,
        locked_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', draft.id)
      .execute();
    await db
      .updateTable('plans')
      .set({ current_locked_version_id: draft.id, current_draft_version_id: null })
      .where('id', '=', planId)
      .execute();
    await bump(db, planId);
    return detail(db, athleteId, planId);
  });
}
export async function unlockPlan(athleteId: string, planId: string, expectedStateVersion: number) {
  return getDatabase()
    .transaction()
    .execute(async (db) => {
      await ownerPlan(db, athleteId, planId, true);
      const plan = await detail(db, athleteId, planId);
      editable(plan);
      if (plan.draft !== null) return plan;
      stateMatches(plan, expectedStateVersion);
      if (plan.locked === null)
        throw new PlanError('LOCKED_VERSION_REQUIRED', 'There is no locked version to unlock.');
      const source = await db
        .selectFrom('plan_versions')
        .selectAll()
        .where('id', '=', plan.locked.id)
        .executeTakeFirstOrThrow();
      const draftId = randomUUID();
      await db
        .insertInto('plan_versions')
        .values({
          id: draftId,
          plan_id: planId,
          description: source.description,
          start_date: source.start_date,
          end_date: source.end_date,
          based_on_version_id: source.id,
          content_schema_version: source.content_schema_version,
        })
        .execute();
      await cloneContent(db, source.id, draftId);
      await db
        .updateTable('plans')
        .set({ current_draft_version_id: draftId })
        .where('id', '=', planId)
        .execute();
      await bump(db, planId);
      return detail(db, athleteId, planId);
    });
}
export async function discardDraft(athleteId: string, planId: string, input: Command, key: string) {
  return idempotent(athleteId, 'plan.discard', key, { planId, ...input }, async (db) => {
    await ownerPlan(db, athleteId, planId, true);
    const plan = await detail(db, athleteId, planId);
    editable(plan);
    stateMatches(plan, input.expectedStateVersion);
    const draft = draftMatches(plan, input.expectedDraftId, input.expectedEditNumber);
    if (plan.locked === null)
      throw new PlanError('INITIAL_DRAFT', 'Archive an initial draft instead of discarding it.');
    await db
      .updateTable('plans')
      .set({ current_draft_version_id: null })
      .where('id', '=', planId)
      .execute();
    await deleteDraftContent(db, draft.id);
    await bump(db, planId);
    return detail(db, athleteId, planId);
  });
}
