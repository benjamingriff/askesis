# Railway prototype deployment plan

## Status

**Deployed and validated.** The Phase 1 production environment runs on Railway with a public web service, private API, and private PostgreSQL. Local Docker Compose remains the development environment.

This plan describes the first hosted Askesis prototype for a small invited group. It deliberately favours ease of operation over provider-independent infrastructure or production-scale complexity.

## Objectives

The prototype deployment should:

- Use Railway as the application platform.
- Keep PostgreSQL as the sole source of truth.
- Keep database credentials in the API service only.
- Run Atlas migrations before an API release becomes active.
- Use Clerk for human authentication.
- Keep the browser, API, and future agent on explicit service boundaries.
- Avoid deploying development seed data.
- Support a future agent worker without redesigning the application boundary.

The initial deployment does not need multi-region operation, autoscaling policy, Terraform/OpenTofu, a dedicated queue, or a staging environment.

## Service topology

Use one Railway project with services on the same private network:

```text
Internet
   │
   ▼
Web service (public)
React assets + nginx
   │  /api/* over Railway private networking
   ▼
API service (private)
Hono + Kysely + Clerk verification
   │
   ▼
Railway PostgreSQL (private)

Future:
Agent worker (private) ── generated OpenAPI client ──► API service
```

### Web service

The web service is the only public application service. It:

- Serves the built React application through nginx.
- Handles SPA fallback routing.
- Proxies `/api/*` to the API over Railway's private network.
- Contains only Clerk's publishable key; it never receives Clerk's secret key.

### API service

The API service:

- Exposes Hono on Railway's assigned `PORT`.
- Is reachable from the web and future agent through private networking.
- Verifies Clerk session tokens.
- Lazily maps Clerk users to Askesis athletes.
- Is the only application service with `DATABASE_URL`.
- Exposes `/api/health` for liveness and `/api/ready` for Railway readiness checks.

The API does not need a public Railway domain when all browser traffic passes through the web proxy. Swagger remains reachable through the web service at `/api/docs` unless it is explicitly disabled.

### PostgreSQL

Use Railway's managed PostgreSQL service in the same project and region as the API. Do not expose its public connection string to the browser, web container, or agent worker.

### Migration step

Atlas remains independent from application startup. Before deployment, the API image or a dedicated migration image must contain:

- The Atlas binary.
- `database/atlas.hcl`.
- `database/migrations/`.

Configure an API pre-deploy command, or an equivalent one-shot Railway job, to run:

```bash
sh -c 'atlas migrate apply --dir file:///app/database/migrations --url "${DATABASE_URL}?sslmode=disable"'
```

The explicit shell is required because Railway does not expand `$DATABASE_URL` when it executes a custom command directly. Railway private PostgreSQL does not require TLS, so the migration URL disables SSL.

The API release must not start if migration verification or application fails. The normal API process must not run migrations itself.

Development seeds must not run in Railway. A newly authenticated production athlete should initially have no plans.

## Why services remain separate

Web, API, and agent are independently deployable even though they share a Railway project:

- nginx and the API have different runtime requirements.
- The API can deploy without rebuilding the public shell when appropriate.
- The future agent will perform long-running, failure-prone LLM work.
- Agent resource usage and deployments should not interrupt normal API requests.
- The agent must not receive database credentials.

Railway may schedule these services on different physical hosts. The architectural requirement is a shared private network, not a shared server or container.

## Repository build configuration

Both existing Dockerfiles require the repository root as their build context because they consume pnpm workspace packages.

### API service

```text
Build context:  repository root
Dockerfile:     apps/api/Dockerfile
Health path:    /api/ready
Visibility:     private
```

The API image includes Atlas and the migration directory so Railway can run the agreed pre-deploy command.

### Web service

```text
Build context:  repository root
Dockerfile:     apps/web/Dockerfile
Health path:    /
Visibility:     public
```

The nginx image renders its configuration from a template at startup and accepts the private API origin through `API_UPSTREAM`. Docker Compose defaults it to the local `api` service; Railway must provide a private service-reference value.

The intended Railway value is conceptually:

```text
API_UPSTREAM=http://<api-private-domain>:<api-port>
```

