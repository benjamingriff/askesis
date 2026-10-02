# Current agent handoff

**Updated:** 2026-10-01
**Current phase:** Phase 4 deployed to Railway; Phase 5 is built and deterministic verification passes locally; real-provider acceptance is pending. Broad UI refinement is deferred until after Phase 5.
**Completed phase:** Phase 1 — engineering foundation and Railway deployment validation

## Purpose

This document is the immediate handoff for the next coding agent. The long-term product and engineering plan remains in [`v1-poc-development-plan.md`](./v1-poc-development-plan.md).

Before making changes, read:

1. [`v1-poc-development-plan.md`](./v1-poc-development-plan.md)
2. [`railway-deployment-plan.md`](./railway-deployment-plan.md)
3. [`observability.md`](./observability.md)
4. [`repository-and-service-architecture.md`](./repository-and-service-architecture.md)

Do not place credentials, Clerk tokens, database URLs, Sentry credentials, or Railway secrets in chat, logs, commits, or this file.

## Repository state at handoff

### Phase 5 implementation — 2026-10-01

Implemented on `phase-5-coaching-worker`: additive worker/lease/receipt/coverage migration; private machine API; transactional planning tools; standalone conversation binding; OpenAI Agents SDK 0.18.0 worker; configurable GPT-6.1 Sol/medium defaults; versioned coaching prompt; human combined or separate brief confirmation and locking; planned-horizon and estimate provenance UI; Docker/Compose and deterministic worker smoke.

See [worker operations](./phase-5-runtime.md) for setup, private Railway service settings, execution limits and recovery. No deployment or push has been performed. Completed tools remain saved after failure/cancellation; generated coverage can be shorter than the total plan dates. Old schema 2 projections retain their historical hashes, and legacy coverage remains unknown. Worker edits upgrade editable legacy content to schema 3 without changing locked versions.

Verification completed: 71 unit/UI/SDK tests; 43 database integration tests plus SQL invariants; populated Phase 4 migration preservation; disposable API/web/worker SDK smoke; and full `pnpm check` in an isolated source snapshot excluding unrelated mobile scaffolding. The production audit passes its high-severity gate after pinning Undici 7.29.1; nine low/moderate findings remain. Root `pnpm check` still stops on the separate mobile app's formatting. The snapshot uses a dummy publishable Clerk key and no copied secrets.

The sweeper also runs when chat execution is unavailable, so disabling or losing the worker cannot indefinitely retain expired run slots. Tests exercise cleanup in that mode.

The user is away from their machine and will supply `OPENAI_API_KEY` later. Continue deterministic verification; the live Responses/tool smoke and signed-in real-coaching walkthrough are pending. Do not mark Phase 5 complete on scripted-model evidence alone.

A separately developed Expo app appeared in `apps/mobile` during implementation. Preserve that work; it is excluded from the pnpm workspace. Root formatting currently reports that app's unfinished files, so Phase 5 validation also uses an isolated source snapshot.

### Phase 5 refinement — 2026-10-01

Product decisions are recorded in the [Phase 5 design](./phase-5-design.md), with delivery stages and acceptance gates in the [implementation plan](./phase-5-implementation-plan.md). This checkpoint contains planning documents only; no worker implementation or deployment has been performed.

The runtime direction changes from Pi to the OpenAI Agents SDK for TypeScript in an independent private worker, initially direct OpenAI/GPT-6.1 Sol with configurable model and reasoning settings. T3 Code's provider/event boundaries inform a small internal adapter; its full application stack is not adopted.

The coach collects context through natural discussion and decides when to generate. Users may lock an initial period, such as one month, and extend it in a later revision. Full plan-date coverage is not a locking prerequisite. Estimated pace targets must be labelled and revisited after early run feedback. Brief confirmation may happen separately or alongside lock review; all confirmation/lock/unlock authority remains human-only.

