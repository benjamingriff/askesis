# Local training-plan benchmark

The proof of concept starts a dedicated local PostgreSQL database, the current API and the normal coaching worker. A synthetic runner answers the coach, then deterministic checks and a separate model call review the saved plan. No frontend is required. The CLI hosts the API and local fixture/export operator; a separate worker process receives only coaching configuration over IPC and calls the authenticated internal API over HTTP. Database and Clerk credentials are excluded from its environment.

## Run a scenario

Requirements: Node 24, the repository's pnpm version, Docker with a local daemon, development Clerk keys and a valid OpenAI API key. Model requests use the provider and incur its normal charges. PostgreSQL, API and worker run locally.

```sh
pnpm install --frozen-lockfile
pnpm bench run --scenario running-poc
```

Credentials are read from `.env`, then `.env.bench.local`, then your shell. Alternatively select a private environment file:

```sh
pnpm bench run --scenario running-poc --env-file /absolute/path/to/private.env
```

Supported configuration:

```dotenv
OPENAI_API_KEY=your-provider-key
CLERK_SECRET_KEY=sk_test_your-development-key
CLERK_PUBLISHABLE_KEY=pk_test_your-development-key
AGENT_MODEL=gpt-6.1-sol
AGENT_REASONING=medium
BENCH_SIMULATOR_MODEL=gpt-6.1-sol
BENCH_REVIEW_MODEL=gpt-6.1-sol
```

Keep credential files ignored. Missing development Clerk keys can fall back to the main checkout's ignored `.env`, as with `dev:setup`. The provider key does not fall back automatically. Shell variables take precedence over the selected file. The runner ignores supplied database URLs, API URLs, execution modes and bootstrap tokens, and constructs its own local configuration. Real Clerk middleware and machine authentication remain installed; fixture creation and exports call local domain services directly.

The CLI builds the relevant packages automatically, applies migrations and prints readiness, athlete messages, coach replies, tool activity and the assessment/report path. Each run uses a new synthetic athlete and conversation. The scenario describes a first half marathon twelve weeks away, a three-run/22 km baseline, Tuesday/Thursday/Sunday availability, and a recent measured 5 km result. It asks for the first four weeks now. Dates are resolved in Europe/London and saved with the run.

Default coach configuration comes from the existing worker parser and current coaching prompt. `AGENT_MODEL`, `AGENT_REASONING`, `AGENT_MAX_TURNS`, `AGENT_MAX_OUTPUT_TOKENS` and `AGENT_POLL_MS` are supported. Simulator and reviewer models default to the coach model; set their `BENCH_*_MODEL` variables explicitly when comparing coaching models so the evaluators remain fixed. Candidate prompt injection, scenario suites, repeated trials and comparison summaries are future work.

## Review the result

Open the printed `benchmark-results/<run-id>/report.md`. It contains the overall assessment, exact checks, six reviewer findings with references, saved schedule and conversation. The same directory contains:

| File                                  | Evidence                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scenario.json`                       | Resolved facts, dates, expectations and limits                                                                     |
| `manifest.json`, `configuration.json` | Git revision and working-tree status, prompt/scenario hashes and versions, model settings and environment identity |
| `state.json`, `progress.jsonl`        | Current stage and activity history                                                                                 |
| `disclosures.json`                    | Facts disclosed at each athlete message                                                                            |
| `snapshot.json`                       | Persisted conversation, run metadata, durable visible output, receipts, performance and plan                       |
| `plan.json`                           | Saved brief, blocks, semantic plan, validation and resolved workout prescriptions                                  |
| `tool-trace.jsonl`                    | Tool inputs, accepted results, status and timing                                                                   |
| `checks.json`, `assessment.json`      | Deterministic checks and overall assessment                                                                        |
| `metrics.json`                        | Available coaching/evaluator token usage; monetary cost remains unknown                                            |

The athlete model selects fact IDs; code renders their exact values. It cannot write additional athlete facts. Completion depends on current persisted coverage for the agreed horizon and a nonempty schedule, rather than the simulator's satisfaction or the coach's claim. Checks assess dates, coverage, disclosed facts, baseline, allowed days, weekly frequency, structure, resolved prescriptions and calibration provenance. The reviewer assesses goal fit, progression, recovery, prescriptions, personalization and conversation. Its references must exist and it must assess all six criteria.

An `acceptable` result requires all exact checks and all reviewer criteria to pass. Missing coverage/prescriptions or failed execution produces `incomplete`. Other quality failures or uncertainty produce `needs_revision`. A completed conversation without a valid review produces `assessment_unavailable`. Model grading is provisional and has not been calibrated against a human coach. One synthetic run does not establish comparative model quality.

Exit status 0 means execution and assessment completed, even if the plan needs revision. Setup/provider errors, interruption, exhausted conversation/time limits and unavailable review return a nonzero status. Inspect the assessment and progress log to distinguish operational failures from plan quality. Provider error messages are withheld because they can contain credential fragments; safe HTTP status/category diagnostics are retained.

Retry review of an exported snapshot without regenerating the plan or starting PostgreSQL:

```sh
pnpm bench grade --run <run-id> --env-file /absolute/path/to/private.env
```

The command preserves the previous assessment and writes a versioned review artifact before updating the report. It uses the saved dates. `BENCH_REVIEW_MODEL` selects the reviewer. Failed regrading leaves the previous assessment intact.

## Keep the API available and stop it

```sh
pnpm bench run --scenario running-poc --keep-alive
```

After reporting, the command keeps its API listening on the printed loopback URL until Ctrl+C. The coaching worker stops after execution; the database remains available. Public API endpoints retain normal authentication, and the synthetic athlete is not provisioned into a browser account. This mode supports API/service inspection; viewing the Markdown/JSON artifacts is the first proof-of-concept review interface.

Ctrl+C during execution requests cancellation through the normal run lifecycle, waits for accepted partial output to persist, stops the worker/API and retains the database and artifacts. It never automatically resumes a failed model session. Without `--keep-alive`, API and worker stop after reporting. PostgreSQL persists until:

```sh
pnpm bench stop
```

This stops only this worktree's benchmark Compose project and retains its volume. To explicitly remove that benchmark database and saved environment configuration:

```sh
pnpm bench reset
```

Exported reports remain after reset. These commands refuse to run while a benchmark holds the worktree lock. A forcibly killed process may leave `.bench/run.lock`; the CLI reports whether its PID is still alive. Remove a stale lock only after its process has exited.

The project/volume name is derived from the worktree path. API and database ports are selected independently of ordinary development and bound to `127.0.0.1`. Override `BENCH_API_PORT` or `BENCH_DATABASE_PORT` before first setup if a port is occupied. `.bench/environment.json` retains this identity; reset before changing ports. The API operator also refuses any connection string other than the generated benchmark database URL. Production and development database URLs are never used.

## Verify the harness without provider calls

```sh
pnpm bench run --scripted
pnpm --filter @askesis/bench test
```

The scripted mode exercises the same worker, authenticated tools, migrations and persisted plan exports with an SDK model fixture. It requires development Clerk configuration, but no provider key. Its report explicitly states that it evaluates harness wiring and does not grade real model quality. All reviewer criteria are `uncertain`, so its overall verdict is `needs_revision` even when every deterministic check passes.

The fixture's 12 easy runs are test data. They are not a coaching recommendation or evidence of appropriate progression.
