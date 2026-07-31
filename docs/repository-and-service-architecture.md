# Repository and service architecture

## Status

This document records the proposed target architecture. The directories and services should be introduced incrementally rather than created empty in advance.

## Runtime architecture

The initial platform should have four primary runtime components:

```text
Browser
   │
   ▼
Web application / optional BFF
   │
   ▼
Core platform API ────────── PostgreSQL
   ▲
   │
Agent worker
```

1. **PostgreSQL** is the system of record.
2. **Core API** owns the domain and is the only application with database credentials.
3. **Agent worker** performs long-running AI workflows and uses the core API.
4. **Web application** displays and edits plans through the core API.

A separate generic database API and display backend are not required. The core API should provide both domain operations and purpose-built read endpoints.

## Core API responsibilities

The core API owns:

- Plans
- Goals and constraints
- Training blocks and weeks
- Workout prescriptions
- Calibration profiles
- Derived metrics and validation
- Plan mutations
- Eventually agent runs and conversations

It should expose domain resources and operations rather than database tables directly. Examples include:

```text
GET  /plans/:id
GET  /plans/:id/weeks
GET  /workouts/:id
POST /workouts
POST /workouts/:id/move
POST /plans/:id/recalibrate
POST /plans/:id/validate
```

Purpose-built read endpoints may support frontend views:

```text
GET /plans/:id/overview
GET /plans/:id/calendar
GET /plans/:id/weeks/:weekNumber
```

These endpoints may use SQL views and internal read projections while preserving a single domain boundary.

## Web application and BFF

If the frontend uses Next.js or another server-capable framework, its server layer may act as a thin backend-for-frontend (BFF) responsible for:

- Browser authentication and sessions
- Server-side rendering
- Combining API responses for a page
- Hiding internal service addresses
- UI-specific caching

The BFF must not:

- Query PostgreSQL directly
- Reimplement plan or workout rules
- Own calibration state
- Apply changes outside the core API

A client-side application could call the core API directly, in which case a BFF may not initially be necessary.

## Agent service

The agent should be independently deployable because it has different operational characteristics:

- Long-running operations
- LLM provider credentials
- Retries and timeouts
- Queue consumption
- Unpredictable resource usage
- Independent scaling
- Potential sandboxing requirements

The agent does **not** receive database credentials and does not have a separate plan API. It uses the same core API and typed API client as other consumers:

```text
Agent reads plan through API
        ↓
Agent proposes domain mutation
        ↓
API validates and applies mutation
        ↓
Agent reads validation result
        ↓
Agent continues or explains the outcome
```

Service credentials can grant explicit scopes such as:

```text
plans:read
workouts:write
calibrations:write
validation:run
```

### Agent orchestration endpoints

Agent lifecycle endpoints are distinct from plan operations and may live in the core API initially:

```text
POST /agent-runs
GET  /agent-runs/:id
POST /agent-runs/:id/cancel
POST /coach/messages
```

An eventual asynchronous flow may be:

```text
Frontend
   │ POST /coach/messages
   ▼
Core API
   │ enqueue run
   ▼
Queue
   │
   ▼
Agent worker
   │ call plan operations
   ▼
Core API
```

The worker may expose private health or callback endpoints, but it should not provide an alternative plan API.

## Target monorepo layout

```text
askesis/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── plans/
│   │   │   │   ├── workouts/
│   │   │   │   ├── calibrations/
│   │   │   │   ├── validation/
│   │   │   │   └── agent-runs/
│   │   │   ├── database/
│   │   │   ├── auth/
│   │   │   └── server/
│   │   └── tests/
│   ├── web/
│   │   ├── src/
│   │   └── tests/
│   └── agent/
│       ├── src/
│       │   ├── workflows/
│       │   ├── tools/
│       │   ├── prompts/
│       │   ├── providers/
│       │   └── worker/
│       └── tests/
├── packages/
│   ├── contracts/
│   ├── api-client/
│   ├── domain/
│   ├── config/
│   ├── observability/
│   └── ui/
├── database/
│   ├── atlas.hcl
│   ├── migrations/
│   └── seed/
├── infra/
│   ├── modules/
│   ├── environments/
│   │   ├── development/
│   │   ├── staging/
│   │   └── production/
│   └── README.md
├── docs/
│   ├── adr/
│   └── ...
├── scripts/
├── compose.yaml
└── README.md
```

