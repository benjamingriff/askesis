# ADR 0001: Initial application stack

- **Status:** Partially superseded (worker/client integration and browser data strategy)
- **Date:** 2026-07-22

**Later decisions:** [ADR 0003](./0003-coaching-worker.md) supersedes the Pi worker choice; [ADR 0004](./0004-live-synchronization.md) records TanStack Query and live event delivery beyond the initial loader/action strategy. The original rationale below is retained as the 2026-07-22 decision, not current runtime instructions. Current implementation uses a private `/internal/agent` namespace and hand-written fetch/Zod worker client; the generated public client is used by web. Thus the original shared-generated-client diagram and Pi integration statements below are superseded. The React/Vite, Hono/OpenAPI, Kysely/Atlas and API/database boundaries remain accepted.

## Context

Askesis needs an interactive web interface, a typed HTTP API, PostgreSQL access, and eventually a TypeScript Pi agent worker. The first implementation should remain understandable to someone learning React and TypeScript, preserve a public API boundary for the agent, and avoid introducing full-stack framework or client-cache complexity before it is needed.

The database schema is already managed independently through Atlas.

## Decision

Use the following initial stack:

```text
Frontend:          React
Build tooling:     Vite
Routing:           React Router
Frontend data:     React Router loaders and actions
API:               Hono running on Node.js
API contract:      OpenAPI
Database queries:  Kysely
Schema migrations: Atlas
Database:          PostgreSQL
```

The applications will remain logically separate inside the monorepo:

```text
apps/web       React and Vite
apps/api       Hono API
apps/agent     Future Pi SDK worker
```

Only the API may access PostgreSQL.

## Frontend

React Router will initially own navigation and route-oriented data flow:

- Loaders fetch data required by a route.
- Actions submit mutations.
- Routes revalidate after relevant mutations.
- Pending and error states use router primitives.

TanStack Query will not be introduced initially. It may be added later if the interface develops substantial requirements for cross-route caching, polling, background refresh, optimistic updates, or complex cache invalidation.

The frontend will consume a generated OpenAPI client rather than database or server-internal types.

## API

Hono will run as a conventional Node.js service. Edge deployment is not an initial requirement.

The API will:

- Expose versioned REST endpoints.
- Validate requests and responses with runtime schemas.
- Generate an OpenAPI document.
- Keep route handlers thin.
- Delegate business rules and transactions to application services.
- Be the only application with database credentials.

The web application, future Pi worker, and other clients will use the same HTTP contract. There will not be a separate agent-only plan API.

## Database access and types

Atlas remains the sole owner of schema migrations, including tables, constraints, indexes, views, and PostgreSQL extensions.

Kysely will provide typed SQL queries without owning migrations. `kysely-codegen` will generate database row types by introspecting a database after Atlas migrations have been applied:

```text
Atlas migrations
      ↓
PostgreSQL schema
      ↓
kysely-codegen
      ↓
Generated Kysely database types
```

Generated database types are backend-only and are distinct from domain and API contract types.

## API types

OpenAPI is the language-neutral service contract:

```text
Runtime route schemas
        ↓
OpenAPI document
        ↓
Generated TypeScript client
        ├── Web application
        └── Pi agent worker
```

The project will not initially use tRPC. A public OpenAPI contract better supports the independent agent worker, interactive Pi integrations, potential non-TypeScript clients, and a possible future Go service.

## Agent implications

The future agent worker will use Pi's TypeScript SDK and generated Askesis API client. Pi custom tools will wrap domain endpoints such as reading plan context, replacing workouts, updating calibration, and validating a plan.

A Pi skill may describe the coaching workflow, but skills will not replace typed tools, API authorization, or server-side validation. The agent will not receive database credentials or generic coding tools in production.

## Deployment implications

The web and API remain independently buildable but do not have to be independently deployed. Early deployment options include:

1. Static Vite assets and a separate Hono container.
2. A single Hono container serving both `/api/*` and the built Vite assets.
3. Separate services behind one domain and reverse proxy.

This decision does not depend on Vercel or another specific provider.

## Consequences

### Positive

- Uses straightforward React and browser concepts.
- Avoids React Server Components and full-stack framework conventions initially.
- Keeps the agent-facing API explicit.
- Preserves PostgreSQL and SQL as first-class technologies.
- Retains language independence at the migration and API boundaries.
- Allows frontend caching infrastructure to be added only when justified.
- Supports simple container-based deployment.

### Trade-offs

- The web and API have separate development processes.
- Authentication and HTTP errors must be designed explicitly.
- Router loaders provide less sophisticated caching than TanStack Query.
- Hono requires project conventions for logging, errors, dependency wiring, and shutdown.
- Database, domain, API, and Pi tool types remain intentionally separate layers.

## Revisit when

Reconsider parts of this decision if:

- Public pages require server-side rendering or SEO.
- Route loaders become inadequate for remote-state caching or live agent updates.
- The API requires capabilities better served by a more opinionated Node framework.
- Edge deployment becomes a concrete requirement.
- A Go API rewrite becomes desirable.

Any replacement should preserve the core boundaries: Atlas-managed PostgreSQL, one authoritative domain API, and agent access through that API.
