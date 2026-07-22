# Local application development

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
- Workout list: <http://localhost:3000/api/v1/workouts>
- Example workout breakdown: <http://localhost:3000/api/v1/workouts/10000000-0000-0000-0000-000000000103>

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
npm install
npm run dev:api
```

```bash
npm run dev:web
```

The Vite server runs at <http://localhost:5173> and proxies `/api/*` to <http://localhost:3000>.

## Validation commands

```bash
npm run typecheck
npm run build
```

## Generated types

After an Atlas migration changes the database schema, apply it locally and regenerate Kysely types:

```bash
docker compose run --rm migrate
npm run generate:db-types
```

After an API route schema changes, regenerate the OpenAPI document and client types:

```bash
npm run generate:openapi
```

Generated outputs:

```text
apps/api/src/database/generated.ts
packages/api-client/openapi.json
packages/api-client/src/schema.ts
```

These files are committed but never manually edited.
