# Phase 5 worker operations

The transport dependency is pinned to patched Undici 7.29.1; the production high-severity audit gate passes.

The coaching implementation uses `@openai/agents` **0.18.0**, direct OpenAI Responses, and `gpt-6.1-sol` with medium reasoning by default. Provider, model and reasoning are worker environment settings. The versioned system prompt (`running-coach-v2`) is in `apps/agent/src/prompt.ts`; user prompt customization and web search remain deferred.

## Local setup

Set `CHAT_EXECUTION_MODE=agent` and a shared `AGENT_BOOTSTRAP_TOKEN` (at least 32 characters) for the API and worker. Generate the token locally with `openssl rand -hex 32`; do not commit it. Set `OPENAI_API_KEY` for the worker.

With Compose, put those values in the ignored root `.env`, then run:

```sh
docker compose --profile agent up --build
```

Compose passes database and Clerk credentials only to the API. The worker receives its API URL, bootstrap token and provider settings. It exposes no browser port. The API receives no provider key through Compose. Normal local fixture setup still runs; production startup never seeds data.

For local processes, run `pnpm dev:api` and `pnpm dev:agent`. The worker reads `apps/agent/.env` so it can have a separate environment containing only `AGENT_API_URL`, `AGENT_BOOTSTRAP_TOKEN`, `OPENAI_API_KEY` and optional `AGENT_MODEL`, `AGENT_REASONING`, `AGENT_MAX_TURNS`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_POLL_MS`. The root `.env` configures the API. Keep the bootstrap token identical in both files.

The API defaults to unavailable execution. Agent mode requires its machine token. Fresh messages are accepted only while a compatible ready worker heartbeat is less than 60 seconds old; older prompt versions do not provide readiness or claim new work; history remains readable while offline. Production rejects simulated `test` execution.

## Execution and recovery

The worker polls the durable API queue and runs one conversation at a time. Registration and lease heartbeats occur every 15 seconds. Claims expire after 90 seconds and runs have a 15-minute deadline from submission. The API independently sweeps expired work at startup and every five seconds, including when chat execution is unavailable. Queued runs survive restart; expired running work fails without replaying the whole model session.

Each claim has a random scoped credential stored as a digest, an execution target and a fencing generation. The API derives ownership from the run. Every tool checks current authorization, draft/edit state and cancellation inside the mutation transaction. A tool receipt and safe event are committed with domain changes. Uncertain tool HTTP responses retry the same operation identity and input, at most three attempts. A stale external edit stops execution rather than silently retargeting it.

The first schedule batch records its full intended generation horizon in the durable run, atomically with the saved content. Later batches cannot shorten that horizon. Fully prescribed chunks advance contiguous completed coverage, including rest days; run and plan review distinguish interrupted generation from an intentionally shorter plan. Beginning regeneration clears previous coverage inside the intended horizon while retaining workouts until explicitly changed. Plan date edits trim or remove coverage outside the new boundaries, and lock validation rejects invalid coverage.

Completed tool changes remain saved after cancellation or failure. The final assistant reply and terminal status commit together. Terminal runs and chat/tool history are immutable. Initial standalone message/run provenance stays unchanged when a tool creates and associates a plan.

Tool operations are bounded to 200 per run; SDK turns default to 40. Output is bounded, token usage is recorded when a completed SDK result is available, and provider errors are represented by safe failure codes. Monetary cost calculation and aggregate spend configuration are not implemented. Configure provider account limits independently if desired.

SDK trace export is disabled, responses use `store: false`, and worker logs contain safe status codes and run IDs. Do not enable verbose SDK/provider logging with real conversation data. Default HTTP retry errors never include full provider or domain payloads.

## Private Railway service

Deploy a separate service from `apps/agent/Dockerfile`. Give it no public domain. Set `AGENT_API_URL=http://<api-private-hostname>:3000`, the shared bootstrap token, `OPENAI_API_KEY`, and optional model/reasoning settings. Do not assign `DATABASE_URL` or `CLERK_SECRET_KEY` to this service.

Apply migrations through `20261002090000` before enabling agent execution. Deploy the API with `CHAT_EXECUTION_MODE=agent` and its bootstrap token, then start the worker. Human authentication stays on `/api/v1/*`; `/internal/agent/*` uses machine credentials. The web nginx proxy explicitly returns 404 for `/internal/*`. The existing Railway API exposure still requires machine authentication on these routes; network exposure alone never grants worker authority.

Worker readiness is registered in PostgreSQL through the API, not through a public health port. Check signed-in `/api/v1/chat-capabilities` and sanitized worker logs. Allow at least 40 seconds for graceful worker shutdown; expiry cleanup handles abrupt termination. Do not deploy or push `main` as part of local validation: Railway automatically deploys that branch.

## Verification

```sh
pnpm check
TEST_DATABASE_PORT=55433 pnpm test:db
TEST_DATABASE_PORT=55433 pnpm test:agent:upgrade
pnpm smoke
pnpm smoke:agent:live
```

Port 55433 is optional and avoids another local project using the default test port. Database tests still require the exact disposable Askesis database/user on localhost. The upgrade check compares populated Phase 4 plan/workout/calibration/chat rows before and after migration, allowing only new provenance fields. It never resets the development database.

The disposable smoke uses the actual worker, API and SDK with a scripted model. It proves registration, queue claiming, a scoped tool receipt, final reply, and public proxy isolation. It makes no provider request. The live smoke reads `OPENAI_API_KEY` from the shell or ignored root `.env`, makes a bounded call to the selected model and verifies a Responses tool round trip; it must pass before claiming real-provider acceptance.

A signed-in walkthrough with the real provider remains a separate acceptance gate: initial discussion, sufficient-context generation, estimated paces, partial-horizon review/locking, unlock and extension, and cancellation recovery. Automated UI tests verify the review and warning acknowledgements, coverage and estimate presentation; they do not substitute for evaluating coaching quality.
