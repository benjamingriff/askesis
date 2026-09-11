# Local application development

## Package manager

Askesis pins pnpm 11.18.0 in `package.json`. Install that version before working with the repository:

```bash
npm install --global pnpm@11.18.0
pnpm install --frozen-lockfile
```

Do not generate or commit an npm `package-lock.json`.

## Run the complete stack with Docker

```bash
docker compose up --build -d
```

Compose starts services in dependency order:

```text
PostgreSQL
    ↓
Atlas migration job
    ↓
Development seed job
    ↓
Hono API
    ↓
Vite production build served by nginx
```

Open:

- Web application: <http://localhost:8080>
- API health: <http://localhost:3000/api/health>
- Swagger UI: <http://localhost:3000/api/docs>
- OpenAPI document: <http://localhost:3000/api/openapi.json>
- Workout list API: <http://localhost:3000/api/v1/workouts>
- Example workout API: <http://localhost:3000/api/v1/workouts/10000000-0000-0000-0000-000000000103>

The workout endpoints require a Clerk session token and return `401` when opened directly without one. Use the authenticated web application to exercise them normally.

The web nginx container proxies `/api/*` to the API, so browser requests remain same-origin.

Inspect the stack:

```bash
docker compose ps -a
docker compose logs -f api web
```

Stop it while retaining the database volume:

```bash
docker compose down
```

## Run the application processes locally

Keep PostgreSQL running through Compose:

```bash
docker compose up -d postgres migrate seed
```

Install dependencies and start the API and web development servers in separate terminals:

```bash
pnpm install
pnpm dev:api
```

```bash
pnpm dev:web
```

The Vite server runs at <http://localhost:5173> and proxies `/api/*` to <http://localhost:3000>.

## Validation commands

### Phase 4 chat test executor

Real coaching arrives in Phase 5. For the Phase 4 local walkthrough, run these in separate terminals after applying migrations:

```bash
PORT=3002 CHAT_EXECUTION_MODE=test CLERK_AUTHORIZED_PARTIES=http://localhost:5175 pnpm dev:api
```

```bash
VITE_API_PROXY_TARGET=http://localhost:3002 pnpm --filter @askesis/web exec vite --port 5175 --strictPort
```

Open <http://localhost:5175/chat> and sign in with your Clerk development account. Ordinary messages receive a clearly labelled test reply after about three seconds. Use `/test slow` for a 15-second response you can stop, `/test fail` for a deliberate failure, and `/test timeout` for a 30-second timeout. Reload to verify persistence; open a plan's **Chat about this plan** action to test associated conversations. Archive and restore a conversation from its controls or the chat archive.

The test executor makes no provider calls or plan changes. It runs only when explicitly enabled and configuration rejects it in production. The normal Docker/production path keeps execution unavailable while retaining conversation management and history. Restarting the development API checks queued/nonterminal runs again; work past its 30-second deadline fails rather than spinning indefinitely.

### Repository checks

Run the lightweight CI-equivalent checks:

```bash
pnpm check
```

Individual checks are also available:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run PostgreSQL-backed integration tests against an isolated disposable database:

```bash
pnpm test:db
```

Run the complete disposable container smoke test:

```bash
pnpm smoke
```

Neither command touches the normal development database. PostgreSQL-backed and full-stack smoke tests are intentionally local-only during Phase 1.

## Generated types

After an Atlas migration changes the database schema, apply it locally and regenerate Kysely types:

```bash
docker compose run --rm migrate
pnpm generate:db-types
```

After an API route schema changes, regenerate the OpenAPI document and client types:

```bash
pnpm generate:openapi
```

Generated outputs:

```text
apps/api/src/database/generated.ts
packages/api-client/openapi.json
packages/api-client/src/schema.ts
```

These files are committed but never manually edited.
