# coachalytics

A local viewer for `pnpm bench` output: coaching benchmark runs and grader calibration suites. The visual language follows [Slopalytics](https://slopalytics.com): a near-black canvas, hairline rules, DM Sans, a tan accent, and a filter sidebar.

```sh
# Defaults to <repo>/benchmark-results
pnpm dev:evals

# Or point at another worktree's results
EVALS_RESULTS_DIR=/absolute/path/to/benchmark-results pnpm dev:evals
```

The dev server binds to `127.0.0.1:5179` (`EVALS_PORT` overrides it). A Vite middleware reads the results directory on each request and normalizes every run and `calibration-*` directory, so new runs appear within 15 seconds without a restart. Artifacts never leave the machine. There is no deployment; the static build only checks that the app compiles.

- **Overview**: quality score against coach tokens and wall time (Pareto line, linear/log), verdict mix, criterion pass rates and tokens by model and reasoning effort. Runs that stopped early are excluded from the quality scatters.
- **Conversations**: failure modes counted once per run across exact checks, the reviewer, transcript flags and your reviews; a discovery funnel; behaviour distributions; pass@1 and pass^k reliability; and a per-chat table.
- **Conversation view**: flags with links to their evidence, a session timeline (athlete, coach turns, tools, plan writes), the annotated transcript with a turn inspector (model calls, tokens, tool inputs and results, brief changes), the facts disclosed per message, what the coach recorded against what the athlete said, a decision log with field-level brief diffs, plan fitness (load against baseline, availability, time limits, closing-summary consistency, calendar) and the reviewer assessment with clickable citations.
- **Compare**: a baseline and a candidate cohort by prompt, model, reasoning, revision or scenario. Each metric has a 95% interval and is called better or worse only when the intervals separate. Prompt comparisons match on model and reasoning, and model comparisons on prompt, so other variables are held constant.
- **Grader**: your reviews against the model reviewer on real runs, plus calibration fixtures (agreement, missed defects, false alarms, fixture matrix and explanations).

## Conversation analysis

`server/session.ts` derives everything from the existing artifacts. Nothing extra needs to be recorded.

| Signal                                                      | Source                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Coach turns, latency, model calls, tokens                   | `snapshot.json` runs and outputs, joined to messages by `producingRunId`                                                 |
| Tool calls and their turn                                   | `tool-trace.jsonl`, grouped by `operationId` and attributed by `runId`                                                   |
| Facts disclosed per message, nudges, unanswerable questions | `disclosures.json` and the simulator's fixed phrases                                                                     |
| What the coach recorded, and when                           | Successive `update_plan_brief`, `create_plan_draft` and `record_performance` inputs against `scenario.json` expectations |
| Plan fitness                                                | `plan.json` workouts against the scenario baseline, available weekdays and time limits parsed from the availability fact |

**Assumed** means a value was saved in a turn before the athlete stated it. It may still be correct. Flags point at evidence and are not verdicts. When a run stops early, discovery flags are suppressed so the stop itself is the reported cause.

## Human review

The review panel on each conversation records a verdict (fit for purpose, needs revision, unfit), agreement with each model-reviewer criterion, failure tags and notes. It writes `human-review.json` in the run directory, and **Save & next unreviewed** steps through the queue. Reviews feed the failure modes, the Compare page and the Grader's human agreement.

The quality score is the share of deterministic checks plus reviewer criteria that passed. It is a convenience ranking, not the benchmark's `acceptable` verdict.

Scripted runs are hidden by default. **+ Demo models** adds seeded synthetic runs and a synthetic live-reviewer suite, so you can judge the comparison charts before several coach models have been benchmarked. Demo data is drawn hollow, labelled throughout, and never written to disk.
