# Current agent handoff

**Updated:** 2026-08-02  
**Current phase:** Phase 1 — engineering foundation and Railway deployment validation  
**Next planned phase:** Phase 2 — plan lifecycle and immutable revisions

## Purpose

This document is the immediate handoff for the next coding agent. The long-term product and engineering plan remains in [`v1-poc-development-plan.md`](./v1-poc-development-plan.md).

Before making changes, read:

1. [`v1-poc-development-plan.md`](./v1-poc-development-plan.md)
2. [`railway-deployment-plan.md`](./railway-deployment-plan.md)
3. [`observability.md`](./observability.md)
4. [`repository-and-service-architecture.md`](./repository-and-service-architecture.md)

Do not place credentials, Clerk tokens, database URLs, Sentry credentials, or Railway secrets in chat, logs, commits, or this file.

## Repository state at handoff

The working tree was clean when this handoff was created.

```text
HEAD: bed0bf7e6f2405d03b0588b3e714c7788facbf7e
Commit: Support railway private api networking
```

Recent commits:

```text
bed0bf7 Support railway private api networking
fd518b3 added engineering tooling
9aad893 adding clerk for auth
```

The latest commit:

- Makes the API listen on the IPv6 wildcard `::` for Railway private networking. Node also accepts IPv4 locally through this listener.
- Removes the production API process's unnecessary attempt to load the repository `.env` file.
- Documents the explicit shell expansion required by the Railway Atlas pre-deploy command.

The following passed immediately before that commit:

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

Not yet confirmed:

- The Railway API health-check path is actually configured as `/api/ready`.
- nginx can reach the API over Railway private networking.
- Authenticated API requests work through the public web origin.
- Lazy provisioning and the empty unseeded Plan view work in Railway.
- Sentry projects and deployment variables are configured.

## Active blocker: nginx cannot reach the private API

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

### Next diagnostics

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

## Sentry work remaining

After networking is healthy, create two Sentry projects:

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
VITE_SENTRY_RELEASE=<Git commit SHA>
```

Runtime Sentry initialization and basic scrubbing already exist in:

- `apps/api/src/instrument.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/router.tsx`

The implementation disables default PII collection and removes request bodies, cookies, authorization headers, and cookie headers before sending events.

Verify one deployed browser event and one deployed API event. Inspect the resulting Sentry events and confirm they contain no Clerk tokens, authorization headers, cookies, chat content, complete plan context, database URLs, or other credentials.

There is one known Phase 1 discrepancy: runtime Sentry is implemented, but production browser source-map generation and secure Sentry upload are not currently implemented. Before declaring Phase 1 complete, either implement source-map upload or explicitly document its deferral.

## Phase 1 completion checklist

After resolving the blocker and configuring Sentry:

- [ ] Public `/api/health` succeeds through nginx.
- [ ] Public `/api/ready` confirms PostgreSQL and Atlas migration readiness.
- [ ] Unauthenticated `/api/v1/workouts` returns the standard `401` envelope.
- [ ] Authenticated API access works through the public web domain.
- [ ] A new Railway athlete sees no development seed data.
- [ ] Lazy Clerk identity provisioning works.
- [ ] Settings and sign-out work.
- [ ] Railway API health check uses `/api/ready`.
- [ ] Atlas pre-deploy failure is confirmed to block API release.
- [ ] Sentry receives scrubbed API and browser errors.
- [ ] Source-map upload is implemented or explicitly deferred.
- [ ] `docs/v1-poc-development-plan.md` Phase 1 status and checkboxes are updated.
- [ ] `docs/railway-deployment-plan.md` status is updated from planned to deployed.

## Next implementation phase

Once Phase 1 is closed, refine Phase 2 before implementation. Phase 2 is defined in [`v1-poc-development-plan.md`](./v1-poc-development-plan.md) and introduces:

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