This is a target layout, not an instruction to create every directory immediately. A smaller practical starting point is:

```text
apps/
  api/
  web/
  agent/

packages/
  contracts/
  api-client/
  domain/

database/
  migrations/
  seed/

docs/
compose.yaml
```

The repository now uses this database layout. Application and package directories should continue to be introduced only as implementation begins.

## Package boundaries

### `packages/contracts`

Contains transport-level definitions shared across service boundaries:

- API request and response schemas
- OpenAPI definitions
- Zod schemas where appropriate
- Shared wire-format enums and units

It must not contain database access.

### `packages/api-client`

Contains a generated or thin typed HTTP client used by:

- The web application
- The agent worker
- Integration tests

Using this client from the agent reinforces the API boundary.

### `packages/domain`

Contains pure domain concepts and calculations:

- Workout tree validation
- Unit conversion
- Derived metric calculations
- Calibration resolution
- Plan validation rules

The API may consume it directly. The web and agent should generally rely on API contracts rather than importing server implementation details.

### `packages/config`

Contains typed environment parsing and shared non-secret configuration conventions. It must not embed deployment credentials.

### `packages/observability`

Contains shared logging, tracing, and metrics conventions when multiple services need them.

### `packages/ui`

Contains reusable frontend components only. It must not contain persistence or server business logic.

## Database ownership

Only `apps/api` can access the application database. Neither the web application nor agent worker receives database credentials.

The schema remains a repository-level concern because it supports the whole platform and has an independent migration lifecycle. PostgreSQL rows are mapped into domain and API objects by the core API.

## Infrastructure ownership

Infrastructure should remain in this repository initially:

```text
infra/
```

This allows application, schema, and infrastructure changes to be reviewed together. A separate infrastructure repository may become appropriate when:

- Multiple products share a platform.
- Production infrastructure requires separate access controls.
- A platform team owns deployments.
- Infrastructure and application releases have independent lifecycles.

## Terraform/OpenTofu and Atlas responsibilities

Infrastructure provisioning and database schema management must remain separate.

### Terraform or OpenTofu provisions

- Managed PostgreSQL instances
- Networks and security groups
- Container services
- Queues
- DNS
- Secrets infrastructure
- Object storage
- Monitoring resources

### Atlas manages

- Tables and columns
- Foreign keys and constraints
- Indexes
- Views
- PostgreSQL extensions
- Versioned schema migrations

Terraform/OpenTofu may provision the PostgreSQL server, logical database, and credentials, but it should not manage application tables.

In production, Atlas should run as a one-off deployment job before the new API release becomes active. The API should not automatically migrate production on every process startup. Development seeds must never run against production.

## Infrastructure timing

Railway is the selected target for the small hosted prototype, while Docker Compose remains the active local environment. The detailed rollout is recorded in the [Railway prototype deployment plan](./railway-deployment-plan.md).

Do not add Terraform/OpenTofu for the prototype. Revisit infrastructure as code when the deployment has stabilised or when a more operationally involved provider is selected.

The managed application platform shape is the selected prototype approach; the AWS shape remains a possible later alternative.

### Managed application platform

```text
Web:       Railway container
API:       Railway private container service
Agent:     Future Railway private worker
Database:  Railway managed PostgreSQL
Queue:     Deferred until agent requirements justify one
```

### AWS

```text
Web/API:   ECS/Fargate, with web optionally on Vercel
Agent:     ECS worker
Database:  RDS PostgreSQL
Queue:     SQS
Secrets:   Secrets Manager
Storage:   S3
IaC:       Terraform or OpenTofu
```

The provider should be selected based on cost, operational appetite, scaling requirements, and agent execution constraints rather than abstract portability.

## Architectural rules

1. PostgreSQL is the sole source of truth for plan state.
2. Only the core API accesses PostgreSQL.
3. The web application calls the core API.
4. The agent worker calls the same core API with service credentials.
5. A BFF may adapt data for presentation but cannot own domain logic.
6. Agent orchestration and plan operations are separate concerns.
7. Atlas owns schema changes; Terraform/OpenTofu owns infrastructure.
8. Development seeds do not run in production.
9. Services are independently deployable even while living in one monorepo.
10. New directories and infrastructure are introduced only when they have an implementation to contain.
