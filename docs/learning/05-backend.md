# 5. Trace backend commands and plan history

[Day checklist](./README.md) · Previous: [Frontend](./04-frontend.md) · Next: [Coach](./06-agent.md)

**65 minutes:** 15 boundaries, 20 command trace, 20 local experiment, 10 checkpoint. Your output is an explanation of who may change a plan, what version changes and why stale writes fail.

## Where responsibility lives · 15 minutes

Start at [app.ts](../../apps/api/src/app.ts). `OpenAPIHono` registers middleware and module routes, provides public API docs, and centralizes errors. [server.ts](../../apps/api/src/server.ts) starts the Node listener and background executor/sweeper, then handles shutdown. Production starts through [operations/start.ts](../../apps/api/src/operations/start.ts), which can publish configured examples before loading the server. The local `dev` script starts `server.ts` directly.

| Layer                           | Question it answers                                         | Example                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication middleware       | Who is making this request?                                 | [requireAuthentication](../../apps/api/src/auth/middleware.ts) verifies a Clerk session                                                               |
| Identity provisioning           | Which internal athlete does this identity mean?             | [ensureAthlete](../../apps/api/src/auth/athlete-provisioning.ts)                                                                                      |
| Route/schema                    | Is the request well formed; which command/read is intended? | [plan routes](../../apps/api/src/modules/plans/plan.routes.ts), [plan schemas](../../apps/api/src/modules/plans/plan.schemas.ts)                      |
| Domain service                  | Is it allowed now, and what must commit together?           | [plan service](../../apps/api/src/modules/plans/plan.service.ts), [brief service](../../apps/api/src/modules/plans/brief.service.ts)                  |
| Repository/aggregate            | Which rows produce this response or semantic plan?          | [workout repository](../../apps/api/src/modules/workouts/workout.repository.ts), [plan aggregate](../../apps/api/src/modules/plans/plan.aggregate.ts) |
| PostgreSQL constraints/triggers | Is the stored structure valid and immutable where required? | [plan-version migration](../../database/migrations/20260907120000_plan_versions.sql) and later migrations                                             |

This is a navigation convention, not a rigid folder rule: several services perform Kysely queries directly. There is no general repository class for every table.

Public domain requests derive the athlete from the session; clients do not choose an owner in a request body. Workout queries join through plans and filter `owner_id`. Plan services use `ownerPlan` in [plan.service.ts](../../apps/api/src/modules/plans/plan.service.ts). Authentication and ownership are separate checks: being signed in is not permission to read another plan UUID.

## Follow two command paths · 20 minutes

### A. Edit draft details · 8 minutes

Read `save` in [EditDetailsDialog.tsx](../../apps/web/src/components/EditDetailsDialog.tsx), its `PATCH …/draft` route, and `editDraft` in [plan.service.ts](../../apps/api/src/modules/plans/plan.service.ts).

The form sends `expectedDraftId` and `expectedEditNumber` along with description/dates. The API checks ownership, draft identity and editable state before applying changes transactionally. Version edits increment `edit_number`; aggregate queries then have a new cache identity. A name change is a different request against the logical plan, with `expectedStateVersion`. This details-edit path can change a draft while coaching is active; the worker's next tool detects stale context. Lifecycle actions such as lock/unlock separately require an idle plan.

These counters implement optimistic concurrency: “apply this only if I am still editing the state I saw.” Locks inside transactions serialize sensitive decisions. The form deliberately keeps its reviewed baseline; an invisible background refresh does not silently overwrite your saved form's concurrency values.

### B. Review and lock · 12 minutes

Read `validate` and the lock branch of `mutation` in [PlanLifecycle.tsx](../../apps/web/src/components/PlanLifecycle.tsx), then `preview` and `lockPlanRows` in the plan service. Open [plan.validation.ts](../../apps/api/src/modules/plans/plan.validation.ts) only to see how findings are assembled. Open `canonicalJson`/`contentHash` in [plan.canonical.ts](../../apps/api/src/modules/plans/plan.canonical.ts).

