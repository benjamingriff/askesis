# Local application development

Verified against package scripts, Compose and CI on 2026-10-06. Use Node 24, Docker with Compose, and pinned pnpm:

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
pnpm dev:local
```

`dev:setup` reads only the Clerk development keys from the main checkout's ignored `.env`, writes a private ignored worktree `.env`, and chooses worktree-specific API/web/database ports and a Compose project. It does not copy provider credentials. If the keys live elsewhere, use `pnpm dev:setup /absolute/path/to/.env`. Existing worktree configuration is retained; occupied initial ports fail with a diagnostic. Change the corresponding ports, URLs and authorized origins together when overriding them.

Setup starts PostgreSQL, applies migrations, seeds/publishes the sample plans (Cardiff half marathon, an Olympic triathlon and a Hyrox plan, with running, cycling and swimming calibration), and creates or reuses `askesis-verification+clerk_test@example.com` in the configured Clerk development instance. It links that account to the **local synthetic athlete**, so authenticated screens have sample data. It refuses production/Railway, live Clerk keys, remote/non-Askesis database URLs and conflicting identity mappings. Database URL query parameters are restricted to `sslmode`, preventing driver options from overriding the checked connection target. Re-running setup keeps data; an edited fixture is rejected by the existing publisher. Use a fresh worktree database for destructive lifecycle experiments.

`dev:local` starts the API and Vite together. Ctrl+C stops both process groups. The Vite URL printed on startup is the browser address; `LOCAL_WEB_URL` in `.env` records the same origin. Simulated chat is enabled for newly generated verification environments. This can validate conversation, streaming and failure UI; real coaching/plan edits still require the separately configured worker/provider.

For agent sessions that may terminate child processes when the turn ends, keep the servers in a persistent terminal or a background service. On this Linux machine, the following uses the worktree's generated Compose project name as its user service name. Run from the repository root, check for an existing service/listener first, and reuse it if it is healthy:

```bash
verification_unit="$(node --env-file=.env -p 'process.env.COMPOSE_PROJECT_NAME')"
systemctl --user is-active "$verification_unit"
```

If the service is inactive and this worktree's servers are stopped:

```bash
docker compose up -d postgres
systemd-run --user --collect \
  --unit="$verification_unit" \
  --working-directory="$PWD" \
  --setenv="PATH=$PATH" \
  "$(command -v pnpm)" dev:local
```

This is a transient user service, not automatic startup after a reboot. Following a reboot, start PostgreSQL and the service again; the database volume and `.env` are retained. To inspect or stop only this worktree's service:

```bash
journalctl --user -u "$verification_unit" -n 30 --no-pager
systemctl --user stop "$verification_unit"
```

Before browser verification and again before returning the result, check the configured endpoints. These commands print only the API readiness response, not environment secrets:

```bash
verification_web_url="$(node --env-file=.env -p 'process.env.LOCAL_WEB_URL')"
verification_api_port="$(node --env-file=.env -p 'process.env.PORT || 3000')"
curl --fail --silent --output /dev/null "$verification_web_url/"
curl --fail --silent --show-error "http://localhost:${verification_api_port}/api/ready"
```

Leave the servers running for the user to inspect unless asked to stop them. Return the actual browser URL and, if you started a background service, its stop command. If the endpoints fail, inspect the server/container status before attributing the problem to Clerk or browser tools.

In another terminal:

```bash
pnpm --silent dev:login
```

The final JSON contains `url`, `agentTaskId` and `webOrigin`. Open `url` in the browser being used for verification. Clerk establishes a real session and redirects to `/plan`; its maximum duration is 30 minutes. Generate another link when needed. Confirm the active account is `askesis-verification+clerk_test@example.com` before making changes; a shared browser can have an existing development session. If another account remains active, sign out in Settings and open a fresh login link. Treat the login URL as a credential: do not include it, handshake query strings or session tokens in screenshots, recordings, issue text or commits. Start recordings after the redirect settles on the clean local app URL.

The samples' workouts are dated **11–24 May 2026**; the triathlon and Hyrox plans cover every sport. Navigate to those weeks in the Plan view to inspect populated schedules and workout details; Today may be empty outside those dates. This workflow deliberately preserves the published fixture's immutable content.

For agents in T3 Code:

1. Call `preview_status`, then `preview_open` if needed.
2. Run `pnpm dev:login` and pass the JSON `url` to `preview_navigate` in the same tab. Wait for `/plan` and the sample plan to appear.
3. Inspect `preview_snapshot` and use its locators to click through the change. Confirm data loads through the real API and reload where relevant. Wait for content such as workout prescriptions to finish loading before the final capture.
4. Use `preview_snapshot` with `save: true` for screenshots. Use `preview_recording_start`/`preview_recording_stop` around the relevant interactions for video. Return the saved paths in the task response.

A hidden tab (`visible: false`) can still support automation and screenshots; that flag alone does not mean the browser is unavailable. If preview tools fail, first verify the local endpoints above, then call `preview_open` and retry navigation/inspection with the correct tab and configured URL. Opening the thread's Preview panel may help if automation still fails. Browser-tool failures are separate from application/authentication failures; do not claim browser validation until the page and interactions have actually been inspected. A normal browser on the same machine can also open the generated login URL.

Stop only this worktree's database with `docker compose stop postgres`. Its volume is retained. Configuration diagnostics are available with `pnpm --filter @askesis/api verification:check`.

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

Both dev scripts read root `.env`; Vite also loads its normal environment files from `apps/web`. Root/shell values take precedence over app environment files. Only `VITE_*` variables are exposed to client code. Vite defaults to <http://localhost:5173>, or `WEB_PORT` when configured, and refuses to silently move to another port. Its API proxy defaults to <http://localhost:3000>; override `VITE_API_PROXY_TARGET` when changing API port. The API's host process uses `PORT` (Compose uses `API_PORT` for the published port).

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
pnpm test:performance:upgrade
pnpm test:multisport:upgrade
pnpm smoke
```

`check` runs formatting, lint, typecheck, unit/component/worker tests, builds, generated-contract drift, Atlas checksum and `pnpm audit --prod --audit-level=high`. It is not all Docker/database testing. CI also runs the database suite, populated Phase 5→6 upgrade rehearsal, populated athlete-performance cutover rehearsal, populated multi-sport brief migration rehearsal and disposable SDK streaming smoke in a separate job.

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
