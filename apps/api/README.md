# Core API

The Askesis API is a Hono application running on Node.js. It is the only application allowed to access PostgreSQL.

## Current behavior

The API serves owner-authorized plan/version lifecycle, briefs/calibration, workout reads, conversations, durable runs and authenticated live notifications. Private `/internal/agent/*` routes use bootstrap/run credentials for worker claims, tools, output and completion, separate from Clerk human sessions.

Workout lists require `planVersionId` and return that owner's version content; they do not automatically return the development seed. Detail reads assemble a nested prescription and resolve symbolic zones against the version/date calibration. The seed has its own synthetic owner.

Public `/api/health` is process liveness; `/api/ready` checks the required Atlas checkpoint (`20261005120000`). `/api/docs` and `/api/openapi.json` expose the public contract; `packages/api-client` consumes it. The worker uses its own fetch/Zod internal client.

See [architecture](../../docs/architecture/README.md) and [exact public OpenAPI](../../packages/api-client/openapi.json).

## Development

From the repository root:

```bash
pnpm install
pnpm dev:api
```

The API listens on `http://localhost:3000`. Development reads the repository-root `.env` when present. Typed startup validation requires PostgreSQL and Clerk configuration; see `.env.example`. `/api/health` reports process liveness, while `/api/ready` queries the required migration checkpoint; missing checkpoint returns 503 and database query errors return 500.

Regenerate database and API types after their respective sources change. Database codegen needs the intended process-level `DATABASE_URL` and does not itself load root `.env`:

```bash
pnpm generate:db-types
pnpm generate:openapi
```

Generated files must not be edited manually.
