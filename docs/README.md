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
- [Railway prototype deployment plan](./railway-deployment-plan.md) — planned service topology, Clerk configuration, migrations, security, and rollout sequence.
- [V1 proof-of-concept development plan](./v1-poc-development-plan.md) — accepted phased plan for revisions, profiles, chat, agents, synchronization, deployment, and the private alpha.
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
