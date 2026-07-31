# Prototype observability

## Local development

The API uses Pino with readable local output. Sentry reporting is disabled unless `NODE_ENV=production` and a DSN is configured.

Every API response receives an `x-request-id`. Structured request logs include that identifier, method, route, status, duration, and the internal athlete ID when authenticated. Health and readiness requests log at debug level to avoid noise.

Do not log:

- Authorization headers or Clerk session tokens
- Database or provider credentials
- Complete chat prompts
- Complete plan context
- Secret environment variables

## Railway

Phase 1 uses:

- Railway deployment and service logs
- `/api/health` for liveness
- `/api/ready` for database readiness
- Sentry for browser and API exceptions

Dedicated metrics, tracing, uptime monitoring, and paging are deferred.

## Sentry variables

API service:

```text
SENTRY_DSN
SENTRY_RELEASE
```

Web build:

```text
VITE_SENTRY_DSN
SENTRY_RELEASE
```

The web Dockerfile maps `SENTRY_RELEASE` into `VITE_SENTRY_RELEASE` during the build. Sentry is configured with default PII collection disabled. Request bodies, cookies, and authorization headers are removed before events are sent.

Source-map upload requires a Sentry project and deployment credential. The credential must be supplied only to the build environment and must not be committed or embedded in the browser bundle.

## Correlation procedure

1. Start from the Sentry event or user-visible API error.
2. Copy its request ID.
3. Search Railway API logs for that ID.
4. Use an agent-run ID when following work across future API and worker services.
5. Do not add sensitive prompt or plan data to logs while investigating.
