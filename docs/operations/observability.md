# Observability

Verified against API logging/error middleware, browser Sentry setup, Vite config and worker logging on 2026-10-06. Hosted monitoring configuration has not been rechecked by this audit.

## Logging and correlation

The API uses Pino: readable output in development, JSON in test/production. Every response gets `x-request-id`; a valid bounded incoming ID is reused, otherwise a UUID is generated. Request records include method, path, status, duration and authenticated internal athlete ID. Routine liveness/readiness and successful worker registration/claim polls log at debug; failures and per-run calls remain visible at normal levels.

Safe public errors include request ID. Recognized database errors are sanitized. Worker records use run IDs and bounded failure/status codes; complete provider exceptions, prompts and tool payloads are not intentionally logged.

Pino redaction covers specific configured credential/header/token paths. It is not arbitrary recursive detection of every possible secret. Do not add authorization headers, environment objects, full prompts, plan context or raw provider errors to logs.

For an incident, locate the request ID in API logs, then follow run ID through worker/API records. Durable run usage and [live timing measurements](./phase-6-runtime.md#measurements) support investigation without private content. Monetary cost calculation and per-user spend controls are absent.

## Liveness and readiness

`/api/health` checks the process without PostgreSQL. `/api/ready` queries Atlas for checkpoint `20261005120000`: a missing checkpoint returns 503; a database query exception is handled as an API error (500). A passing readiness check is not provider availability or proof of all hosted release checks.

Signed-in `/api/v1/chat-capabilities` reports compatible worker readiness. The private worker has no public health listener. Dedicated uptime monitoring/paging is not implemented in this repository.

## Sentry and source maps

API reporting requires `NODE_ENV=production` plus `SENTRY_DSN`; browser reporting requires a production build plus `VITE_SENTRY_DSN`. Release identifiers are optional for reporting. Default PII collection is disabled. Before-send hooks remove request data/cookies and authorization/cookie headers; they do not promise all custom contexts are scrubbed. The worker has no Sentry integration; SDK tracing is disabled and Responses storage is set false.

For web source-map upload, production Vite builds require all of `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` and `VITE_SENTRY_RELEASE`. Docker maps build argument `SENTRY_RELEASE` to `VITE_SENTRY_RELEASE`. With that complete configuration, hidden maps are uploaded and deleted from `dist`; enabled upload failures fail the build. Without it, source-map upload/generation is disabled. This condition also applies to local production builds, not only Railway.

Keep `SENTRY_AUTH_TOKEN` a build secret, never a `VITE_*` value or committed file. Reporting DSNs/publishable keys are public configuration; API, provider and upload credentials are secrets.

## Evidence

[Logger](../../apps/api/src/logger.ts), [API entry point](../../apps/api/src/app.ts), [Vite configuration](../../apps/web/vite.config.ts), [worker](../../apps/agent/src/worker.ts) and [runtime](../../apps/agent/src/runtime.ts). See [Railway rollout](./railway-deployment-plan.md) for independent hosted verification.