Use a Railway service-reference variable rather than copying a private hostname manually. Exact reference syntax should be confirmed against Railway's current UI when deployment begins.

## Environment variables

Secrets belong in Railway service variables and must never be committed.

### Web

| Variable                     | Purpose                                     | Secret |
| ---------------------------- | ------------------------------------------- | ------ |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk browser SDK                           | No     |
| `API_UPSTREAM`               | Railway private API origin used by nginx    | No     |
| `DNS_RESOLVER`               | Railway private DNS resolver (`[fd12::10]`) | No     |
| `VITE_SENTRY_DSN`            | Sentry browser event ingestion              | No     |
| `SENTRY_RELEASE`             | Deployed Git revision                       | No     |
| `SENTRY_AUTH_TOKEN`          | Build-only source-map upload credential     | Yes    |
| `SENTRY_ORG`                 | Sentry organization slug                    | No     |
| `SENTRY_PROJECT`             | Sentry web project slug                     | No     |

`VITE_CLERK_PUBLISHABLE_KEY` is currently embedded during the Vite Docker build. Confirm that Railway passes the variable as a Docker build argument. If that proves awkward, add a small runtime configuration file before deployment.

### API

| Variable                   | Purpose                                | Secret |
| -------------------------- | -------------------------------------- | ------ |
| `DATABASE_URL`             | Railway PostgreSQL connection          | Yes    |
| `CLERK_SECRET_KEY`         | Clerk backend SDK                      | Yes    |
| `CLERK_PUBLISHABLE_KEY`    | Clerk token verification configuration | No     |
| `CLERK_AUTHORIZED_PARTIES` | Allowed web origins for Clerk tokens   | No     |
| `NODE_ENV=production`      | Runtime mode                           | No     |
| `PORT`                     | Injected by Railway                    | No     |
| `SENTRY_DSN`               | Sentry API event ingestion             | Yes    |
| `SENTRY_RELEASE`           | Deployed Git revision                  | No     |

`CLERK_AUTHORIZED_PARTIES` should contain only the deployed Railway domain and eventual custom domain. Do not retain localhost entries in the Railway value.

### Future agent worker

| Variable                      | Purpose                           | Secret |
| ----------------------------- | --------------------------------- | ------ |
| `ASKESIS_API_URL`             | Private API origin                | No     |
| `ASKESIS_AGENT_SERVICE_TOKEN` | Machine authentication to the API | Yes    |
| LLM provider keys             | Model access                      | Yes    |

The agent must not receive `DATABASE_URL` or `CLERK_SECRET_KEY`.

## Clerk environments

Local development currently uses Clerk's development instance. Before inviting users to the hosted prototype:

1. Create or activate the Clerk production instance.
2. Configure the Railway web domain as an allowed origin and redirect destination.
3. Put the production publishable key in the web service.
4. Put the production secret and publishable keys in the API service.
5. Set `CLERK_AUTHORIZED_PARTIES` to the production web origins.
6. Decide whether sign-up is invitation-only or restricted through Clerk's allowlist features.
7. Verify sign-in, sign-up, account management, and sign-out on the deployed domain.

Clerk authentication does not grant plan access by itself. API repository queries continue to enforce plan ownership and `plan_memberships`.

Webhook synchronization is optional for the first deployment because lazy athlete provisioning is already implemented. When enabled, expose a signed Clerk webhook endpoint and configure its signing secret in the API service.

## Initial deployment sequence

### 1. Prepare the application

Before creating Railway services:

- Add Railway-compatible nginx upstream templating.
- Add Atlas to an API pre-deploy image or create a dedicated migration image.
- Ensure the API listens on `process.env.PORT`.
- Ensure no seed command is part of the deployment path.
- Add production environment validation with clear startup failures.
- Run local type checks, builds, and container smoke tests.

### 2. Create the Railway project

Create one project, initially with a single prototype environment. Select one region for all services.

### 3. Provision PostgreSQL

Add Railway PostgreSQL and make its private `DATABASE_URL` available only to the API and migration step.

Before the first migration, decide on the available Railway backup feature or establish a manual `pg_dump` procedure. Even a prototype should have a known restore path before real plan data is entered.

