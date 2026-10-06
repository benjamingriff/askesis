# Plan-version schema and API contract

Current implementation, verified 2026-10-06. This replaces the early proposed Phase 2 names/routes; the original delivery sequence remains in the [archive](../archive/phase-2/phase-2-implementation-plan.md).

## Logical metadata and version content

`plans` owns `display_name`, `owner_id`, `state_version`, `current_draft_version_id`, `current_locked_version_id`, `activated_at` and `archived_at`. Activation is independent of editing state and several plans may be active. Draft-only plans cannot activate. Archive preserves draft/locked content and makes the plan read-only.

`plan_versions` owns start/end dates, description, state (`draft`/`locked`), edit number, nullable version number, ancestry (`based_on_version_id`, `supersedes_version_id`), schema/hash/validator metadata and lock evidence. Dates can be absent in an initial API draft; lock validation requires valid bounds and a current confirmed brief.

The complete normalized aggregate includes brief, calibration, schedule coverage and workout descendants. Unlock creates new physical UUIDs while preserving lineage. Clone alone leaves semantic content equal. The latest content/hash/validator version is 3; existing locked versions retain their original versions and hashes.

## Commands and transaction rules

| Command             | Implemented behavior                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create              | Creates logical plan and first draft atomically; optional first conversation                                                                                 |
| Rename              | Changes logical display name without a content revision                                                                                                      |
| Edit draft header   | Checks draft/edit identity; description preserves brief confirmation, date changes invalidate it                                                             |
| Activate/deactivate | Desired state; activation requires locked content and an unarchived plan                                                                                     |
| Archive/unarchive   | Desired state; archive requires idle plan and archives associated conversations                                                                              |
| Unlock              | Requires idle, unarchived plan and current lock; existing draft returns idempotently                                                                         |
| Validate            | Computes findings/hash/digest; does not lock or mutate content                                                                                               |
| Lock                | Checks plan state, draft/edit, content hash and validation digest; blocks errors, requires all warning acknowledgements and current human brief confirmation |
| Discard             | Deletes unpublished draft and descendants; initial draft cannot be discarded; history/chat receipts survive                                                  |
| Restore preview     | Reads/validates a proposed copy against current pointers and source hash                                                                                     |
| Restore             | Copies supported historical content into a new draft; current lock remains until a later lock                                                                |

Lock promotes the draft row in place, assigns the next monotonically increasing version number and moves pointers in one transaction. Equal semantic content yields `NO_CHANGES` and leaves the draft available. Lock can combine human brief confirmation through `confirmBriefHash`; the transaction cannot confirm successfully while failing to lock.

Restore requires no existing draft, no archive/active run, and supported source content schema 2 or 3. Current/equivalent content yields `NO_CHANGES`. The restored draft is based on the source; the next lock supersedes the current lock, retaining intervening history.

## Concurrency and idempotency

Logical metadata changes use `stateVersion`; content writes use draft ID and `editNumber`. Review commands also carry source/current pointers, hashes or validation digest appropriate to the operation. A UI confirmation must submit the baseline the human reviewed, rather than silently fetching a new baseline.

Create, lock, discard and restore use `Idempotency-Key` headers, persisted per athlete/operation with request identity and response. Reusing a key with different input conflicts. Desired-state organization commands and unlock handle no-op retries without those keys. Brief/calibration command keys, where supported, are in their request bodies. Worker mutations use separate run-scoped receipts.

The API rejects incompatible active-run changes. Worker-authorized draft writes are checked against that run's own lease and target. The database independently blocks writes to locked version content.

## Public routes

```http
GET    /api/v1/plans
POST   /api/v1/plans
GET    /api/v1/plans/:planId
PATCH  /api/v1/plans/:planId
GET    /api/v1/plans/:planId/draft
PATCH  /api/v1/plans/:planId/draft
POST   /api/v1/plans/:planId/validate
POST   /api/v1/plans/:planId/activate
POST   /api/v1/plans/:planId/deactivate
POST   /api/v1/plans/:planId/archive
POST   /api/v1/plans/:planId/unarchive
POST   /api/v1/plans/:planId/unlock
POST   /api/v1/plans/:planId/lock
POST   /api/v1/plans/:planId/discard
GET    /api/v1/plans/:planId/revisions
GET    /api/v1/plans/:planId/revisions/:revisionId
POST   /api/v1/plans/:planId/revisions/:revisionId/restore-preview
POST   /api/v1/plans/:planId/revisions/:revisionId/restore
GET    /api/v1/plans/:planId/draft/changes
GET    /api/v1/workouts?planVersionId=:versionId
GET    /api/v1/workouts/:workoutId
```

The version selector for workout lists is required. Ownership joins protect all version/workout reads; an inaccessible version produces an empty workout list, while an inaccessible workout detail is hidden with 404. Read collection/pagination options and exact payloads in the [generated OpenAPI](../../packages/api-client/openapi.json).

## Evidence

[Plan service](../../apps/api/src/modules/plans/plan.service.ts), [routes](../../apps/api/src/modules/plans/plan.routes.ts), [aggregate](../../apps/api/src/modules/plans/plan.aggregate.ts), [database invariants](../../database/tests/plan-version-invariants.sql) and [integration tests](../../apps/api/test/db/).
