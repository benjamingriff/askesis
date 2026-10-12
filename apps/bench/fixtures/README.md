# Grader calibration fixtures

These twelve synthetic cases test the existing plan reviewer directly. They do not run a coach, API, database or deterministic plan checks. A model reviewer missing an unavailable day remains visible even if the end-to-end benchmark's code check would catch it.

`running-base.json` is selected evidence from the successful synthetic `running-poc` run on 9 October 2026. It contains a four-week draft and conversation, not credentials or production athlete data. The athlete's third message was deliberately extended to explicitly state comfortable completion with no finish-time target. This removes the original goal ambiguity from the positive control. Dates are fixed so repeated tests use identical evidence.

`calibration.json` contains the descriptions, split and expected findings. `src/fixtures.ts` clones the base and makes the named mutation. The resulting inputs and expected labels are saved separately for every suite run. The reviewer receives only the same selected plan, conversation, performance and disclosed fact IDs as ordinary grading; fixture names, mutation descriptions, split and expected labels are withheld.

Labels are **provisional engineering labels**, authored for this proof of concept. They are not independent expert coaching judgments. Inspect and refine them before using agreement as a release threshold. Deliberate defects are extreme or directly contradict the evidence; the suite does not establish a universal progression rule or preferred coaching methodology.

The positive controls accept both kilometre-based and time-based prescriptions, including an explicit duration preference that is respected. An unlocked draft and unprescribed later weeks are intentional. The unsupported-goal case asserts a false claim of athlete confirmation; it is not simply a coach choosing an explained conservative default. Other cases target availability, a large load jump, an incomplete prescription, ignored duration preference, contradictory saved/claimed workouts, a time-limit violation, a missing plan and rubric injection.

Only specified criteria are scored. Other findings remain in the saved review without being automatically treated as false alarms, because a mutation can affect several criteria. Expected `fail / uncertain` means either flag is accepted for that label; an overall acceptable verdict still disagrees. For missing prescriptions, either `needs_revision` or `incomplete` is accepted, but the prescription defect must be found.

Eight development cases are selected by default. Four holdout cases can be run explicitly after tuning; avoid adjusting prompts against their results if you want them to remain a useful holdout. New fixture evidence, labels or mutations require incrementing the suite version. Each manifest also records hashes of resolved inputs and labels, the reviewer prompt, and the Git revision.

```sh
pnpm bench calibrate --list --split all
pnpm bench calibrate
pnpm bench calibrate --split development --repeat 3
pnpm bench calibrate --split holdout --repeat 3
pnpm bench calibrate --split all --fixture unconfirmed-goal
```

See [the operator guide](../../../docs/operations/training-plan-benchmarks.md#validate-the-grader-with-fixed-fixtures) for configuration, output files, exit semantics and an offline wiring check.
