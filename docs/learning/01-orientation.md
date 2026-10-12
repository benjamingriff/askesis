# 1. Get oriented and run the app

[Day checklist](./README.md) · Next: [TypeScript](./02-typescript.md)

**45 minutes:** 10 mapping, 25 setup/exploration, 10 checkpoint. Your output is a service map and a local app with sample data, or a recorded setup blocker plus a source-based map.

## Know which code is running

Askesis is a monorepo: several applications share a Git repository and some tooling. A directory under `apps/` is not necessarily a deployed service or part of the browser bundle.

| Location                                                     | Role                                    | Runtime / authority                                                           |
| ------------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------- |
| [`apps/web`](../../apps/web/README.md)                       | Responsive product UI                   | React in the browser; Vite development server; nginx serves production assets |
| [`apps/api`](../../apps/api/README.md)                       | Public API and private worker endpoints | Node/Hono; owns authorization, rules and database access                      |
| [`apps/agent`](../../apps/agent/src/server.ts)               | Coaching worker                         | Node; model calls and API tools; no database connection                       |
| [`packages/api-client`](../../packages/api-client/README.md) | Public HTTP client and types            | Imported by web; generated contract, not a running service                    |
| [`database`](../../database/README.md)                       | Migration history and fixtures          | Atlas/SQL; schema authority                                                   |
| [`apps/marketing`](../../apps/marketing/README.md)           | Marketing site                          | Static Astro site; no API/database dependency                                 |
| [`apps/mobile`](../../apps/mobile/README.md)                 | Expo reference prototype                | Separate npm installation, dummy data, deferred native integration            |

For a data engineer: PostgreSQL is the operational source of truth, the API is the authorized domain/projection layer, and the browser caches projections. The agent is another API consumer with scoped permissions. It is not an ETL job that writes tables directly.

## Read in this order · 10 minutes

- [ ] Skim the [root README](../../README.md), especially its vertical slice and repository structure.
- [ ] Open [workspace configuration](../../pnpm-workspace.yaml) and [root scripts](../../package.json). Notice the mobile exclusion and `pnpm --filter` package names.
- [ ] Open [service architecture](../architecture/repository-and-service-architecture.md), stopping before deployment details.
- [ ] Find web's `createRoot` in [main.tsx](../../apps/web/src/main.tsx), API's `serve` in [server.ts](../../apps/api/src/server.ts), and worker construction in [agent server](../../apps/agent/src/server.ts).

These are three entry points, not one TypeScript application. `pnpm build` recursively invokes each workspace's build script; it does not make one combined server.

## Exercise: get a local example · 25 minutes

Use Node 24, pnpm 11.18.0 and Docker with Compose. From your fresh worktree root:

```bash
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm example:seed --email askesis-verification+clerk_test@example.com
pnpm dev:local
```

The [local development procedure](../operations/local-development.md#agent-browser-verification-in-a-worktree) explains prerequisites and recovery. Setup imports only development Clerk keys from the main checkout's ignored `.env` (or an explicit source path), chooses separate ports and database resources, applies migrations and prepares the verification account. It starts with an empty database; seeding is a deliberate extra step.

Keep `dev:local` running in that terminal. In another terminal in the same worktree:

```bash
verification_web_url="$(node --env-file=.env -p 'process.env.LOCAL_WEB_URL')"
verification_api_port="$(node --env-file=.env -p 'process.env.PORT || 3000')"
curl --fail --silent --output /dev/null "$verification_web_url/"
curl --fail --silent --show-error "http://localhost:${verification_api_port}/api/ready"
pnpm --silent dev:login
```

Open the final JSON's login `url` in your browser. It is a credential: do not paste it into notes, commits or evidence. Wait for the clean `/plan` URL, then confirm Settings shows `askesis-verification+clerk_test@example.com`. Sign out and use a fresh login link if another account remains active. Login sessions last up to 30 minutes; repeat `dev:login` when necessary.

The three examples are cycling/strength, triathlon, and strength/HIIT. They each cover twelve weeks starting on the previous Monday in the athlete's timezone. Note the **actual selected plan dates**. The old Cardiff and multisport test fixtures have fixed historical dates and a separate synthetic owner; they are not these examples.

- [ ] Open Plan, Today, Coach, Performance and Settings. Identify one API-backed item on each relevant screen.
- [ ] Pick the triathlon example for the day's workout trace; record its visible name and dates.
- [ ] Open a workout and wait for its prescription to load. Do not change anything yet.
- [ ] Draw browser → proxy → API → PostgreSQL, with worker → API beside it.

Fresh verification configuration enables **simulated chat**. It exercises chat UI but does not call a model or edit plans. Real coaching requires a separate worker and provider setup; chapter 6 has a reading exercise that works without them.

If you hit the setup time limit, write down which stage failed. For a running app with no plans, check the active account and whether account-owned seeding ran. For connectivity, check web response, API readiness and this worktree's PostgreSQL before investigating Clerk. Continue with the [example blueprints](../../apps/api/src/examples/blueprint.ts) and code links if local authentication cannot be prepared; mark hands-on checkpoints incomplete.

## Checkpoint · 10 minutes

Explain without reading:

1. Which application reads/writes PostgreSQL? **The API; operator migration/seed/backup/test jobs also connect.**
2. Is `packages/api-client` a backend? **It is a client library and generated public types.**
3. Does a browser sign-in automatically expose the historical synthetic fixture? **No; authorization is tied to the provisioned internal athlete.**
4. Are marketing and mobile part of the live product data path? **Marketing is static; mobile is a separate reference prototype.**
5. Where do you change a route? **Web routing in `router.tsx`; HTTP endpoints in an API module's routes file.**

Write your actual local browser origin and the process start command in your notes. Ctrl+C stops the `dev:local` API/web process groups; `docker compose stop postgres` stops this worktree's database while retaining its volume. Keep the servers up for the remaining exercises.

Optional later: [background service lifetime](../operations/local-development.md#agent-browser-verification-in-a-worktree), [architecture decisions](../adr/README.md).