The implementation contract covers machine authentication, scoped run claims and leases, API-backed domain mutation tools, partial planning coverage, estimate provenance, cancellation/recovery, and the limited UI work needed for real coaching. Monthly spend configuration is deferred to provider setup. Advanced prompt settings, web search, automatic workout ingestion, broad UI polish, and streaming remain deferred.

Read the Phase 5 documents before implementation. Their verification gates are requirements, not already-passing tests. Keep production coaching unavailable until a ready real worker is connected; never enable test execution on Railway.

### Phase 4 deployment — 2026-09-11

The user authorized deployment after accepting local testing and explicitly deferred UI cleanup until after Phase 5. Implementation commit `51ce06c` was pushed to `main`; GitHub Actions run `34618376936` passed. Railway automatically deployed both services from that commit:

- API: `dc9c08d8-1617-43c6-9866-7c3bc62d373c`, SUCCESS.
- Web: `2a85f4ca-2624-4ec7-9634-4b94a411434a`, SUCCESS.
- Atlas applied the one pending Phase 4 migration successfully (17 statements), and the new API started in production mode.
- Public `/`, `/chat`, `/api/health`, and `/api/ready` returned 200. Protected conversation and capability endpoints returned 401 without authentication. The served frontend bundle includes the plan-chat action and chat-capability integration.

Hosted app: <https://askesis.up.railway.app>. `CHAT_EXECUTION_MODE` is unset and defaults to `unavailable`; the Docker image sets `NODE_ENV=production`. Simulated replies remain local-only. The signed-in walkthrough was performed locally, not repeated against Railway in this release check. Local conversations are not copied to the hosted database. Open Plan Library → a plan → **Chat about this plan** to open a hosted plan-linked conversation; global New chat remains standalone.

### Phase 4 acceptance and release preparation — 2026-09-11

The user accepted the localhost experience, including standalone and plan-linked chats. Phase 4 product scope is complete locally; do not start Phase 5 implementation as an implicit continuation of release work.

Release review tightened conversation cursor UUID validation to return `INVALID_CURSOR` (400) for malformed IDs instead of a database/server error, with a PostgreSQL-backed regression test. Final verification: `pnpm check` (31 API tests and 30 web tests), `pnpm test:db` (31 integration tests plus SQL invariants), and `pnpm smoke`. The existing eight low/moderate dependency findings and Vite bundle-size advisory remain non-blocking.

Next release step: push the verified Phase 4 commit when deployment is authorized, then observe CI and both Railway services, migration `20260910120000`, public readiness and unauthenticated endpoint protection. Pushing `main` triggers Railway deployment, so this local acceptance checkpoint does not record a hosted release. Keep `CHAT_EXECUTION_MODE=unavailable` in production: history and plan-chat navigation work, but sending is unavailable until the Phase 5 worker exists. Never enable the development test executor on Railway.

Phase 5 handoff: implement the separate worker and authorized API tools, real coaching, and conversational plan creation. The current manual create-plan UI remains Phase 3 scaffolding; atomic plan-plus-chat creation exists at the API boundary. Standalone-to-new-plan association, worker authentication/claiming, and streaming are not silently supplied by Phase 4 (streaming is Phase 6).

### Phase 4 local checkpoint — 2026-09-10

Implemented the approved [chat design](./phase-4-design.md) and [implementation plan](./phase-4-implementation-plan.md) against merged Phase 3 commit `4a83e7e`. Real coaching remains in Phase 5.

- Atlas migration `20260910120000` adds durable conversations, messages, agent runs, and ordered run events; generated database/OpenAPI/client artifacts and readiness are updated.
- Owner-scoped APIs provide conversation management, paged history/events, atomic/idempotent sends, plan chat opening, cancellation, and explicit execution capabilities.
- Plan creation optionally creates its first conversation atomically. Existing plan creation responses retain HTTP 200 for compatibility; new conversation creation uses 201 and sends use 202.
- Active runs guard disruptive plan lifecycle operations. Effective chat archive state inherits plan archive state without losing individual archive choices. Observed draft identity survives draft deletion.
- Both mock chat lists are replaced, with plan context, rename/archive/restore, safe send retry, and run activity/status controls. The local executor supports success, cancellation, deliberate failure, and timeout without model calls or plan changes.
- `CHAT_EXECUTION_MODE=test` is explicitly local/test only; production rejects it and exposes coaching as unavailable.

