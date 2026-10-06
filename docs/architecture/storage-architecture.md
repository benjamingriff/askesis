# Storage architecture

Verified against the applied migration sequence and generated types on 2026-10-06. PostgreSQL is authoritative. Atlas exclusively owns migrations; Kysely provides typed queries, not a second schema authority. Deployed migrations are append-only.

## Current tables

| Area                            | Tables                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Identity                        | `athletes`, `athlete_identities`                                                                                     |
| Logical plan and versions       | `plans`, `plan_versions`                                                                                             |
| Brief                           | `plan_briefs`, `plan_brief_weekdays`                                                                                 |
| Fitness and coverage            | `calibration_profiles`, `calibration_zones`, `plan_calibration_periods`, `plan_schedule_coverage`                    |
| Schedule                        | `training_blocks`, `training_weeks`, `week_targets`, `workouts`, `workout_tags`                                      |
| Prescription tree               | `movement_definitions`, `workout_steps`, `step_completions`, `step_targets`                                          |
| Conversations                   | `conversations`, `conversation_messages`                                                                             |
| Execution                       | `agent_runs`, `agent_run_events`, `agent_workers`, `agent_tool_receipts`, `agent_tool_changes`, `agent_run_finishes` |
| Visible output and measurements | `agent_run_outputs`, `agent_progress_batches`, `agent_run_measurements`                                              |
| Live delivery                   | `live_event_heads`, `live_events`                                                                                    |
| Command and fixture bookkeeping | `api_idempotency_keys`, `seed_runs`                                                                                  |

Atlas also maintains `atlas_schema_revisions`. Derived views are `workout_prescription_totals` and `weekly_plan_summary`. SQL definitions, constraints and exact nullable fields are in [migrations](../../database/migrations/) and [generated types](../../apps/api/src/database/generated.ts).

## Version aggregate and immutability

Version-owned rows carry `plan_version_id`. Content entities use physical UUIDs plus stable lineage IDs to distinguish cloning from semantic change. Supporting rows such as completions and tags are linked through their parents. Composite foreign keys keep nested schedule references in the same version.

Logical plan metadata remains mutable independently of content. A locked version and its descendants are protected by database triggers as well as service rules. Unlock and restore copy the normalized aggregate transactionally. Lock stores a canonical content hash, validator version, findings, warning acknowledgements and summary; later content does not overwrite earlier locks.

Database constraints cover structural integrity and immutable content. The API additionally enforces owner authorization, draft state, concurrency, active-run exclusion, brief confirmation and lock validation. A valid SQL row alone is not sufficient evidence that a plan is ready to lock.

## Relational content and bounded JSON

Brief facts, calibration values, effective periods and workout prescriptions are relational. JSONB is used for bounded validation findings, summaries, command responses, run/event metadata, receipts and saved-change attribution. Those records do not replace normalized plan content with an editable JSON snapshot.

Idempotency keys are scoped to athlete and operation. Receipts store request identity and committed response with domain writes; repeated delivery returns the original result. Run provenance retains scalar version references where a foreign key would prevent unpublished draft deletion.

## Dates and units

Schedule/effective dates use SQL `date`. The API installs a PostgreSQL date parser returning `YYYY-MM-DD` strings, avoiding timezone conversion of calendar dates. Instants such as lock time and lease expiry use timezone-aware timestamps. Lease deadlines are calculated by application code; there is no guarantee that all run timing is based on the database clock.

Canonical distance is metres and canonical absolute running pace is seconds per kilometre. Display units are a versioned brief preference. Resolved workout pace reads return their display unit explicitly.

## Migrations and development data

The latest required migration is `20261005120000_live_coaching.sql`. Apply the full ordered history, not only this file. The older plan-version cutover and brief migrations include historical schema transformations; they are not a current permission to reset user data.

The development seed is guarded by `seed_runs`. It creates a synthetic-owner draft. The separate development fixture publisher confirms, locks and activates it through domain services. Neither belongs in Railway. The publisher rejects production/Railway execution.

See [database setup](../operations/database-setup.md), [backup/restore](../operations/database-backup-and-restore.md), [plan invariants](./phase-2-schema-contract.md) and [brief/calibration contract](./phase-3-schema-contract.md).
