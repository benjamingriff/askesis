# 8. Prove you can find things

[Day checklist](./README.md) · Previous: [Deployment](./07-deployment.md)

**30 minutes:** 10 explain, 15 navigation challenge, 5 next steps. Close the earlier chapters for the first two exercises. Reopen the source files as needed.

## Explain the system · 10 minutes

Write one paragraph for each prompt in your own words, using the IDs and observations from your notes:

1. **A workout on screen:** which rows store its title and prescription? Which function projects them, which request fetches them and which component formats them? Why can the card appear before the full prescription?
2. **A plan revision:** what changes when you unlock, edit and lock? Which IDs are physical versus lineage? How do expected counters, validation hashes, receipts and triggers protect different aspects of the operation?
3. **A coaching turn:** where do the prompt/tools come from, who calls the model, who writes PostgreSQL, and why do Stop and reload preserve committed edits?
4. **A release:** what is compiled, what is served, where do migrations run, where are secrets configured and what does readiness actually prove?

You pass this exercise when you can point to a concrete file/function for each major step. If you only remember a framework name, return to that step's source trace.

## Find the right place · 15 minutes

For each request below, give the first two files you would inspect and one relevant validation method. Do not implement changes during this exercise.

- [ ] “The workout dialog's target range is wrong, but stored zone values are right.”
- [ ] “I want a new public response field on workout cards.”
- [ ] “The coach should ask about tune-up races earlier.”
- [ ] “The coach claims it saved something, but the plan did not change.”
- [ ] “A second tab saves newer content while my details form is still open.”
- [ ] “Changing fitness updates draft zones but appears stale on a locked workout.”
- [ ] “The app renders after deploy but new coaching is unavailable.”
- [ ] “I want to add actual workout completion logging.”

Then compare your answers:

<details>
<summary>Expected starting points and checks</summary>

| Request                | Starting points                                                                                                                                                                                | Useful evidence                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Wrong displayed range  | `formatTarget` in [Workout.tsx](../../apps/web/src/components/Workout.tsx); `getWorkoutDetail` in [workout.repository.ts](../../apps/api/src/modules/workouts/workout.repository.ts)           | Compare response unit/values with SQL, then component formatting test and browser detail                                            |
| New card field         | [workout.schemas.ts](../../apps/api/src/modules/workouts/workout.schemas.ts); summary projection in workout repository                                                                         | Regenerate OpenAPI/client types, compile consuming component, verify real card                                                      |
| Earlier race question  | [prompt.ts](../../apps/agent/src/prompt.ts); shared marker/config in [worker config](../../apps/agent/src/config.ts) and [API tool schemas](../../apps/api/src/modules/agent/agent.schemas.ts) | Prompt compatibility tests and a focused real-coaching conversation; tool contracts if behavior needs structured changes            |
| Claimed unsaved change | `executeTool` in [agent.service.ts](../../apps/api/src/modules/agent/agent.service.ts); tool result handling in [runtime.ts](../../apps/agent/src/runtime.ts)                                  | Run status, receipt/change attribution, committed draft edit and owner/version selection; do not infer a write from assistant prose |
| Stale details form     | [EditDetailsDialog.tsx](../../apps/web/src/components/EditDetailsDialog.tsx); `editDraft` in [plan.service.ts](../../apps/api/src/modules/plans/plan.service.ts)                               | Expected draft/edit fields, conflict response, retained form baseline and retry/refresh behavior                                    |
| Stale locked pace      | `performance.changed` in [live.tsx](../../apps/web/src/live.tsx); `useWorkoutDetail` in [plan-data.ts](../../apps/web/src/plan-data.ts)                                                        | Compare fresh workout response versus cached UI; confirm effective date resolution in performance service                           |
| Unavailable coaching   | [API config](../../apps/api/src/config.ts); worker readiness/claim in agent service                                                                                                            | Signed-in chat capabilities, deployed worker settings/marker and sanitized registration logs                                        |
| Completion logging     | [data model](../architecture/data-model.md); [current product roadmap](../product/v1-poc-development-plan.md)                                                                                  | First design a new domain/storage/API workflow: `step_completions` stores prescriptions, not actual athlete activity                |

</details>

Notice that one symptom may span layers. Begin at the boundary you can observe: response versus display, claim versus receipt, startup versus registration. Avoid changing a prompt to repair a database authorization bug, or changing SQL values to repair a unit formatter.

## Save your map and choose the next deep dive · 5 minutes

- [ ] Keep your four artifacts: service map, database identity map, workout trace and coaching trace.
- [ ] Mark every browser/provider/hosted exercise you could not verify. An honest pending checklist is useful; reading tests is not the same as observing the app.
- [ ] Choose the two questions you still cannot answer. Link each to the first file you will inspect next time.

Suggested future sessions:

| Interest        | Bounded deep dive                                                                  |
| --------------- | ---------------------------------------------------------------------------------- |
| SQL and storage | Clone/hash invariants, deferred triggers, coverage and calibration effective dates |
| Frontend        | One component's props/state, query key, mutation, error UI and reload behavior     |
| API design      | One command from schema to ownership/concurrency checks to transaction/tests       |
| Coaching        | One tool's schema, prompt guidance, batch validation, receipt and failure paths    |
| Runtime         | Lease expiry/cancellation, live replay, progress batching and retained output      |
| Operations      | One deployment rehearsal, generated contract change, backup and isolated restore   |

Use the [navigation map](./README.md#keep-this-navigation-map) as your landing page after this day. For current work priorities use the [handoff](../current-handoff.md); for past intent use [ADRs](../adr/README.md); for current behavior prefer source and topic guides over historical phase checklists.
