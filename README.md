# Askesis

Askesis is an early-stage platform for creating, storing, validating, and adapting structured training plans.

## Current vertical slice

Phases 1–7 are implemented, and Phase 7 is merged into `main`. Development continues on the responsive web app, drawing selected features from the mobile reference prototype; native integration is deferred. See the [current handoff](./docs/current-handoff.md) for priorities and the [Phase 7 closeout](./docs/archive/phase-7/phase-7-closeout.md) for verification evidence.

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

## Local development

For agent UI verification in a fresh worktree, use `pnpm dev:setup`, `pnpm dev:local`, then `pnpm dev:login` in another terminal. Setup provisions an isolated local database, prepares an empty dedicated Clerk development account and stops its temporary container. Ctrl+C on `dev:local` stops owned servers/containers while retaining data; agents capture evidence and stop before handing back. Manually run `pnpm example:seed --email askesis-verification+clerk_test@example.com` when sample data is useful; see the [browser verification workflow](./docs/operations/local-development.md#agent-browser-verification-in-a-worktree).

Start the main app in the foreground:

```bash
pnpm dev:setup
pnpm dev
```

Use the printed URL. Ctrl+C closes owned servers/containers and retains database data. `pnpm dev --help` lists commands and dependencies. `pnpm dev:doctor [app]` checks prerequisites and configuration; `pnpm dev:list` inventories worktrees and Docker resources without changing them. `pnpm dev:status` shows managed sessions; `pnpm dev:stop` stops them. Marketing and evals run independently with `pnpm dev:marketing` and `pnpm dev:evals`, without Docker or authentication setup. The [local development guide](./docs/operations/local-development.md#run-individual-apps) lists every app command.

## Run with Docker

Configure ignored `.env` with Clerk development keys as described in [local setup](./docs/operations/local-development.md), then build/start PostgreSQL, Atlas migrations, API and web. Real coaching additionally requires the [agent profile](./docs/operations/phase-5-runtime.md#local-setup):

```bash
docker compose up --build -d
```

Open:

- Web: <http://localhost:8080>
- API documentation: <http://localhost:3000/api/docs>
- API readiness: <http://localhost:3000/api/ready>
- Workout API: `/api/v1/workouts?planVersionId=<version-UUID>` (requires an owner Clerk session)

Inspect service state:

```bash
docker compose ps -a
```

Stop the stack without deleting database data:

```bash
docker compose down
```

Run the lightweight validation suite with `pnpm check`, PostgreSQL integration tests with `pnpm test:db`, and the disposable full-stack smoke test with `pnpm smoke`.

See [`docs/operations/local-development.md`](./docs/operations/local-development.md) for local development and type-generation commands.

## Architecture

- PostgreSQL is the source of truth.
- Atlas owns schema migrations.
- Kysely provides typed database queries.
- Hono exposes a REST/OpenAPI domain API.
- React Router owns navigation; TanStack Query owns browser server state and live refresh.
- Web uses the generated public API client; the worker uses a fetch/Zod client for internal routes into the same domain services.
- Only the API accesses PostgreSQL among application services; operator migration/backup/test jobs also connect.

See [`docs/README.md`](./docs/README.md) for architecture decisions, the data model, and the implementation roadmap.

For a guided introduction, follow [Understand Askesis in one day](./docs/learning/README.md): an eight-hour walkthrough with a checklist, code links and hands-on data/API exercises.

## Repository structure

```text
apps/
  api/          Hono API and Kysely repositories
  agent/        Private coaching worker using the OpenAI Agents SDK
  web/          React, Vite, and React Router
  marketing/    Static Astro marketing site
  mobile/       Separate Expo UI reference prototype
packages/
  api-client/   Generated OpenAPI types and client factory
database/
  migrations/   Atlas migrations
  seed/         Idempotent development seed
  fixtures/     Legacy source plan material
docs/
  product/      Roadmap, behavior contracts and interface guidance
  architecture/ Service boundaries, data model and schema contracts
  operations/   Development, deployment and recovery guides
  adr/          Numbered architecture decisions
  archive/      Completed delivery plans and validation records
```

## Existing fixtures

`database/fixtures/cardiff-half-2026/` contains artefacts from the original file-backed prototype, including the source `training-plan.md`. They are retained as reference material but are not the production storage model.
