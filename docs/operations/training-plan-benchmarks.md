# Local training-plan benchmark

The benchmark starts a dedicated local PostgreSQL database, the current API and the normal coaching worker. A synthetic runner answers the coach, then deterministic checks and a separate model call review the saved plan. No frontend is required. The CLI hosts the API and local fixture/export operator; a separate worker process receives only coaching configuration over IPC and calls the authenticated internal API over HTTP. Database and Clerk credentials are excluded from its environment.

## Run a scenario

Scenarios come from the [versioned athlete datasets](../../apps/bench/datasets/README.md): eight authored cases across running, cycling, swimming, strength, gym, hybrid and triathlon athletes, grouped in the `pilot-v1` suite. Validate their authoring data without starting services or making provider calls with `pnpm --filter @askesis/bench datasets:validate`. The retired `running-poc` scenario is replaced by `running-improver`, the same athlete in the dataset format; older `running-poc` runs remain readable in the dashboard but cannot be regraded.

Requirements: Node 24, the repository's pnpm version, Docker with a local daemon, development Clerk keys and a valid OpenAI API key. Model requests use the provider and incur its normal charges. PostgreSQL, API and worker run locally.

```sh
pnpm install --frozen-lockfile
pnpm bench run --scenario running-improver
# Every pilot case in order, each in its own process
pnpm bench run --suite pilot-v1
```

Credentials are read from `.env`, then `.env.bench.local`, then your shell. Alternatively select a private environment file:

```sh
pnpm bench run --scenario running-improver --env-file /absolute/path/to/private.env
```

Supported configuration:

```dotenv
OPENAI_API_KEY=your-provider-key
CLERK_SECRET_KEY=sk_test_your-development-key
CLERK_PUBLISHABLE_KEY=pk_test_your-development-key
AGENT_PROVIDER=openai
AGENT_MODEL=gpt-6.1-sol
AGENT_REASONING=medium
BENCH_SIMULATOR_MODEL=gpt-6.1-sol
BENCH_REVIEW_MODEL=gpt-6.1-sol
```

Keep credential files ignored. Missing development Clerk keys can fall back to the main checkout's ignored `.env`, as with `dev:setup`. The provider key does not fall back automatically. Shell variables take precedence over the selected file. The runner ignores supplied database URLs, API URLs, execution modes and bootstrap tokens, and constructs its own local configuration. Real Clerk middleware and machine authentication remain installed; fixture creation and exports call local domain services directly.

The CLI builds the relevant packages automatically, applies migrations and prints readiness, athlete messages, coach replies, tool activity and the assessment/report path. Each run uses a new synthetic athlete and conversation. Running `pnpm bench run` without `--scenario` or `--suite` lists the available scenarios. Dates are resolved in Europe/London and saved with the run. A suite stops early if a case is interrupted, and exits nonzero when any case fails.

### Athlete voices

The simulator first selects which scenario facts to reveal, exactly as before. A second call then words those facts as the athlete would say them. It sees only the selected statements, the recent conversation and a voice description, never the unrevealed facts. Code rejects a reply that drops or adds any number, date or weekday, retries once with the problems listed, and otherwise sends the authored fact text. Every message therefore discloses exactly the facts recorded in `disclosures.json`, while its wording varies.

```sh
pnpm bench run --scenario running-improver --voice anxious
pnpm bench run --scenario running-improver --voice none
```

`--voice persona` (the default) uses the persona's own communication style. `--voice none` sends the authored fact text unchanged, as earlier runs did. Named voices live in [`apps/bench/datasets/voices`](../../apps/bench/datasets/voices) and combine with any scenario: `terse`, `anxious`, `overconfident` and `vague`. They are versioned independently of dataset editions. The voice step uses the simulator model and adds one or two short calls per athlete message. Scripted runs skip it. Judge the coach's tone yourself in the dashboard; no model grades tone.

Default coach configuration comes from the existing worker parser and current coaching prompt. `AGENT_PROVIDER`, `AGENT_MODEL`, `AGENT_REASONING`, `AGENT_MAX_TURNS`, `AGENT_MAX_OUTPUT_TOKENS` and `AGENT_POLL_MS` are supported. To benchmark a Claude coach, set `AGENT_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`; `OPENAI_API_KEY` is still required because the simulator and reviewer always run on OpenAI. With an OpenAI coach they default to the coach model, and with a Claude coach to `gpt-6.1-sol`. Set their `BENCH_*_MODEL` variables explicitly when comparing coaching models so the evaluators remain fixed. `--scripted` replays the offline script through whichever coach runtime is selected. Candidate prompt injection, repeated trials and comparison summaries are future work.

