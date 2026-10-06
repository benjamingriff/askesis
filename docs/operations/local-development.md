# Local application development

Verified against package scripts, Compose and CI on 2026-10-06. Use Node 24, Docker with Compose, and pinned pnpm:

```bash
npm install --global pnpm@11.18.0
pnpm install --frozen-lockfile
cp .env.example .env
```

Configure real Clerk development keys in the ignored `.env`. Placeholder keys cannot authenticate a browser. Keep secret/provider keys out of `VITE_*` variables. Root pnpm workspaces use `pnpm-lock.yaml`; the separate Expo reference app uses npm and its own lockfile.

## Run the complete stack with Docker

```bash
docker compose up --build -d
```

Default order is PostgreSQL → Atlas migrations → synthetic draft seed → development fixture publisher → API → nginx web. Migration, seed and publication are successful one-shot jobs, not persistent servers. Publication confirms, locks and activates the fixture through domain services.

- Web: <http://localhost:8080>
- API liveness/readiness: <http://localhost:3000/api/health>, <http://localhost:3000/api/ready>
- Swagger/OpenAPI: <http://localhost:3000/api/docs>, <http://localhost:3000/api/openapi.json>

Browser `/api/*` calls are proxied by nginx. Public domain endpoints require a Clerk session; workout lists additionally require `planVersionId`. The synthetic fixture belongs to its fixed synthetic athlete, so a newly signed-in account does not automatically see it. Normal account provisioning creates a separate internal owner.

```bash
docker compose ps -a
docker compose logs -f api web
docker compose down
```

`down` retains database volumes. Ports are overridden by `POSTGRES_PORT`, `API_PORT` and `WEB_PORT`; keep local database URLs and allowed browser origins consistent with overrides.

For real coaching, configure agent mode/token/provider key and use the `agent` profile as described in [worker operations](./phase-5-runtime.md). Without it, execution defaults to unavailable while conversation management/history remain available. The default API Docker runtime is production and rejects simulated test execution.

## Run the application processes locally

```bash
docker compose up -d postgres migrate seed
```

In separate terminals:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

The API dev script reads root `.env`. Vite runs at <http://localhost:5173> and loads environment files from `apps/web`; place the public `VITE_CLERK_PUBLISHABLE_KEY` in ignored `apps/web/.env.local` or export it in the web process environment. Vite does not automatically load the root `.env`. Its API proxy defaults to <http://localhost:3000>; override `VITE_API_PROXY_TARGET` when changing API port.

If a published local fixture is needed, after migrations/seed run:

```bash
pnpm --filter @askesis/api fixture:publish
```

This reads root `.env` and requires development/test configuration. It refuses production and Railway environments. It does not map the synthetic owner to a Clerk user.

## Local simulated chat

For a provider-free development executor, set `CHAT_EXECUTION_MODE=test` on the local API (not its production Docker runtime). Normal test replies are labelled; `/test slow`, `/test fail` and `/test timeout` exercise Stop, failure and timeout. This executor never writes plan content or calls a provider. It remains a testing mode alongside the real worker, not the current coaching implementation.

## Validation commands

```bash
pnpm check
pnpm test:db
pnpm test:live:upgrade
pnpm smoke
```

`check` runs formatting, lint, typecheck, unit/component/worker tests, builds, generated-contract drift, Atlas checksum and `pnpm audit --prod --audit-level=high`. It is not all Docker/database testing. CI also runs the database suite, populated Phase 5→6 upgrade rehearsal and disposable SDK streaming smoke in a separate job.

Docker/database scripts use isolated disposable databases rather than normal development data. Set a distinct `COMPOSE_PROJECT_NAME` and `TEST_DATABASE_PORT` if another local test stack is running. Real-provider smoke is a separate, billed operation; see [worker verification](./phase-5-runtime.md#verification).

## Generated types

After schema changes, apply migrations and regenerate:

```bash
docker compose run --rm migrate
pnpm generate:db-types
```

Database codegen reads `DATABASE_URL` from the process environment, otherwise using the default local connection. It does not itself load root `.env`; export the intended local URL securely when defaults differ. OpenAPI generation does read root `.env` through its API script:

```bash
pnpm generate:openapi
```

Committed outputs are `apps/api/src/database/generated.ts`, `packages/api-client/openapi.json` and `packages/api-client/src/schema.ts`. Do not edit them manually. [Database setup](./database-setup.md) covers migrations and fixture reset.
