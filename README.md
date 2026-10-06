# Askesis

Askesis is an early-stage platform for creating, storing, validating, and eventually adapting structured training plans.

## Current vertical slice

Phases 1–6 are complete. Phase 7 implementation and local validation are complete; see the [closeout](./docs/phase-7-closeout.md) for the verified account policy and remaining release checks. The next product increment connects the native client.

The application reads and changes authoritative training data through:

```text
React + React Router
        ↓ generated OpenAPI client
Hono API
        ↓ Kysely
PostgreSQL
```

The responsive web application provides active-plan schedules, a plan library, immutable versions, human-controlled lifecycle actions, persistent coaching conversations and Clerk-backed account settings. A private coaching worker creates and modifies drafts through authorized API tools. Assistant replies stream while saved plan changes appear in the review panel; interrupted output and committed edits survive reloads. Workout details show nested prescriptions, repeats, recoveries, targets and resolved training zones.

## Package management

The monorepo uses pnpm 11.18.0, pinned through `package.json`:

```bash
npm install --global pnpm@11.18.0
pnpm install --frozen-lockfile
```

## Run with Docker

Build and start PostgreSQL, Atlas migrations, the development seed, API, and web application:

```bash
docker compose up --build -d
```

Open:

- Web: <http://localhost:8080>
- API documentation: <http://localhost:3000/api/docs>
- API readiness: <http://localhost:3000/api/ready>
- Workout endpoint: <http://localhost:3000/api/v1/workouts> (requires a Clerk session token)

Inspect service state:

```bash
docker compose ps -a
```

Stop the stack without deleting database data:

```bash
docker compose down
```

Run the lightweight validation suite with `pnpm check`, PostgreSQL integration tests with `pnpm test:db`, and the disposable full-stack smoke test with `pnpm smoke`.

See [`docs/local-development.md`](./docs/local-development.md) for local development and type-generation commands.

## Architecture

- PostgreSQL is the source of truth.
- Atlas owns schema migrations.
- Kysely provides typed database queries.
- Hono exposes a REST/OpenAPI domain API.
- React Router owns navigation; TanStack Query owns browser server state and live refresh.
- The generated API client is shared with the web application and coaching worker.
- Only the API accesses PostgreSQL.

See [`docs/README.md`](./docs/README.md) for architecture decisions, the data model, and the implementation roadmap.

## Repository structure

```text
apps/
  api/          Hono API and Kysely repositories
  agent/        Private coaching worker using the OpenAI Agents SDK
  web/          React, Vite, and React Router
  mobile/       Separate Expo UI reference prototype
packages/
  api-client/   Generated OpenAPI types and client factory
database/
  migrations/   Atlas migrations
  seed/         Idempotent development seed
  fixtures/     Legacy source plan material
docs/
```

## Existing fixtures

`database/fixtures/cardiff-half-2026/` contains artefacts from the original file-backed prototype, including the source `training-plan.md`. They are retained as reference material but are not the production storage model.