### 4. Configure the API service

Connect the Git repository, select `apps/api/Dockerfile`, and configure:

- Database reference variable.
- Clerk production variables.
- Production authorized parties.
- Atlas pre-deploy command.
- `/api/ready` health check.
- Private networking without a public domain.

Deploy the API and confirm migrations completed before continuing.

### 5. Configure the web service

Connect the same repository, select `apps/web/Dockerfile`, and configure:

- Clerk production publishable key.
- API private upstream reference.
- `/` health check.
- A Railway public domain.

After receiving the public domain, update Clerk's origins and redirects and then redeploy if required.

### 6. Smoke test

Verify through the public web origin:

1. `/api/health` returns `200` through nginx.
2. `/api/v1/workouts` returns `401` without a Clerk token.
3. Sign-up or sign-in succeeds.
4. The first authenticated request creates an athlete identity.
5. A new athlete sees an empty plan rather than another athlete's data.
6. Chat and Settings render correctly.
7. Account management and sign-out work.
8. `/api/docs` loads if intentionally enabled.

### 7. Invite prototype users

Only after authorization testing should friends be invited. New users receive empty athlete accounts until plan creation or membership workflows exist.

## Deployment triggers

Start with Railway's Git-based deployment integration. Configure service watch paths if supported to avoid unrelated rebuilds.

Conceptual web paths:

```text
apps/web/**
packages/api-client/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
```

Conceptual API paths:

```text
apps/api/**
database/migrations/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
```

A generated OpenAPI client change can affect both services and should be reviewed accordingly.

## Security checklist

Before sharing the prototype:

- [ ] Clerk production keys are used rather than development keys.
- [ ] Clerk secret keys exist only in the API service.
- [ ] PostgreSQL credentials exist only in the API and migration environment.
- [ ] The API has no unnecessary public domain.
- [ ] `CLERK_AUTHORIZED_PARTIES` contains only deployed origins.
- [ ] All `/api/v1/*` routes require authentication unless explicitly documented.
- [ ] Plan and workout queries enforce owner or membership access.
- [ ] Development seed jobs are absent.
- [ ] Railway variables contain no values committed to Git.
- [ ] Sign-up access is restricted appropriately for the prototype audience.
- [ ] Database backup and restore steps are understood.

## Observability and operations

For the prototype, Railway logs and health checks are sufficient. The API should continue logging startup, shutdown, authentication configuration failures, and unexpected exceptions without logging session tokens or secrets.

Before agent workflows are deployed, add:

- Structured request and run identifiers.
- Agent run status and duration.
- LLM provider errors and retry counts.
- Basic API latency and failure monitoring.
- A durable record of agent-run state in PostgreSQL through the API.

Do not introduce a queue until agent execution requirements justify one.

## Rollback strategy

Application rollback and database rollback are separate:

- Use Railway deployment rollback for web or API application regressions.
- Do not automatically run Atlas down migrations during rollback.
- Prefer backward-compatible, expand-and-contract schema changes.
- If a migration fails, prevent the new API release from becoming active.
- Take a database backup before destructive or difficult-to-reverse migrations.

The previously deployed API should remain compatible with newly added nullable tables or columns whenever practical.

## Future agent deployment

The future `apps/agent` service will be another private Railway service, not a process inside the API container. It will:

1. Claim an agent run through authenticated internal API endpoints.
2. Read plan context through the generated OpenAPI client.
3. Propose explicit domain operations.
4. Let the API validate and persist those operations.
5. Report progress and completion through the API.

A browser Clerk token should not be stored as the worker's long-lived credential. Use a dedicated machine credential, and let the API associate each run with the initiating athlete and permitted plan.

## Deferred decisions

The following are intentionally deferred until the prototype has real usage:

- Custom domain and DNS provider.
- Staging environment.
- Terraform or OpenTofu.
- Dedicated queue or Redis.
- Object storage.
- Autoscaling policy.
- Multi-region deployment.
- Full metrics and tracing platform.
- Production agent sandboxing.

Revisit the topology when agent workload, user count, availability requirements, or compliance needs materially exceed the prototype assumptions.
