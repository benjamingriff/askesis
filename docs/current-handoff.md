# Current agent handoff

**Updated:** 2026-09-09
**Current phase:** Phase 2 — lifecycle, organization, and history/restore on `phase-2-plan-lifecycle`
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

## Non-negotiable architecture and product constraints

- PostgreSQL is the sole source of truth.
- Core plan data remains normalized rather than authoritative JSONB.
- Atlas exclusively owns schema migrations; deployed migrations are append-only.
- Only the core API may access PostgreSQL.
- The web and future Pi agent use the same domain API.
- Clerk identities remain separate from internal athlete UUIDs.
- Lazy provisioning must recover mappings after database resets.
- The future Pi worker receives no `DATABASE_URL` or `CLERK_SECRET_KEY`.
- Chat is the primary plan-editing interface.
- Agents cannot lock or unlock plans; both require human confirmation.
- Plan assumptions, calibration, zones, and workouts are versioned as one aggregate.
- Alpha is invitation-only and running-only.
- No user-facing permanent deletion, plan sharing, or global athlete profile during alpha.
- Do not add development seed data to Railway.

## Security note

A Clerk development secret was pasted into an earlier chat during deployment troubleshooting. It must be treated as compromised and revoked in Clerk if that has not already happened. Never reproduce that key in future prompts or documentation. Confirm rotation by status only; do not ask the user to paste the replacement value.