### Prompt versions

Every prompt is identified by a name and the SHA-256 of its exact text: the coach (`multisport-coach-v3`), simulator (`fact-selection-v2`), voice (`athlete-voice-v1`) and reviewer (`training-plan-v3`). Changing a prompt's text requires a new name. `apps/agent/prompts.lock.json` and `apps/bench/prompts.lock.json` record each name's hash, and their tests fail if a text changes under an existing name. Workers report the coach prompt's hash when registering, and each `agent_runs` row records the hash of the worker that claimed it. Each benchmark run also saves the prompt texts and the coach's tool definitions under `prompts/`, with their hashes, plus a `toolsHash`, in `manifest.json`.

## Review the result

Open the printed `benchmark-results/<run-id>/report.md`. It contains the overall assessment, exact checks, six reviewer findings with references, saved schedule and conversation. The same directory contains:

| File                                  | Evidence                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scenario.json`                       | Resolved persona, facts, dates, events, evidence, expectations, limits and voice                                   |
| `prompts/`                            | Exact coach, simulator, voice and reviewer prompt texts, plus the coach's tool definitions                         |
| `athlete-actions.jsonl`               | Per athlete message: selected facts, intent, authored text, voice attempts with any rejections, and sent text      |
| `manifest.json`, `configuration.json` | Git revision and working-tree status, prompt/scenario hashes and versions, model settings and environment identity |
| `state.json`, `progress.jsonl`        | Current stage and activity history                                                                                 |
| `disclosures.json`                    | Facts disclosed at each athlete message                                                                            |
| `snapshot.json`                       | Persisted conversation, run metadata and prompt hash, visible output with first-saved times, receipts and plan     |
| `plan.json`                           | Saved brief, blocks, semantic plan, validation and resolved workout prescriptions                                  |
| `tool-trace.jsonl`                    | Tool inputs, accepted results, status and timing                                                                   |
| `checks.json`, `assessment.json`      | Deterministic checks and overall assessment                                                                        |
| `metrics.json`                        | Available coaching/evaluator token usage; monetary cost remains unknown                                            |

The athlete model selects fact IDs and code renders their authored values. The voice prompt asks for rewording only; code checks numbers, ISO dates and weekdays, retries once on differences, then falls back to the authored text. This is a lexical guard, not a semantic guarantee: a reply can still omit or alter nonnumeric information. Compare voiced messages with their authored statements when reviewing the conversation. Completion depends on current persisted coverage for the agreed horizon and a nonempty schedule, rather than the simulator's satisfaction or the coach's claim. Each scenario lists its checks: saved plan, plan dates, coverage, sports, per-sport baseline (unknown values must stay unknown), available days and facility days, daily time budgets, at most two workouts a day, prescriptions (a resolved zone for every run, ride and swim effort; reps with RIR or RPE for strength, allowing timed rests) and calibration provenance (disclosed results recorded as user supplied with their dates; anything else labelled an estimate). Required discovery and structural validation always run. The reviewer assesses goal fit, progression, recovery, prescriptions, personalization and conversation. Its references must exist and it must assess all six criteria.

An `acceptable` result requires all exact checks and all reviewer criteria to pass. Missing coverage/prescriptions or failed execution produces `incomplete`. Other quality failures or uncertainty produce `needs_revision`. A completed conversation without a valid review produces `assessment_unavailable`. Model grading is provisional and has not been calibrated against a human coach. One synthetic run does not establish comparative model quality.

Exit status 0 means execution and assessment completed, even if the plan needs revision. Setup/provider errors, interruption, exhausted conversation/time limits and unavailable review return a nonzero status. Inspect the assessment and progress log to distinguish operational failures from plan quality. Provider error messages are withheld because they can contain credential fragments. Diagnostics retain the HTTP status/category, recognized error type and code, SDK streaming terminal state and source filename/line when available, including nested error causes. Unknown diagnostic values are omitted. Retry the scenario to collect these details after updating; an earlier generic error cannot be reconstructed from its saved report.

Retry review of an exported snapshot without regenerating the plan or starting PostgreSQL:

```sh
pnpm bench grade --run <run-id> --env-file /absolute/path/to/private.env
```

The command preserves the previous assessment and writes a versioned review artifact before updating the report. It uses the saved dates. `BENCH_REVIEW_MODEL` selects the reviewer. Failed regrading leaves the previous assessment intact.

Writers hold a per-run `benchmark-results/<run-id>/run.lock`: generation holds it until its final report is saved, and regrading holds it throughout reading, reviewing and publishing. A second writer for the same run is rejected before starting a model call. Different saved runs can be regraded independently. The lock is released after reporting even with `--keep-alive`, so a completed run can be regraded while its API remains available. Ctrl+C during a review cancels the call and releases its lock; publication that has already started finishes before cleanup. If a process is forcibly killed, verify its recorded PID has exited before removing a stale per-run lock. JSON publication uses unique private temporary files, so concurrent writers cannot rename one another's temporary output.

## Inspect conversations in the dashboard

Run `pnpm dev:evals` and open the printed local address (the root command chooses a worktree-specific port; direct app-level Vite defaults to `http://127.0.0.1:5179`). This separate local dashboard reads `benchmark-results`; it does not require the training app or a Clerk browser session. Set `EVALS_RESULTS_DIR` to inspect another result directory. Keep the dev server bound to loopback because review endpoints write to local artifacts.