Running test build: <http://localhost:5175/chat>, API <http://localhost:3002/api/ready>. The existing servers on ports 3000/3001 and 5173/5174 were left running. Reproduction commands and test inputs are in [local development](./local-development.md#phase-4-chat-test-executor).

Verification passed: `pnpm check` (31 API tests, 27 web tests, builds, generated artifacts, migration checksum, configured audit gate), `pnpm test:db` (30 integration tests plus SQL invariants), and `pnpm smoke`. A separate populated Phase 3 fixture migration rehearsal preserved identical hashes for plans, versions, briefs, calibration profiles, and workouts; the disposable rehearsal database was removed afterward.

The signed-in localhost walkthrough used a dedicated Clerk development test account and verified successful persisted replies, reload, cancellation, deliberate failure, archive/read-only/restore, and opening a plan-associated chat. Desktop and 390-pixel mobile layouts were checked, including composer visibility and conversation-panel access. The account and its sample chat/plan remain available in the collaborative preview. Clerk's testing guidance kept this on development credentials. No production authentication configuration was changed.

Accepted limitations: no real coaching or plan mutation from chat; text-only history; polling rather than SSE; no exact historical reconstruction of discarded draft content. The dependency audit reports seven moderate and one low issue, with no high/critical finding blocking the existing gate. Vite retains its bundle-size advisory. Phase 4 is not committed, merged, or deployed to Railway at this checkpoint; the next step is user testing of localhost and any resulting fixes.

User-testing follow-up: restored the original compact chat presentation (icon controls, options menu, centered empty state, message avatars, and inset composer). Added Enter-to-send with Shift+Enter for a newline and IME protection. Accepted sends no longer await background list refreshes, and lost-response retries remain available even if their original run has become active. All 30 web tests, frontend type checks, lint, and the web build pass; real browser mouse submission and mobile composer geometry were checked. The localhost servers were restarted as detached processes after the earlier terminal sessions stopped; use port 5175 for the test-enabled build.

### Phase 3 local checkpoint — 2026-09-10

The Phase 2 main branch was merged into `t3code/refine-phase-three` before implementation.
Phase 3 now has versioned briefs, recurring weekdays, explicit confirmation, persisted
race/threshold pace guides, effective-date replacement and reuse, and locked-history views.
Content schema is 2, validator is 3, and readiness requires `20260909120000_plan_briefs.sql`.
Local app: <http://localhost:5174/plans>; API: port 3001; isolated database: `askesis_phase3`.
See [the Phase 3 walkthrough](./phase-3-test-checklist.md) for checks, runtime details,
implementation differences, and limitations. Railway now serves Phase 3.

### Phase 3 deployment — 2026-09-10

User accepted the local walkthrough and authorized deployment. Implementation commit
`4a83e7e` is on `main`. Initial Railway API deployment
`014db987-ea30-453d-b6df-8a8009806baf` and web deployment
`e021dd39-ebc3-49cc-acf8-5e097be9b5b3` both succeeded.
Public health/readiness return 200, protected plans return 401 without authentication,
and the live frontend bundle contains the Phase 3 brief editor. Existing Phase 4
working documents in the main checkout were preserved during integration.

The Phase 2 checkpoint below is retained as deployment history.

Phase 2 implementation is underway on `phase-2-plan-lifecycle`. The new migration
`20260907120000_plan_versions.sql` resets plan-domain data while preserving
athletes and external identities. It adds version roots, lineage, version-scoped
content, immutable movement definitions, idempotency storage, and database guards.
Kysely types and the workout OpenAPI/client contract have been regenerated.

