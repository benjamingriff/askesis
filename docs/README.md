# Architecture documentation

This directory records the proposed direction for Askesis beyond the original file-backed prototype.

## Current decisions

- [ADR 0001: Initial application stack](./adr/0001-application-stack.md) — React, Vite, React Router, Hono, OpenAPI, Kysely, and Atlas.
- [ADR 0002: Package management](./adr/0002-package-management.md) — pnpm workspaces, version pinning, and frozen-lockfile builds.
- [Data model](./data-model.md) — plan hierarchy, workout prescription tree, targets, and calibration.
- [Storage architecture](./storage-architecture.md) — PostgreSQL persistence and relational table design.
- [Repository and service architecture](./repository-and-service-architecture.md) — monorepo layout, service boundaries, agent integration, and IaC ownership.
- [Local database setup](./database-setup.md) — Docker Compose, Atlas migrations, and seed lifecycle.
- [Database backup and restore](./database-backup-and-restore.md) — manual backup, verification, and disaster-restore procedures.
- [Prototype observability](./observability.md) — Pino logs, request correlation, health checks, and Sentry configuration.
- [Local application development](./local-development.md) — run the web/API stack and regenerate types.
- [Railway prototype deployment plan](./railway-deployment-plan.md) — deployed service topology, Clerk configuration, migrations, security, and rollout sequence.
- [V1 proof-of-concept development plan](./v1-poc-development-plan.md) — accepted phased plan for revisions, profiles, chat, agents, synchronization, deployment, and the private alpha.
- [Phase 2 plan lifecycle refinement](./phase-2-plan-lifecycle-refinement.md) — accepted product and architecture contract for logical plans, drafts, immutable versions, lifecycle operations, and the thin Phase 2 UI.
- [Phase 2 schema contract](./phase-2-schema-contract.md) — proposed relational tables, keys, constraints, immutability, identity, and transaction boundaries for Phase 2.
- [Phase 2 implementation plan](./phase-2-implementation-plan.md) — proposed backend-first delivery stages, API/UI work, verification, and Railway cutover.
- [Phase 3 plan brief and running pace calibration](./phase-3-plan-brief-and-calibration-refinement.md) — accepted product contract for plan-specific running context, human confirmation, and effective-dated pace guides.
- [Phase 3 schema and API contract](./phase-3-schema-contract.md) — proposed brief, weekday, calibration, confirmation, effective-period, and workout-resolution contracts.
- [Phase 3 implementation plan](./phase-3-implementation-plan.md) — proposed calculator-first delivery stages, API/UI work, verification, and Railway rollout.
- [Phase 4 design](./phase-4-design.md) — approved durable conversation and run lifecycle contract, archive semantics, and recorded alpha decisions; real coaching arrives in Phase 5.
- [Phase 4 implementation plan](./phase-4-implementation-plan.md) — delivery stages, Phase 3 integration seams, and acceptance checks for persistent chat.
- [Phase 5 design](./phase-5-design.md) — refined coaching behavior, OpenAI Agents SDK worker, authorized domain tools, and partial planning horizons.
- [Phase 5 implementation plan](./phase-5-implementation-plan.md) — delivery stages, worker reliability, and acceptance checks.
- [Example queries](./example-queries.md) — inspect plans, workout trees, weekly totals, and calibrations.
- [Implementation roadmap](./implementation-roadmap.md) — the earlier data-model implementation sequence and deferred concerns.

These documents combine implemented architecture with agreed future direction. Each document records its own status where the distinction matters.

## Guiding principles

1. A plan has both top-down intent and bottom-up workout prescriptions.
2. Workouts use a small, sport-neutral composition model without erasing sport-specific semantics.
3. Fitness calibrations are versioned and applied by effective date.
4. PostgreSQL is the sole source of truth for core domain data.
5. Core plan and workout data is relational rather than stored in JSONB.
6. Nested API responses are assembled by the application from relational rows.
7. Metrics are derived from prescriptions; macro targets express the desired result.

- [Phase 5 runtime](./phase-5-runtime.md) — local worker setup, private deployment configuration, lease recovery and verification.
