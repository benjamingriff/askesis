# 7. Understand deployment and validation

[Day checklist](./README.md) · Previous: [Coach](./06-agent.md) · Next: [Capstone](./08-capstone.md)

**50 minutes:** 15 runtime/build, 15 hosted inspection, 10 checks/recovery, 10 checkpoint. This chapter is inspection and explanation; it does not deploy anything.

## What runs where · 15 minutes

Read [compose.yaml](../../compose.yaml), the three [API](../../apps/api/Dockerfile), [worker](../../apps/agent/Dockerfile) and [web](../../apps/web/Dockerfile) Dockerfiles, and [Railway operations](../operations/railway-deployment-plan.md#topology). Focus on build output, command and environment boundaries.

| Piece            | Local worktree                              | Supported Railway topology                                           |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| PostgreSQL       | Worktree-specific Compose database/volume   | Hosted PostgreSQL service                                            |
| Schema migration | Atlas Compose one-shot job in setup         | API pre-deploy job configured in Railway                             |
| API              | `pnpm dev:local` starts API via `tsx watch` | Node 24 image; private service, production startup wrapper           |
| Worker           | Separate optional process/profile           | Private Node service; no public listener; one execution slot/process |
| Web              | Vite dev server with API proxy              | Built static assets served by nginx; public origin                   |
| Examples         | Deliberate local account-owned seed         | Optional API startup publication controlled by service variables     |
| Marketing        | Separate Astro development/build            | Separate static site; inspect hosting separately if configured       |

The web is a client-rendered SPA, not a server-rendered app. nginx serves `index.html` for page routes and proxies `/api/` to Hono. `/internal/` returns 404 at that public proxy; machine credentials are still enforced by the API. [nginx.conf](../../apps/web/nginx.conf) disables proxy buffering/cache for live delivery and resolves the configured API upstream.

### Build-time versus runtime settings

Web's `VITE_*` values are baked into browser JavaScript at build time. Changing a Railway runtime variable alone does not rewrite an already built bundle. Its Clerk publishable key is public configuration; Clerk secret keys, provider credentials and Sentry upload credentials do not belong in `VITE_*` values.

API/worker read and validate their runtime environment in [API config](../../apps/api/src/config.ts) and [worker config](../../apps/agent/src/config.ts). The API receives PostgreSQL/Clerk credentials and the shared bootstrap token. The worker receives API origin/bootstrap token/provider credentials and model settings. nginx receives `API_UPSTREAM`/resolver configuration. Root `.env` is ignored local configuration, not proof of hosted variable values.

Production API starts `dist/operations/start.js`: optional example publication runs before the listener. That wrapper **does not apply migrations**. Atlas and migrations are in the image, but Railway must configure a pre-deploy command separately. Apply the entire migration sequence; deployed migrations are append-only. Older destructive pre-alpha cutovers are historical transformations, not reset instructions for current hosted data.

## Exercise: inspect a release without changing it · 15 minutes

In Railway, if you have access:

- [ ] Identify the project and environment, PostgreSQL, API, worker and web services. Record names, not secrets.
- [ ] For each deployed application, note its Git source/branch, Dockerfile, deployed commit and replica count. Check rather than assuming automatic deployment from `main` is currently enabled.
- [ ] Check API's migration pre-deploy command and start-command override. Compare them to the [API service procedure](../operations/railway-deployment-plan.md#api-service); verify actual connection/TLS requirements instead of blindly copying its recorded command.
- [ ] Check web's public domain and private API upstream/port; check worker has no public domain and uses the intended private API origin.
- [ ] Inspect **variable names/references**, without copying values. Identify which service has database, Clerk and provider credentials and which settings need a rebuild.
- [ ] Inspect recent migration/startup logs, including optional example publication status. Find a deployment SHA to correlate with the repository.
- [ ] Check the public origin's `/api/ready` and, while signed in, chat capabilities. Do not expose the API publicly to make the inspection easier.

There is **no committed Railway service manifest**. Dockerfiles and the operations guide describe intended deployment; the dashboard owns actual variable references, domains, source settings, pre-deploy commands and replicas. Code inspection alone cannot certify hosted state. If Railway is unavailable, draw the intended topology from source and mark these hosted observations pending.

Examples default off. Hosted publication requires both `EXAMPLE_PLAN_ENABLED=true` and an explicit verified `EXAMPLE_PLAN_EMAIL` on the intended API. Startup uses real transactions, locks and the normal validator; it preserves modified examples and retains immutable history. Read the [example publication guide](../operations/example-plan.md) rather than using historical local seed/reset scripts on Railway.

## Validation and recovery · 10 minutes

Read [.github/workflows/ci.yml](../../.github/workflows/ci.yml) and [root package scripts](../../package.json). Match each check to a claim it can establish:

| Check                            | What it tells you                                                          |
| -------------------------------- | -------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint` | Formatting and static code rules                                           |
| `pnpm typecheck`                 | Static TypeScript compatibility                                            |
| `pnpm test`                      | Unit/component/worker behavior in each workspace's test suite              |
| `pnpm build`                     | API/worker compilation and browser/static site build                       |
| `pnpm generate:check`            | Public OpenAPI/client outputs match route/schema generation                |
| `pnpm migrations:check`          | Atlas migration checksums match files                                      |
| `pnpm audit:production`          | Production dependency advisory gate at high severity                       |
| `pnpm test:db`                   | Domain services and SQL invariants on disposable PostgreSQL                |
| Upgrade rehearsals               | Populated migration/cutover preservation scenarios                         |
| `pnpm smoke`                     | Disposable stack and real SDK with a scripted model; no live provider call |
| Browser walkthrough              | Actual rendered/authenticated interactions and reload behavior             |
| Live-provider smoke/walkthrough  | Configured provider integration and coaching behavior                      |

`pnpm check` combines the first seven categories. It does not include all Docker/DB checks; CI has a separate `database-and-smoke` job. Test commands require the local tools/config described in [local development](../operations/local-development.md#validation-commands). Running the entire suite is useful for implementation but not required to complete this reading day.

For debugging, read [observability](../operations/observability.md): browser errors can include safe messages/request IDs; API responses/logs carry `x-request-id`; run IDs connect worker events to durable execution. Pino is the API logger, and optional production Sentry reports API/web errors. Avoid dumping headers, `.env`, plan text or raw provider errors into logs.

- `/api/health` checks process liveness.
- `/api/ready` queries Atlas for checkpoint `20261007120000`. This checkpoint is older than the newest migrations: 200 is not proof every migration is applied or the provider works. Inspect Atlas history/pre-deploy logs for the full sequence.
- Authenticated `/api/v1/chat-capabilities` reports whether a compatible worker is ready. It is separate from database readiness.

If a deployment fails: establish which image/commit started, whether migrations ran, whether the API is ready, whether nginx reaches the API and whether worker registration is compatible. Read [backup/restore](../operations/database-backup-and-restore.md) for recovery; reverting application code does not automatically reverse schema/data changes. Actual automated backup retention is a hosted setting to inspect.

## Checkpoint · 10 minutes

Draw the production path browser → public nginx → private API → PostgreSQL, plus worker → API/model and Atlas → PostgreSQL. Annotate it with:

- The build-time public key and runtime secret boundaries.
- The migration job and API startup command.
- A deployed SHA you inspected, or “hosted state not inspected.”
- What readiness proves and what still needs checking.

Explain where you would investigate these symptoms: static page loads but workouts fail (**API/proxy/auth and request ID**); history works but new coaching is unavailable (**execution mode/worker registration**); a release boots without latest columns (**migration job/history**); a frontend key change has no effect (**build configuration/rebuild**).

Optional later: [release checklist](../product/v1-poc-development-plan.md#phase-8-friends-and-family-release), [backup/restore](../operations/database-backup-and-restore.md), [full-stack smoke script](../../scripts/smoke.sh).