Workout lists now require `planVersionId`; membership access is removed. The
`/plan` page selects active plans and explicitly requests their locked or draft version content.
The Cardiff seed creates a populated draft, then Compose publishes and activates it
using the real lifecycle service and hash/validation results. Publication is
idempotent and forbidden in production/Railway.

The create/edit/validate/lock/unlock/discard API is implemented, including owner scoping,
optimistic concurrency, successful-command idempotency, canonical hashing, temporal validation,
change summaries, and complete normalized cloning with retained lineage. The new `/plans`
library and detail screens use account-isolated TanStack Query caches and explicit confirmations.

Organization is now implemented: rename, multiple active plans, deactivate, archive/unarchive,
and owner-scoped library/active/archive filters. Archived plans retain content and become
read-only; unarchive leaves them inactive. `/plans/archive` lists archived plans. `/plan` uses
account-scoped browser preferences for selection, always issuing explicit version-ID requests.
Local servers run in detached tmux sessions `askesis-phase2-api` and `askesis-phase2-web`.

History/restore is implemented. Plan details embed immutable revision history, and
`/plans/:planId/versions/:revisionId` shows saved metadata, validation, summaries, semantic
content, and the explicit historical schedule (also while archived). Restore is previewed
and confirmed with state/current-version/hash checks and an idempotency key. It clones into
a draft based on the historical source, leaving the locked pointer untouched until a later
lock creates the next chronological version. Existing drafts, archives, and semantic no-ops
block restoration. The UI identifies restored ancestry and warns before replacing a schedule.

Verified locally at the final hardening checkpoint: `pnpm check`, `pnpm test:db`
(14 PostgreSQL tests), `pnpm test:cutover`, and `pnpm smoke`. The normal development database was migrated at the earlier lifecycle checkpoint: one
legacy plan removed, two athlete records and one external identity preserved.
Local API readiness succeeds; the web app runs at http://localhost:5173/plans.

See [the browser test checklist](./phase-2-lifecycle-test-checklist.md) for the user walkthrough,
automation limitations, restart commands, and remaining scope. Structural/order validation,
fixture publication, affected-workout summaries, and archived draft inspection are implemented.
The append-only `20260908160000_workout_structure.sql` migration adds deferred workout-tree
and prescription integrity checks; readiness requires this migration. Validator version is 2.
Railway cutover is deployed; authenticated public verification remains outstanding. Do not
describe Phase 2 as complete until the signed-in walkthrough passes.

### Phase 2 deployment checkpoint — 2026-09-09

- Merged the integration branch into `main` and pushed. Hardening commit `519faab`;
  smoke-script lint follow-up `f2fb2df`. Full local `pnpm check` and final GitHub CI passed.
- API deployment `6baa9db5-fd66-437d-9e2c-aec838dd3f10`: SUCCESS, commit `f2fb2df`.
- Web deployment `156bbe0f-7513-48ad-876b-7665d8b6b7ba`: SUCCESS, explicitly uploaded
  from the clean `f2fb2df` tree after GitHub's web deployment was skipped.
- Atlas migration logs report success; public `/api/ready` returns 200/ready and
  OpenAPI exposes the new draft-read endpoint, proving the Phase 2 API is live.
- Public `/plans` returns 200; unauthenticated plan API requests return 401.
- No development seed/publication was run on Railway. Production row counts were not
  independently inspected; identity preservation is covered by the local cutover rehearsal.
- The cutover intentionally removes legacy plan-domain data; no backup was taken by this
  agent. Athletes and external identities are excluded from the reset.
- Remaining gate: user signed-in lifecycle/history/restore walkthrough on the public app.

`scripts/smoke-lifecycle.mjs` accepts a short-lived session-token JSON object through stdin
and an explicitly allowlisted origin. It creates a named smoke plan, exercises three revisions
and organization/restore, and retains the record archived. Never store or print the token.
The attempted Clerk backend-minted token lacked the required authorized-party claim and was
correctly rejected. Do not weaken authentication to run this check; use a properly scoped
browser session or the manual signed-in checklist. Railway SSH/direct database inspection
was unavailable; no SSH keys or public database networking were added.

