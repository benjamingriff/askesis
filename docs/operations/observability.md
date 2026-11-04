# Observability

Verified against API logging/error middleware, browser Sentry setup, Vite config and worker logging on 2026-10-06. Hosted monitoring configuration has not been rechecked by this audit.

## Logging and correlation

The API uses Pino: readable output in development, JSON in test/production. Every response gets `x-request-id`; a valid bounded incoming ID is reused, otherwise a UUID is generated. Request records include method, path, status, duration and authenticated internal athlete ID. Routine liveness/readiness and successful worker registration/claim polls log at debug; failures and per-run calls remain visible at normal levels.

Safe public errors include request ID. Recognized database errors are sanitized. Worker records are JSON with timestamp, severity, worker ID, provider/model, prompt version, API host/port and run ID where relevant. `WORKER_STARTING`, `WORKER_READY` and `WORKER_STOPPED` mark the lifecycle. `REGISTRATION_FAILED`, `POLL_FAILED`, `HEARTBEAT_FAILED` and `FINISH_FAILED` identify the failing operation and phase. Registration retries include the attempt number, retry delay and a troubleshooting hint: HTTP 400 points to registration schema/prompt compatibility, 401/403 to the shared machine token, and 503 to API readiness/execution mode. These are diagnostic checks, not proof of the underlying cause.

Failure records distinguish HTTP errors, network errors, timeouts, malformed responses and configuration errors. HTTP diagnostics include status, an allowlisted API code and the response's UUID `x-request-id` for correlation. Network diagnostics preserve recognized codes such as `ENOTFOUND`, `ECONNREFUSED` and `UND_ERR_CONNECT_TIMEOUT`, including errors nested inside Node's connection `AggregateError`. Configuration startup failures identify invalid environment field names without their values. Unknown error messages, stacks, response bodies, provider exceptions, prompts and tool payloads are excluded. Failed runs include the bounded runtime `failureCode`; failure to deliver that terminal result is logged separately as `FINISH_FAILED`.

Pino redaction covers specific configured credential/header/token paths. It is not arbitrary recursive detection of every possible secret. Do not add authorization headers, environment objects, full prompts, plan context or raw provider errors to logs.

For an incident, locate the request ID in API logs, then follow run ID through worker/API records. Durable run usage and [live timing measurements](./phase-6-runtime.md#measurements) support investigation without private content. `agent_runs.usage` preserves bounded per-request cache-read/write, input, output and reasoning counts, effective settings, returned model/tier and final/partial/unknown provenance. Usage contains allowlisted counts and identifiers, never hidden reasoning text or raw provider responses. Failed and cancelled finishes retain available usage; NULL means no report was received. See the [late-report bounds and rollout order](./phase-6-runtime.md#rollout-order). Benchmark reports compute versioned list-price estimates with explicit missing coverage; production cost columns and per-user spend controls remain unused.

## Liveness and readiness

`/api/health` checks the process without PostgreSQL. `/api/ready` queries Atlas for checkpoint `20261007120000`: a missing checkpoint returns 503; a database query exception is handled as an API error (500). A passing readiness check is not provider availability or proof of all hosted release checks.

Signed-in `/api/v1/chat-capabilities` reports compatible worker readiness. The private worker has no public health listener. Dedicated uptime monitoring/paging is not implemented in this repository.

## Sentry and source maps

API reporting requires `NODE_ENV=production` plus `SENTRY_DSN`; browser reporting requires a production build plus `VITE_SENTRY_DSN`. Release identifiers are optional for reporting. Default PII collection is disabled. Before-send hooks remove request data/cookies and authorization/cookie headers; they do not promise all custom contexts are scrubbed. The worker has no Sentry integration; SDK tracing is disabled and Responses storage is set false.

For web source-map upload, production Vite builds require all of `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` and `VITE_SENTRY_RELEASE`. Docker maps build argument `SENTRY_RELEASE` to `VITE_SENTRY_RELEASE`. With that complete configuration, hidden maps are uploaded and deleted from `dist`; enabled upload failures fail the build. Without it, source-map upload/generation is disabled. This condition also applies to local production builds, not only Railway.

Keep `SENTRY_AUTH_TOKEN` a build secret, never a `VITE_*` value or committed file. Reporting DSNs/publishable keys are public configuration; API, provider and upload credentials are secrets.

## Evidence

[Logger](../../apps/api/src/logger.ts), [API entry point](../../apps/api/src/app.ts), [Vite configuration](../../apps/web/vite.config.ts), [worker](../../apps/agent/src/worker.ts) and [runtime](../../apps/agent/src/runtime.ts). See [Railway rollout](./railway-deployment-plan.md) for independent hosted verification.