The Conversations page starts with the run list. Each conversation shows persona/voice labels, disclosed facts, the athlete's sent message and the authored statements behind voiced messages. Expand tool cards for inputs/results. Interim text and tools follow saved timestamps; older artifacts without text times show an explicit ordering limitation. The Prompts section shows the saved texts, names and hashes.

Training load offers week/day charts and a weekly table on a shared date axis. Time, distance and TSS-style stress are coloured by sport, alongside fitness/fatigue and a baseline derived from stated training at assumed easy effort. Stress is `hours × IF² × 100` for run/ride and `hours × IF³ × 100` for swim, relative to threshold pace, FTP or CSS. Unresolved targets can use labelled RPE/zone estimates; strength without timed RPE work contributes time only. The intensity split counts time per effort. These are descriptive estimates with no new pass/fail rules; the existing volume chart's +10% marking is retained.

Rate tone, clarity and adaptation from 1–5 in Your review and save. Select a phrase in a coach reply to tag it. Ratings/notes save to `human-review.json`; phrase tags save separately to `human-highlights.json` so they do not overwrite an unsaved review draft. Both survive a reload. No automatic tone judge is added.

## Validate the grader with fixed fixtures

Run the current reviewer against committed synthetic evidence without generating a plan or starting the API, PostgreSQL or coaching worker:

```sh
pnpm bench calibrate --list --split all
pnpm bench calibrate
```

Live calibration needs only an OpenAI API key. Load it directly from your `askesis-bench` 1Password item:

```sh
pnpm bench calibrate --op
pnpm bench calibrate --op --repeat 3
```

`--op` uses your existing `op` authentication/desktop integration and keeps the key in process memory. It overrides `OPENAI_API_KEY` from your environment files or shell without exporting the retrieved value into the shell or writing it to artifacts. Selection prefers a field named `OPENAI_API_KEY` or `OpenAI key`, then common API-key/token/credential fields, then a single nonempty concealed field. Ambiguous fields are rejected. Override the item, vault or field when needed:

```sh
pnpm bench calibrate --op --op-item askesis-bench --op-vault Development --op-field credential
```

`--op-field` accepts an exact field label or ID; IDs disambiguate duplicate labels. `--op-item`, `--op-vault` and `--op-field` require `--op`. The CLI must be installed and able to access the item; lookup failures produce fixed diagnostics without exposing raw subprocess output. Scripted runs, fixture listing and help never retrieve a secret. `--op` is also available on `bench run` and `bench grade`; scenario runs still require the development Clerk configuration described above.

Alternatively, supply a resolved `OPENAI_API_KEY` through your shell, `.env.bench.local` or `--env-file`, or use `op run -- pnpm bench calibrate` with an exported `op://` reference. No Clerk keys or database connection are needed for calibration. `BENCH_REVIEW_MODEL` selects the reviewer, with `AGENT_MODEL` then `gpt-6.1-sol` as fallbacks.

There are twelve fixtures: three good controls and nine deliberately flawed or incomplete examples. Eight development cases run by default. Both time-based and distance-based good plans should pass, while ignored duration preferences should be caught. Other cases cover unsupported goal confirmation, availability, progression, missing prescriptions, saved/claimed mismatches, time limits, missing plans and plan text attempting to instruct the grader. The labels are provisional engineering judgments, available in [the fixture catalogue](../../apps/bench/fixtures/calibration.json) and [fixture documentation](../../apps/bench/fixtures/README.md), for owner/coach review. They are never sent to the reviewer.