Phase 1 implementation and deployment changes are committed on `main`. The Phase 2 lifecycle refinement, schema contract, and implementation plan are included with this handoff. Use `git log` for the exact handoff commit rather than copying a commit hash from this document.

The Phase 1 closure validation includes:

```bash
pnpm check
pnpm smoke
```

## Current architecture

```text
Internet
   │
   ▼
Public Railway web service
React assets + nginx on port 80
   │
   │ /api/* through Railway private networking
   ▼
Private Railway API service
Hono on port 3000
   │
   ▼
Private Railway PostgreSQL
```

Only the API receives `DATABASE_URL` and `CLERK_SECRET_KEY`. The web service must never receive either secret. The API intentionally has no public Railway domain.

Known non-secret deployment addresses:

```text
Public web origin: https://askesis.up.railway.app
API private host:  askesisapi.railway.internal
API private port:  3000
Expected upstream:  http://askesisapi.railway.internal:3000
```

## Deployment progress

Completed or observed:

- Railway PostgreSQL exists.
- The API and web services use the repository Dockerfiles rather than Railpack:
  - `apps/api/Dockerfile`
  - `apps/web/Dockerfile`
- Atlas is included in the API image.
- The Atlas pre-deploy command was corrected to use explicit shell expansion:

  ```bash
  sh -c 'atlas migrate apply --dir file:///app/database/migrations --url "${DATABASE_URL}?sslmode=disable"'
  ```

- The API container has started successfully after earlier environment configuration problems.
- The public web service serves the React application.
- The public root returned HTTP `200` when tested externally.
- Clerk's development instance loads and browser sign-in works.
- No Railway development seed should be configured or executed.

Confirmed during Phase 1 closure:

- The Railway API health-check path is configured as `/api/ready`.
- nginx reaches the API over Railway private networking.
- Authenticated API requests work through the public web origin.
- Lazy provisioning and the empty unseeded Plan view work in Railway.
- Sentry projects, deployment variables, scrubbed event delivery, and private source-map upload are configured and validated.

## Resolved Phase 1 incident: nginx private API resolution

This section is retained as deployment history. nginx originally resolved its upstream during process startup, before Railway private DNS was available, and crashed. It now uses Railway's internal resolver and resolves the configured upstream dynamically at request time.

External tests at handoff produced:

```text
GET https://askesis.up.railway.app/
→ HTTP 200 immediately

GET https://askesis.up.railway.app/api/health
→ TLS and HTTP/2 connection established
→ request sent
→ no response bytes
→ timeout after 20 seconds
```

This establishes that:

```text
Internet → Railway edge → web/nginx: working
web/nginx → private API: not working
```

Loading the React page and signing into Clerk do not prove API connectivity because the static assets come from nginx and Clerk authentication occurs directly from the browser to Clerk.

The expected web service variable is:

```text
API_UPSTREAM=http://askesisapi.railway.internal:3000
```

Requirements:

- Include `http://`.
- Do not use `https://` for Railway private traffic.
- Do not append `/api`.
- Do not add a trailing slash.
- Apply the variable to the web service in the same Railway environment as the API.
- Redeploy the web service after changing it because nginx renders its template at container startup.

### Historical diagnostics

Perform these before changing application architecture.

1. Confirm the latest API deployment contains commit `bed0bf7` and logs `Askesis API started`.
2. Confirm the web and API services are in the same Railway project environment.
3. Disable Railway Serverless/app sleeping for the private API during prototype validation.
4. Confirm the web service's resolved `API_UPSTREAM` is exactly the expected value above.
5. Open a shell in the web container and run:

   ```sh
   echo "$API_UPSTREAM"
   grep -n "proxy_pass" /etc/nginx/conf.d/default.conf
   wget -S -O - -T 5 "$API_UPSTREAM/api/health"
   ```

