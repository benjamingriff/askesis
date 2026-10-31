# Local application development

The root commands use Node 24 and a shared foreground lifecycle. Use Node 24, Docker with Compose, and pinned pnpm:

```bash
npm install --global pnpm@11.18.0
pnpm install --frozen-lockfile
cp .env.example .env
```

Configure real Clerk development keys in the ignored `.env`. Placeholder keys cannot authenticate a browser. Keep secret/provider keys out of `VITE_*` variables. Root pnpm workspaces use `pnpm-lock.yaml`; the separate Expo reference app uses npm and its own lockfile.

## Agent browser verification in a worktree

Use a dedicated Clerk **development** account and real sessions for UI verification. The local operator commands use [Clerk Agent Tasks](https://clerk.com/docs/guides/development/testing/agent-tasks) to sign in without email, passwords or CAPTCHA interaction. Both browser route protection and API token/owner checks still run. Agent Tasks are currently a Clerk beta feature and require network access to Clerk.

In a fresh worktree, after `pnpm install --frozen-lockfile`:

```bash
pnpm dev:setup
pnpm dev
```

`dev:setup` reads only the Clerk development keys from the main checkout's ignored `.env`, writes a private ignored worktree `.env`, and chooses worktree-specific API/web/database ports and a Compose project. It does not copy provider credentials. If the keys live elsewhere, use `pnpm dev:setup /absolute/path/to/.env`. Existing worktree configuration is retained; occupied initial ports fail with a diagnostic. An existing `.env` without an explicit `COMPOSE_PROJECT_NAME` keeps the legacy `askesis` project and `askesis_postgres_data` volume, with Compose-compatible API/web/database port defaults. New setup files explicitly store an isolated project and ports; the same `.env` selects the same database for managed commands and direct Compose. Multiple legacy worktrees can share that project: inventory marks ambiguous ownership and automatic data deletion refuses it. Change the corresponding ports, URLs and authorized origins together when overriding them.

Setup temporarily starts PostgreSQL, applies migrations and creates or reuses
`askesis-verification+clerk_test@example.com` in the configured Clerk development
instance using normal athlete provisioning. Fresh databases start empty so onboarding
can be tested. Existing identities and data are preserved. Local verification still
refuses production/Railway, live Clerk keys and remote/non-Askesis database URLs.
Database URL query parameters are restricted to `sslmode`. Setup removes its own temporary PostgreSQL container and empty network on success, failure, or cancellation, retaining the named database volume. An already running database is reused and preserved. `example:seed` and database codegen also run with a temporary database when needed, so they work after setup has stopped.

When populated screens are needed, seed manually after setup:

```bash
pnpm example:seed --email askesis-verification+clerk_test@example.com
```

See [the example training plans](./example-plan.md) for their twelve-week content,
relative dates, calibration estimates and rerun/preservation rules.

`pnpm dev` (also available as `pnpm dev:local`) starts PostgreSQL when needed, applies migrations, starts the API and Vite, and checks API/web readiness. PostgreSQL runs as a labelled `docker compose run --rm` container. Ctrl+C stops both application process groups, gracefully stops the owned database container, and removes its empty network. Database data remains in its named volume. SIGTERM and application/startup failures use the same cleanup path. An already running database is reused without taking ownership; it is preserved on exit.

Run in a foreground terminal; do not start a background service for agent handoff. If the terminal is lost or the supervisor is forcibly killed, inspect or recover only this worktree's sessions:

```bash
pnpm dev --help          # command/dependency/stop matrix; needs no setup
pnpm dev:marketing --help
pnpm dev:doctor          # read-only versions, local Docker, config and port checks
pnpm dev:doctor marketing # Docker/auth-free app diagnostics
pnpm dev:list            # read-only inventory across registered Git worktrees
pnpm dev:list --json     # includes container port mappings and retained volumes
pnpm dev:status
pnpm dev:stop            # all managed sessions in this worktree
pnpm dev:stop local      # only the main preview
pnpm dev:clean           # stop/recover sessions and remove empty networks, retain data
pnpm dev:clean --data    # explicitly delete this worktree's generated development DB volume
```

Private ignored `.dev/` state records process identities and container ownership, allowing recovery without signalling a reused PID or stopping another worktree. Process-group guards stop app descendants even if a launcher exits, and IPC disconnect cleans app processes if the supervisor is killed. Database cleanup cannot run after SIGKILL or power loss; use `dev:stop` after those cases. Cancellation escalates stubborn commands after 45 seconds, including one-off commands. A cleanup failure is reported and leaves its recovery state available. No command performs global Docker pruning. `dev:clean` resolves and pins the worktree's configured local Docker socket before doing anything, and refuses remote hosts/contexts. `dev:list` maps containers, networks and retained volumes to registered worktrees, flags unregistered/missing paths and ambiguous ownership, and never deletes resources. It remains useful when Docker is unavailable. `dev:doctor` with an app argument checks only the relevant prerequisites; diagnostics never start services or print keys.

The Vite URL printed on startup is the browser address; `LOCAL_WEB_URL` in the generated `.env` records the same origin. Simulated chat is enabled for newly generated verification environments. This can validate conversation, streaming and failure UI; real coaching/plan edits require the separately configured worker/provider.

Before browser verification and capturing the result, check the configured endpoints. These commands print only the API readiness response, not environment secrets:

```bash
verification_web_url="$(node --env-file=.env -p 'process.env.LOCAL_WEB_URL')"
verification_api_port="$(node --env-file=.env -p 'process.env.PORT || 3000')"
curl --fail --silent --output /dev/null "$verification_web_url/"
curl --fail --silent --show-error "http://localhost:${verification_api_port}/api/ready"
```

Agents must save screenshot/video evidence, then stop every process/container they started before returning. Check `pnpm dev:status` after stopping and return the saved artifacts, actual browser URL and restart/stop commands (`pnpm dev`, then Ctrl+C, or `pnpm dev:stop local` from another terminal). Preserve any reused services owned by someone else. If the endpoints fail during verification, inspect server/container status before attributing the problem to Clerk or browser tools.

In another terminal:

```bash
pnpm --silent dev:login
```

The final JSON contains `url`, `agentTaskId` and `webOrigin`. Open `url` in the browser being used for verification. Clerk establishes a real session and redirects to `/plan`; its maximum duration is 30 minutes. Generate another link when needed. Confirm the active account is `askesis-verification+clerk_test@example.com` before making changes; a shared browser can have an existing development session. If another account remains active, sign out in Settings and open a fresh login link. Treat the login URL as a credential: do not include it, handshake query strings or session tokens in screenshots, recordings, issue text or commits. Start recordings after the redirect settles on the clean local app URL.

The manually seeded example starts on the previous Monday in the athlete's timezone
and runs for twelve complete weeks, including the current week. Historical Cardiff,
triathlon and Hyrox test fixtures, when explicitly loaded, remain dated 11–24 May 2026. Navigate to the dates of the plan actually selected.

For agents in T3 Code:

1. Call `preview_status`, then `preview_open` if needed.
2. Run `pnpm dev:login` and pass the JSON `url` to `preview_navigate` in the same tab. Wait for `/plan` and the sample plan to appear.
3. Inspect `preview_snapshot` and use its locators to click through the change. Confirm data loads through the real API and reload where relevant. Wait for content such as workout prescriptions to finish loading before the final capture.
4. Use `preview_snapshot` with `save: true` for screenshots. Use `preview_recording_start`/`preview_recording_stop` around the relevant interactions for video. Return the saved paths in the task response.

A hidden tab (`visible: false`) can still support automation and screenshots; that flag alone does not mean the browser is unavailable. If preview tools fail, first verify the local endpoints above, then call `preview_open` and retry navigation/inspection with the correct tab and configured URL. Opening the thread's Preview panel may help if automation still fails. Browser-tool failures are separate from application/authentication failures; do not claim browser validation until the page and interactions have actually been inspected. A normal browser on the same machine can also open the generated login URL.

Stop the managed preview with Ctrl+C or `pnpm dev:stop local`. Its database volume is retained. Configuration diagnostics are available with `pnpm --filter @askesis/api verification:check`.

## Run the complete stack with Docker

```bash
docker compose up --build -d
```

Default order is PostgreSQL → Atlas migrations → API → nginx web. Historical seed/publication jobs are optional in the `fixtures` profile. Migration, seed and publication are successful one-shot jobs, not persistent servers. Publication confirms, locks and activates the fixture through domain services.

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

## Run individual apps

Use root commands from any worktree. `pnpm dev` is the normal main-app entry point; each app can also be explored separately:

| Command                                   | Starts/requires                                         | Configuration                                                                              |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm dev:local`             | API + web + owned temporary PostgreSQL                  | Root `.env`; readiness checked                                                             |
| `pnpm dev:api`                            | API + owned temporary PostgreSQL                        | Root `.env`; migrations/readiness checked                                                  |
| `pnpm dev:web`                            | Web only; requires a running API for data               | Root `.env`; `WEB_PORT`, `VITE_API_PROXY_TARGET`                                           |
| `pnpm dev:marketing`                      | Static Astro site; no Docker/auth                       | Root `MARKETING_PORT`, `SITE_URL`, `APP_URL`, or shell overrides                           |
| `pnpm dev:evals`                          | Local benchmark-artifact viewer; no Docker/auth         | Root `EVALS_PORT`, `EVALS_RESULTS_DIR`, or shell overrides                                 |
| `pnpm dev:agent`                          | Worker; requires a running API and provider credentials | Separate `apps/agent/.env`; API URL derived from the worktree unless explicitly overridden |
| `pnpm dev:mobile` / `pnpm dev:mobile:web` | Separate Expo prototype; no backend                     | Delegates to npm; first run `npm ci --prefix apps/mobile`                                  |

Marketing explicitly disables Astro’s agent-triggered backgrounding with `--ignore-lock`; the root supervisor handles its session lock. All these commands stay in the foreground and stop their owned process groups on Ctrl+C or `pnpm dev:stop [app]`. App-level `pnpm --filter @askesis/<app> dev` commands remain available when manually coordinating processes. Mobile remains outside the pnpm workspace with its own npm lockfile.

Worktree defaults provide separate API/web/database/marketing/evals ports. Generated `.env` stores them; existing configuration is retained. Overrides in the shell take precedence. Browser servers refuse occupied configured ports instead of silently switching to a different URL. Marketing/evals can start in a fresh worktree without `dev:setup`; they receive only their relevant root variables. Worker startup does not copy root Clerk/database/provider credentials into its separate environment.

API and web dev scripts, and the web build, read root `.env`; Vite also loads normal app environment files. Root/shell values take precedence. Only `VITE_*` variables are exposed to client code. The API uses `PORT`; Docker publishes its API on `API_PORT`. Keep `WEB_PORT`, `LOCAL_WEB_URL`, `CLERK_AUTHORIZED_PARTIES`, `PORT` and `VITE_API_PROXY_TARGET` consistent when overriding generated settings.

To run a one-off command with this worktree's database and automatic cleanup:

```bash
pnpm dev:exec -- pnpm --filter @askesis/api verification:check
pnpm example:seed --email askesis-verification+clerk_test@example.com
```

Historical fixture jobs remain available through Compose's explicit `fixtures` profile, with `run --rm`. They belong to synthetic athletes; use `example:seed` for account-owned plans. If manually starting a detached Compose stack, its lifecycle belongs to you: use the matching `docker compose down` when finished.

## Marketing site

`apps/marketing` is a static Astro site with no API or database dependency:

```bash
pnpm dev:marketing
```

Use the printed worktree URL (`MARKETING_PORT` overrides it). Ctrl+C or `pnpm dev:stop marketing` closes it. See its [README](../../apps/marketing/README.md) for refreshing the product screenshots.

## Local simulated chat

`IN_APP_COACH=hidden` removes the in-app coach from the product; production for the MCP release sets `hidden`.

For a provider-free development executor, set `CHAT_EXECUTION_MODE=test` on the local API (not its production Docker runtime). Normal test replies are labelled; `/test slow`, `/test fail` and `/test timeout` exercise Stop, failure and timeout. This executor never writes plan content or calls a provider. It remains a testing mode alongside the real worker, not the current coaching implementation.

## Validation commands

```bash
pnpm check
pnpm test:db
pnpm test:db test/db/example.test.ts -t 'replaces only untouched managed editions' # optional focused rerun
pnpm test:live:upgrade
pnpm test:performance:upgrade
pnpm test:multisport:upgrade
pnpm smoke
```

`check` runs formatting, lint, typecheck, unit/component/worker tests, builds, generated-contract drift, Atlas checksum and `pnpm audit --prod --audit-level=high`. It is not all Docker/database testing. CI also runs the database suite, populated Phase 5→6 upgrade rehearsal, populated athlete-performance cutover rehearsal, populated multi-sport brief migration rehearsal and disposable SDK streaming smoke in a separate job.

The example-plan database regression keeps its existing timeout. A scoped PostgreSQL validation migration bounds recursive traversal to one workout and uses indexed completion/child/target probes, avoiding repeated whole-table existence scans during deferred commit checks as example editions accumulate. Deferred validation and malformed-tree rejection remain enabled.

Docker/database scripts use a unique project and automatically selected available ports for each invocation; root `.env` does not select their project. They remove their containers, networks and disposable data on success/failure/cancellation. Smoke also removes its uniquely generated app images, retaining shared PostgreSQL/Atlas images. Set `TEST_DATABASE_PORT` or `SMOKE_WEB_PORT` only when an explicit port is required. If Docker reports exhausted automatic address pools, inspect `pnpm dev:list` and the machine's LAN/VPN/Docker routes. An operator-selected free IPv4 subnet can be supplied as `DEV_NETWORK_SUBNET` for managed development or `TEST_NETWORK_SUBNET` for disposable test commands. No subnet is selected automatically; Docker rejects overlapping Docker pools. These overrides do not change global Docker settings or clean other worktrees. The free-port selection is advisory; a competing bind fails normally and triggers cleanup. Real-provider smoke is a separate, billed operation; see [worker verification](./phase-5-runtime.md#verification).

## Generated types

After schema changes, apply migrations and regenerate:

```bash
pnpm generate:db-types
```

The root database-codegen command reads root `.env`, starts/migrates a temporary worktree database if needed, and removes its owned container when complete. The app-level codegen command still accepts an explicitly exported `DATABASE_URL`. OpenAPI generation does read root `.env` through its API script:

```bash
pnpm generate:openapi
```

Committed outputs are `apps/api/src/database/generated.ts`, `packages/api-client/openapi.json` and `packages/api-client/src/schema.ts`. Do not edit them manually. [Database setup](./database-setup.md) covers migrations and fixture reset.

## Images and build cache

Ordinary `pnpm dev:*` runs build no application Docker images. Disposable smoke runs remove their own generated image tags; shared base images and reusable build cache remain. Inspect disk use with `docker system df`. For occasional machine-level cache maintenance, the owner can run `docker builder prune --filter until=168h --keep-storage 5GB`; this has its own confirmation and affects the machine's build cache. Agents must not run global prune commands or treat unattached database volumes as unwanted.