```sh
# Repeat development cases to measure stability (24 model calls).
pnpm bench calibrate --repeat 3

# Evaluate the four holdout cases after refining on development cases.
pnpm bench calibrate --split holdout --repeat 3

# Run all twelve once, or target one case.
pnpm bench calibrate --split all
pnpm bench calibrate --split all --fixture unconfirmed-goal
```

`--repeat` accepts 1–5; `--fixture` may be repeated. Unknown fixture names or fixtures outside the chosen split are rejected. The existing reviewer prompt and response validation are reused, including required evidence references. Deterministic plan checks do not participate, so they cannot hide a reviewer missing a defect.

Each run prints a new `benchmark-results/calibration-<run-id>/report.md`. Open it to see verdict and criterion agreement, missed defects, false alarms, bad plans accepted, repeat consistency, latency, usage, and individual explanations/citations. Only explicitly labelled criteria count in comparison metrics. A flagged good criterion (`fail` or `uncertain`) is a false alarm; a `pass` on an expected defect is a missed defect. Other disagreements, such as `uncertain` instead of a required `fail`, remain visible separately. Repetition consistency compares the verdict and all six criterion results, rather than prose wording.

`results.json` contains machine-readable results. Each fixture directory contains `input.json`, `expected.json` and `attempt-<number>.json`. The manifest records selected cases, resolved fixture/label hashes, model, reviewer version/prompt hash, Git revision and dirty-tree state. Files are private and ignored by Git. Usage currently records successful input/output token totals; monetary cost remains unknown because cache breakdown is not retained.

Reports update after each attempt. Ctrl+C or the 30-minute suite limit retains completed reviews. A provider or review-validation failure stops further calls, records safe diagnostics and returns exit status 1. Validation failures have specific `REVIEW_*` codes and fixed explanations; the parsed rejected review and available usage are retained in the attempt JSON, so invalid citations or verdicts can be inspected. Errors and unattempted cases are excluded from grading-agreement denominators and shown explicitly. There is no automatic resume or retry.

The reviewer (since `running-plan-v2`; now the sport-neutral `training-plan-v3`) receives the available evidence-reference IDs explicitly. When the saved plan is null, `plan:missing` is a valid reference for that absence; `plan:brief`, workout and block IDs are unavailable. The reviewer must still provide all six criteria and an `incomplete` verdict. A valid incomplete judgment is an expected result, not an operational error. Retry just that case with `pnpm bench calibrate --op --fixture missing-plan`.

By default, a fully executed suite exits 0 even when the grader disagrees with labels: disagreement is the result being measured. Add `--assert` to exit 1 on any labelled disagreement, for a regression gate after calibrating and reviewing the labels. Operational errors always exit 1.

Verify report wiring without an API key:

```sh
pnpm bench calibrate --scripted --split all --repeat 2
```

This uses a deliberately permissive stand-in that passes every existing plan and marks a missing plan incomplete. It should expose sixteen missed defects across 24 scripted judgments. Reports are prominently marked **SCRIPTED WIRING CHECK**, and the result says nothing about a live model's grading quality. `--list` also makes no provider request.

## Keep the API available and stop it

```sh
pnpm bench run --scenario running-improver --keep-alive
```

After reporting, the command keeps its API listening on the printed loopback URL until Ctrl+C. The coaching worker stops after execution; the database remains available until Ctrl+C, which removes the containers/network while retaining data. Agents must not leave this mode running when handing back. Public API endpoints retain normal authentication, and the synthetic athlete is not provisioned into a browser account. This mode supports API/service inspection; viewing the Markdown/JSON artifacts is the first proof-of-concept review interface.

Ctrl+C during execution requests cancellation through the normal run lifecycle, waits for accepted partial output to persist, stops the worker/API and removes the benchmark containers/network, retaining the database volume and artifacts. It never automatically resumes a failed model session. Without `--keep-alive`, API, worker and PostgreSQL stop after reporting; containers and the empty network are removed. Database data and reports remain. To recover a stack after an uncatchable termination:

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
pnpm bench run --suite pilot-v1 --scripted
pnpm --filter @askesis/bench test
```

The scripted mode exercises the same worker, authenticated tools, migrations and persisted plan exports with an SDK model fixture. It requires development Clerk configuration, but no provider key. Its report explicitly states that it evaluates harness wiring and does not grade real model quality. All reviewer criteria are `uncertain`, so its overall verdict is `needs_revision` even when every deterministic check passes.

The fixture schedules each persona's desired sessions as short easy efforts on allowed days, recording measured results as user supplied and placeholder calibrations as estimates. Every pilot case should pass all deterministic checks in scripted mode. These sessions are test data. They are not a coaching recommendation or evidence of appropriate progression.