6. Open a shell in the API container and run:

   ```sh
   wget -S -O - -T 5 http://127.0.0.1:3000/api/health
   wget -S -O - -T 5 http://[::1]:3000/api/health
   ```

7. Compare results:

   - API-local request fails: investigate API listener, process, or port.
   - API-local succeeds but web-container request reports `bad address`: investigate private DNS/environment.
   - API-local succeeds but web-container request is refused: investigate listener or port mismatch.
   - API-local succeeds but web-container request times out: investigate Railway private networking or sleeping.
   - Web-container request succeeds but public `/api/health` hangs: inspect rendered nginx configuration and logs.

Do not make the API public as the permanent fix. Browser API traffic must continue through the public nginx service and Railway private networking.

## Expected Railway configuration

### API service

```text
Build context/root: repository root
Dockerfile:         apps/api/Dockerfile
Public domain:      none
Port:               3000
Health-check path:  /api/ready
Custom start:       empty; use Dockerfile CMD
```

Required variables by name:

```text
DATABASE_URL
CLERK_SECRET_KEY
CLERK_PUBLISHABLE_KEY
CLERK_AUTHORIZED_PARTIES
PORT=3000
LOG_LEVEL=info
```

`DATABASE_URL` should be a Railway reference to the PostgreSQL service. `CLERK_AUTHORIZED_PARTIES` should contain the exact public HTTPS web origin without a trailing slash.

Pre-deploy command:

```bash
sh -c 'atlas migrate apply --dir file:///app/database/migrations --url "${DATABASE_URL}?sslmode=disable"'
```

### Web service

```text
Build context/root: repository root
Dockerfile:         apps/web/Dockerfile
Public domain:      https://askesis.up.railway.app
Target port:        80
Health-check path:  /
Custom start:       empty; use Dockerfile CMD
```

Required variables by name:

```text
VITE_CLERK_PUBLISHABLE_KEY
API_UPSTREAM
```

The Clerk publishable key is public and embedded at Vite build time. `DATABASE_URL` and `CLERK_SECRET_KEY` must not exist in the web service.

## Hosted validation after private networking is fixed

Run from a local machine through the public web origin:

```bash
export ASKESIS_URL='https://askesis.up.railway.app'

curl -fsS --connect-timeout 5 --max-time 15 \
  "$ASKESIS_URL/api/health"

curl -fsS --connect-timeout 5 --max-time 15 \
  "$ASKESIS_URL/api/ready"

curl -sS --connect-timeout 5 --max-time 15 \
  -o /tmp/askesis-response.json \
  -w '%{http_code}\n' \
  "$ASKESIS_URL/api/v1/workouts"

cat /tmp/askesis-response.json

curl -sS -o /dev/null -w '%{http_code}\n' \
  "$ASKESIS_URL/api/docs"

curl -sS -o /dev/null -w '%{http_code}\n' \
  "$ASKESIS_URL/api/openapi.json"
```

Expected results:

```text
/api/health             → 200 and {"status":"ok"}
/api/ready              → 200 and {"status":"ready"}
/api/v1/workouts        → 401 without a Clerk token
/api/docs               → 200
/api/openapi.json       → 200
```

Then verify manually in the browser:

- Sign in.
- Confirm authenticated `/api/v1/workouts` returns `200` in the Network panel.
- Confirm the unseeded Railway account sees an empty Plan view rather than local Cardiff fixture data.
- Confirm the first authenticated request lazily provisions the Clerk identity mapping.
- Confirm Settings/account management works.
- Sign out and confirm protected routes return to sign-in.

## Sentry deployment

Phase 1 created two Sentry projects:

```text
askesis-api — Node.js
askesis-web — React
```

Configure the API service:

```text
SENTRY_DSN=<API project DSN>
SENTRY_RELEASE=<Git commit SHA>
```

Configure the web service and rebuild it:

