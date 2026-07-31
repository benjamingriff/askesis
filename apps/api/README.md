# Core API

The Askesis API is a Hono application running on Node.js. It is the only application allowed to access PostgreSQL.

## Current vertical slice

```text
GET /api/health
GET /api/ready
GET /api/v1/workouts
GET /api/v1/workouts/:workoutId
GET /api/openapi.json
GET /api/docs
```

`GET /api/v1/workouts` uses Kysely to return seeded workouts in scheduled order. `GET /api/v1/workouts/:workoutId` assembles the relational steps into a nested prescription tree and resolves semantic zone targets against the calibration profile effective on the workout date. The routes' Zod schemas generate the OpenAPI contract consumed by `packages/api-client`.

## Development

From the repository root:

```bash
pnpm install
pnpm dev:api
```

The API listens on `http://localhost:3000`. Development reads the repository-root `.env` when present. Typed startup validation requires PostgreSQL and Clerk configuration; see `.env.example`. `/api/health` reports process liveness, while `/api/ready` verifies database connectivity and required migrations.

Regenerate database and API types after their respective sources change:

```bash
pnpm generate:db-types
pnpm generate:openapi
```

Generated files must not be edited manually.
