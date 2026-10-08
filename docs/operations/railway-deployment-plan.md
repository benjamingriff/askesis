# Railway deployment and release checks

Repository configuration verified 2026-10-06. This is the supported deployment procedure, not fresh evidence of Railway service state. Past deployment outcomes are retained in [handoff history](../archive/handoff-history.md); verify live variables, domains, replicas and migration status before a release.

## Topology

Use PostgreSQL, a private Hono API, a private coaching worker and a public nginx web service. Only web needs a public domain. Browser calls use same-origin `/api/*`; nginx rejects `/internal/*`. Machine authentication remains mandatory even on a private network. Only API/operator migration jobs receive database credentials; only worker receives the provider key.

Build from the repository root using `apps/api/Dockerfile`, `apps/web/Dockerfile` and `apps/agent/Dockerfile`. Runtime images use Node 24 for API/worker and nginx for web. There is no committed Railway service manifest; service variables, pre-deploy commands, replicas and domains must be configured/verified in Railway. Do not run historical local seed/reset/publication jobs on Railway. The image startup wrapper separately ensures the [account-owned multisport example](./example-plan.md) for the configured owner after migrations.

## API service

Required variables:

```text
NODE_ENV=production
DATABASE_URL=<private PostgreSQL reference>
CLERK_SECRET_KEY=<secret>
CLERK_PUBLISHABLE_KEY=<same Clerk instance as browser>
CLERK_AUTHORIZED_PARTIES=<comma-separated browser origins>
CHAT_EXECUTION_MODE=agent
AGENT_BOOTSTRAP_TOKEN=<shared API/worker secret, 32–200 characters>
```

`PORT` is provided by Railway; the server listens on `::`. Optional settings include `LOG_LEVEL`, `SENTRY_DSN` and `SENTRY_RELEASE`. Set explicit authorized origins: the API parser accepts an omitted/empty list and does not enforce a production allowlist at startup. `test` execution is forbidden in production; `unavailable` supports history/management without fresh coaching.

The API image contains Atlas/migrations but its startup command does not apply migrations. Configure a pre-deploy job. The recorded Railway command was:

```sh
sh -c 'atlas migrate apply --dir file:///app/database/migrations --url "${DATABASE_URL}?sslmode=disable"'
```

That command assumes a base URL without query parameters and the earlier private connection's disabled-TLS configuration. Verify current connection settings; use `&` rather than another `?` if adding a parameter to a URL with a query. The explicit shell expands the environment variable. Repository `atlas.hcl` defines only the `local` environment, so there is no `--env railway` target.

The image start command publishes the configured example before opening the API listener; leave the service start-command override empty. Set `EXAMPLE_PLAN_ENABLED=false` to disable it. Check `/api/ready` for the athlete-performance checkpoint `20261007120000`; `/api/health` is process-only. Migrations are append-only. Backup/rehearse difficult changes before rollout. Do not roll back by dropping durable run/live/version tables.

Public Swagger/OpenAPI paths are always registered in the current application. There is no configuration switch that disables them. A private API behind nginx avoids a separate public API entry point.

## Web service

Build-time public configuration:

```text
VITE_CLERK_PUBLISHABLE_KEY
VITE_SENTRY_DSN             # optional
SENTRY_RELEASE             # mapped to VITE_SENTRY_RELEASE
```

Optional source-map upload build credentials are `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`; all upload settings plus release must be present to enable it. No Clerk secret/provider key belongs in the browser build.

Runtime `API_UPSTREAM` must point to the API's private hostname and actual listening port. It must include an HTTP scheme. `DNS_RESOLVER` must suit the private network: Docker defaults to `127.0.0.11`; the earlier Railway checkpoint used `[fd12::10]`. Reconfirm that network value rather than treating a recorded value as a permanent vendor contract. nginx listens on its configured container port; set the Railway target port consistently.

`/api/` proxying disables buffering/cache with a 75-second read timeout. The API sends 15-second idle heartbeats and renews authenticated SSE connections at 45 seconds. `/internal/` returns 404. SPA routes fall back to `index.html`.

## Agent worker deployment

Use a private service, no public domain/port. Initial operation uses one replica; one execution slot is implemented per process. Configure:

```text
AGENT_API_URL=<private API origin>
AGENT_BOOTSTRAP_TOKEN=<reference to shared API secret>
OPENAI_API_KEY=<worker-only provider secret>
AGENT_PROVIDER=openai
AGENT_MODEL=gpt-6.1-sol
AGENT_REASONING=medium
```

Optional bounds are `AGENT_MAX_TURNS`, `AGENT_MAX_OUTPUT_TOKENS` and `AGENT_POLL_MS`; see [worker operations](./phase-5-runtime.md). Do not assign `DATABASE_URL` or `CLERK_SECRET_KEY`. Allow at least 40 seconds for graceful shutdown. Ready status is persisted through API registration; confirm it through signed-in chat capabilities, not a public worker health endpoint.

A deployment checkpoint recorded this service on 2026-10-04. That record does not verify its current health, environment or replica count.

## Rollout and validation

1. Complete local checks and back up/rehearse migrations as appropriate.
2. Deploy schema/API first, then worker, then web. New workers require the progress endpoint added in the latest migration/API; older workers can finish without streamed output.
3. Confirm readiness and compatible worker registration without printing credentials.
4. Sign in through the public web origin and verify owner-isolated plans/chats, generation, review/lock, Stop and reload recovery.
5. Verify SSE through the hosted proxy: committed edits before final completion, reconnect, a second session's edits, historical selection and sign-out/account cache reset.
6. Record actual deployment SHA, commands/results and hosted walkthrough evidence.

The recorded workflow auto-deploys `main`; verify the active Railway source configuration before pushing a release. Documentation validation does not itself authorize deployment.

## Friends-and-family readiness

Repository code has owner checks and bounded execution, but no invitation-enforcement middleware, application rate limits, per-user model-spend ceiling or account-data removal command. Clerk registration restrictions, production keys, self-deletion policy, Railway automated backups/retention and secret rotation are hosted/operator checks that this audit cannot certify.

Use [Phase 8](../product/v1-poc-development-plan.md#phase-8-friends-and-family-release) for unfinished release work. [Backup/restore](./database-backup-and-restore.md) provides manual fallback; [observability](./observability.md) describes implemented reporting. Root documentation uses the responsive web app as the intended alpha surface; native integration is deferred.