```text
VITE_SENTRY_DSN=<web project DSN>
SENTRY_RELEASE=<Git commit SHA>
```

Runtime Sentry initialization and basic scrubbing already exist in:

- `apps/api/src/instrument.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/router.tsx`

The implementation disables default PII collection and removes request bodies, cookies, authorization headers, and cookie headers before sending events.

Deployed browser and API events were verified and inspected for Clerk tokens, authorization headers, cookies, chat content, complete plan context, database URLs, and other credentials.

Production browser builds generate hidden source maps, upload them securely to Sentry, and delete them before the nginx runtime image is assembled.

## Phase 1 completion checklist

After resolving the blocker and configuring Sentry:

- [x] Public `/api/health` succeeds through nginx.
- [x] Public `/api/ready` confirms PostgreSQL and Atlas migration readiness.
- [x] Unauthenticated `/api/v1/workouts` returns the standard `401` envelope.
- [x] Authenticated API access works through the public web domain.
- [x] A new Railway athlete sees no development seed data.
- [x] Lazy Clerk identity provisioning works.
- [x] Settings and sign-out work.
- [x] Railway API health check uses `/api/ready`.
- [x] Atlas pre-deploy failure is confirmed to block API release.
- [x] Sentry receives scrubbed API and browser errors.
- [x] Source-map upload is implemented and validated.
- [x] `docs/v1-poc-development-plan.md` Phase 1 status and checkboxes are updated.
- [x] `docs/railway-deployment-plan.md` status is updated from planned to deployed.

## Next implementation phase

Phase 1 is closed. Phase 2 refinement, schema design, and implementation planning are recorded in the accepted [lifecycle refinement](./phase-2-plan-lifecycle-refinement.md), proposed [schema contract](./phase-2-schema-contract.md), and proposed [implementation plan](./phase-2-implementation-plan.md). Phase 2 introduces:

- Multiple logical plans.
- Draft, Locked, Unlocked, and Archived states.
- Activation independent from lock state.
- Complete normalized aggregate versioning.
- Transactional human-confirmed locking.
- Unlocking by cloning the current immutable version into a draft.
- Draft discard.
- Version history and restore-as-draft.
- Archive/unarchive behavior.
- Consistent owner authorization.

Do not begin agent plan mutations before immutable plan revision semantics exist.

Phase 3 has been refined in parallel so it is ready for review after Phase 2. Its accepted [brief and calibration refinement](./phase-3-plan-brief-and-calibration-refinement.md), proposed [schema and API contract](./phase-3-schema-contract.md), and proposed [implementation plan](./phase-3-implementation-plan.md) define the temporary structured brief flow, human confirmation, race-result or threshold-pace calibration, persisted E/M/T/I/R guides, and effective-dated workout resolution. Phase 3 must build on the final Phase 2 implementation rather than beginning against an assumed intermediate schema.

## Non-negotiable architecture and product constraints

- PostgreSQL is the sole source of truth.
- Core plan data remains normalized rather than authoritative JSONB.
- Atlas exclusively owns schema migrations; deployed migrations are append-only.
- Only the core API may access PostgreSQL.
- The web and agent worker use the same domain API.
- Clerk identities remain separate from internal athlete UUIDs.
- Lazy provisioning must recover mappings after database resets.
- The agent worker receives no `DATABASE_URL` or `CLERK_SECRET_KEY`.
- Chat is the primary plan-editing interface.
- Agents cannot lock or unlock plans; both require human confirmation.
- Plan assumptions, calibration, zones, and workouts are versioned as one aggregate.
- Alpha is invitation-only and running-only.
- No user-facing permanent deletion, plan sharing, or global athlete profile during alpha.
- Do not add development seed data to Railway.

## Security note

A Clerk development secret was pasted into an earlier chat during deployment troubleshooting. It must be treated as compromised and revoked in Clerk if that has not already happened. Never reproduce that key in future prompts or documentation. Confirm rotation by status only; do not ask the user to paste the replacement value.
