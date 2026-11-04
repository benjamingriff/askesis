# Validation dashboard roadmap

Status: exploration, recorded 2026-10-11. Nothing here is scheduled. The first working version of the dashboard (`apps/evals`, see its [README](../../apps/evals/README.md)) ships first so the owner can use it before refinement.

The dashboard reads artifacts written by the local training-plan benchmark (`pnpm bench`, [PR #58](https://github.com/benjamingriff/askesis/pull/58)). Its purpose is to verify that a single coach model's conversations and plans are fit for purpose, and to compare prompts, the change expected to have the biggest impact for now. Model comparisons are secondary.

## Launch panel

Trigger benchmark work from the dashboard instead of the terminal. The dev server spawns the existing CLI as a child process; the benchmark pipeline needs no changes.

| Control                                                                                                                | CLI it wraps                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Run: scenario, coach model and reasoning, simulator and reviewer models, scripted or live, number of sequential trials | `pnpm bench run [--scenario] [--scripted]` with `AGENT_MODEL`, `AGENT_REASONING`, `BENCH_SIMULATOR_MODEL`, `BENCH_REVIEW_MODEL` |
| Regrade a conversation, optionally with a different reviewer model, keeping both verdicts                              | `pnpm bench grade --run <id>`                                                                                                   |
| Calibrate the reviewer: split, fixtures, repeats, assert                                                               | `pnpm bench calibrate [--split] [--fixture] [--repeat] [--assert]`                                                              |
| Stop or reset the benchmark database                                                                                   | `pnpm bench stop`, `pnpm bench reset`                                                                                           |

- **Live view:** follow `progress.jsonl` and `state.json` as a stage timeline (coach turn, tool call, athlete reply) and stream the CLI's printed coach replies. When the run finishes, open its conversation view.
- **Cancel:** send SIGINT, which the CLI already handles by cancelling through the normal run lifecycle and keeping partial artifacts.
- **Cost:** estimate the cost before starting, from token usage in comparable past runs, and require confirmation before live provider calls.
- **Guardrails:** run one job at a time and show the existing `.bench/run.lock` state. Keep credentials on the server, read from the env file exactly as the CLI does; the browser never receives key values. Bind to loopback only. Record who started each run and from which revision.

## Data to add to the benchmark

Ranked by value for single-model verification and prompt comparison.

1. **Candidate prompt injection and prompt snapshots.** Runs record only a prompt version and hash, and candidate prompts are listed as future work in the benchmark guide. Add `--prompt-file` (or `AGENT_PROMPT_FILE`) and save the prompt text with each run, so the Compare view can show a prompt diff beside the change in behaviour. This unlocks real prompt comparisons.
2. **Experiment label, batch id and trial index**, for example `--label v4-one-question --trials 5`. Runs launched together group cleanly, and pass^k is computed exactly instead of inferred.
3. **Monetary cost.** Retain the cached-input and cache-write token breakdown so each run has a price, which enables a quality-versus-cost view.
4. **Simulator intent per athlete message** (`answer`, `generate`, `unknown`). It is recorded today only through fixed phrases in the rendered text.
5. **Per-model-call detail within a coach turn:** tokens, reasoning tokens and the tool chosen by each call. Per-call timings already exist; this explains slow turns.
6. **Reviewer variance.** Grade each run two or three times and keep per-criterion confidence. An unstable judge should not gate prompt changes.
7. **Broader scenarios and perturbations:** beginners, injury history, contradictory or changing answers, multisport athletes, missing information. Add **follow-up scenarios**, such as week-one feedback that requires an adaptation, because only plan creation is tested today.
8. **Richer plan-safety measures:** intensity distribution, rest days, long run as a share of weekly volume and acute-to-chronic load.
9. **Coach-authored reference plans** per scenario, so saved plans can be scored against a known-good answer.

## View ideas

- **Side-by-side conversations:** the same scenario under baseline and candidate prompts, aligned by turn, with a week-by-week plan diff.
- **Pairwise human review:** two anonymised plans, choose the better one or a tie. More reliable than absolute scores for prompt A/B decisions.
- **Blind review mode:** hide the model reviewer's verdict until the human verdict is saved, with keyboard shortcuts, to avoid anchoring.
- **Promote to fixture:** turn a reviewed real failure into a labelled calibration fixture.
- **Trend by revision:** score and failure modes over git revisions, marking prompt-hash changes, to catch regressions.
- **Failure themes:** group reviewer explanations and human notes into recurring themes.
- **Athlete's-eye preview:** render the saved plan as the app presents it.
- **Exportable report:** a static snapshot of a comparison to attach to the pull request that changes a prompt.

## Suggested order

1. Launch panel: run, regrade, calibrate and live progress (no benchmark changes).
2. Experiment labels, trials and prompt-file injection in the benchmark CLI.
3. Side-by-side conversations and pairwise review.
4. Blind review and promote to fixture.