The flow is:

1. Validate the current aggregate and compute a preview: draft identity/edit, plan state, content hash, validation digest, findings and summary.
2. The human reviews brief/schedule and acknowledges relevant warnings.
3. Lock sends those expected values and an idempotency key. It may also confirm the reviewed brief in the same transaction.
4. The API rechecks ownership, idle state, concurrency, hashes, errors and warning acknowledgements.
5. It promotes the **same draft version row** to `locked`, assigns the next version number, saves validation/provenance, updates logical plan pointers and commits.

Canonical hashing represents semantic content with stable ordering. It excludes physical row IDs and chat history. The current hash version is 7 in source; stored older hashes are historical evidence, and comparisons recompute current semantics. A validation digest adds protection for what was reviewed, beyond knowing the content is identical.

**Idempotency is different from concurrency.** A repeated supported command with the same operation key/input returns its original recorded response; reusing the key with different input conflicts. This handles an uncertain HTTP response after a commit. A stale edit number protects against applying a new command to someone else's newer content. Inspect `idempotent` and `api_idempotency_keys` in the service. Not every route uses idempotency keys; follow its schema rather than assuming all PATCH/POST requests are identical.

## Exercise: observe a draft edit locally · 20 minutes

Use only your local verification account. Select an example; note its locked version ID, version number and content hash in your read-only SQL client. Do not edit hosted examples for this exercise.

- [ ] Use the plan's **Unlock** action, confirming if prompted. The current locked row stays unchanged; a new draft with `based_on_version_id` and cloned child rows appears.
- [ ] Record the new draft ID/edit number. Inspect one cloned workout's physical and lineage IDs; compare with its locked source.
- [ ] Open **Edit details**, append “Learning exercise” to the draft description, and save. Keep dates/name unchanged so you can isolate this one field.
- [ ] In Network, inspect the PATCH route, nonsecret expected fields and returned draft edit number. Compare the SQL row and UI description.
- [ ] Reload, return to that plan's draft view and confirm the description persists. Switch to locked view and check its original description.
- [ ] Open the review/lock UI to inspect validation. You do not need to lock for this exercise. A description-only edit changes semantic plan content; date changes additionally clear brief confirmation. Review the actual findings rather than assuming every edit requires the same confirmation.
- [ ] Optionally discard the exercise draft through the app after noting the result. Discard removes the unpublished draft; locked history remains. Keeping it for chapter 6 is also fine.

The local example publisher preserves edited/unlocked examples rather than undoing your work on a rerun. You cannot rely on seeding again to reset this plan. [Example preservation](../operations/example-plan.md#reruns-dates-and-preservation) explains how managed editions are tracked.

Reading fallback: follow `unlockPlanRows` → `cloneContent` in [plan.aggregate.ts](../../apps/api/src/modules/plans/plan.aggregate.ts), and the behavior cases in [plan.service DB tests](../../apps/api/test/db/plan.service.test.ts). Mark the interactive checkpoint unverified if unavailable.

## Checkpoint · 10 minutes

Explain each operation:

| Operation        | Result                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Rename           | Changes logical metadata; old version content is unchanged                                   |
| Edit draft       | Changes mutable version content, advances edit identity                                      |
| Lock             | Promotes current draft into immutable numbered history                                       |
| Unlock           | Clones locked aggregate into a new mutable draft                                             |
| Restore          | Copies supported historical content into a draft; does not move the locked pointer backwards |
| Activate/archive | Organizes the logical plan; separate from publishing content                                 |

Answer: Why should you not change a row with SQL merely because its FK is valid? **SQL is an operator path; domain authorization, lifecycle, concurrency, coverage and validation rules also matter.** Locked-content triggers protect important storage invariants, but do not implement the whole application workflow.

Optional later: [version schema contract](../architecture/phase-2-schema-contract.md), [brief contract](../architecture/phase-3-schema-contract.md), [database invariants](../../database/tests/plan-version-invariants.sql).
