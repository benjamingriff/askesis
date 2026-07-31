# Initial data-model implementation roadmap

> This document records the earlier persistence-focused sequence. The accepted product roadmap is now [V1 proof-of-concept development plan](./v1-poc-development-plan.md).

## Objective

Replace the current file-backed prototype incrementally, beginning with a durable domain model before redesigning the interface or introducing agent behaviour.

## Current status

- PostgreSQL runs locally through Docker Compose.
- Atlas owns the versioned relational schema.
- A two-week Cardiff example seed exercises plans, targets, workout trees, and effective-dated calibrations.
- Executable application-level domain schemas and the synthetic multi-sport fixture remain future work.

## Phase 1: finalise the vocabulary

Agree on the initial controlled values for:

- Disciplines
- Step kinds and roles
- Completion types
- Target types
- Units and canonical storage units
- Goal types
- Constraint types and severities
- Week target metrics
- Calibration systems

Test the vocabulary against representative prescriptions:

1. Easy endurance session
2. Running interval session
3. Cycling power workout
4. Swimming set
5. Strength superset
6. Mixed-discipline circuit

## Phase 2: executable domain schema

Implement TypeScript/Zod schemas independent of persistence. The schemas should:

- Use discriminated unions where appropriate.
- Validate valid completion and target combinations.
- Limit recursive nesting.
- Keep stored numeric values separate from display formatting.
- Support conversion between canonical and display units.
- Validate complete workout trees.

## Phase 3: relational schema

Create PostgreSQL migrations for the tables in [storage-architecture.md](./storage-architecture.md), including:

- Primary and foreign keys
- Ordering constraints
- Controlled vocabularies
- Type-specific check constraints
- Effective-date constraints for calibrations
- Required indexes

Implement repository functions that convert relational rows into the domain objects from Phase 2.

## Phase 4: synthetic plan

Create a synthetic multi-sport plan that exercises the model rather than only the current Cardiff running plan. It should include:

- Macro goals and constraints
- Multiple blocks and weeks
- Weekly target ranges
- At least two calibration profiles with different effective dates
- Endurance and strength sessions
- Repeats, recoveries, zones, and absolute targets
- A mixed-discipline workout

The synthetic plan becomes the main development fixture and should be insertable through a repeatable seed process.

## Phase 5: interface

Build the plan interface against the domain/API representation, including:

- Plan overview and intent
- Block and week navigation
- Target-versus-prescription summaries
- Rich workout tree visualisation
- Resolved zone values and their calibration source
- Useful presentation across running, cycling, swimming, and strength

## Phase 6: API and agent operations

After the model and interface are stable, expose plans through an API. Agent operations should use the same API as other clients and operate through explicit domain commands rather than direct database writes.

## Deferred work

Do not build these into the first persistence pass:

- Completed workout ingestion
- Wearable integration
- Decision logs
- Full plan revision history
- CTL or acute/chronic load models
- Agent orchestration
- Multi-database infrastructure
- Premature caches or materialised projections
