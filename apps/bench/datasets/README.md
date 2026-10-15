# Versioned athlete datasets

The first dataset edition is `v1`: seven synthetic personas, eight conversation-to-plan scenarios and an eight-case pilot suite. All authored cases are exploratory. The [coverage tracker](./COVERAGE.md) lists the full 61-case catalogue and the work still needed.

These files are inputs for the [athlete evaluation proposal](../../../docs/product/athlete-scenario-evaluation-proposal.md), not saved workout plans or training recommendations. Every authored scenario runs with `pnpm bench run --scenario <id>`, and `pnpm bench run --suite pilot-v1` runs the pilot in order; see the [benchmark guide](../../../docs/operations/training-plan-benchmarks.md). No provider calls or application mutations are made by the dataset commands below.

```sh
pnpm --filter @askesis/bench datasets:validate
pnpm --filter @askesis/bench datasets:list
pnpm --filter @askesis/bench datasets:coverage
pnpm --filter @askesis/bench datasets:coverage:update
```

`datasets:list` shows authored/planned status and runner support separately. `datasets:coverage` prints the tracker; `datasets:coverage:update` writes it. Validation is also exercised by the benchmark package's tests.

## Files

| File                                       | Purpose                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [v1/personas](./v1/personas)               | Athlete fact sheets: per-sport experience and recent capacity, availability, equipment, preferences, evidence and communication style.                  |
| [v1/scenarios](./v1/scenarios)             | Tasks referencing exact persona versions, with opening messages, overall/detailed horizons, event dates, required facts and provisional review anchors. |
| [pilot-v1.json](./v1/suites/pilot-v1.json) | Ordered selection of seven sport cases and the matched annual hybrid case. Fix simulator/reviewer configurations for comparative experiments.           |
| [catalogue.json](./v1/catalogue.json)      | Source of truth for the 28 persona families, 61 scenarios, reserved families and follow-on execution probes.                                            |
| [COVERAGE.md](./COVERAGE.md)               | Generated readable checklist. Edit the catalogue and regenerate rather than checking items manually here.                                               |

The seven sport cases are `running-improver`, `cycle-beginner`, `triathlon-intermediate`, `swim-beginner`, `strength-beginner`, `gym-experienced` and `hybrid-improver`. `hybrid-improver-annual` reuses the same hybrid persona and changes twelve weeks to 52 weeks, while both require only four weeks of detail. It is D05 in the duration catalogue, not a ninth persona or an extra case beyond the 61.

`running-improver` was authored from the retired `running-poc` scenario, which has been removed along with its running-only runner path. Earlier `running-poc` artifacts stay readable in the dashboard but cannot be regraded, because their checks and simulator differ.

## Voices

[voices](./voices) holds athlete speaking styles, versioned independently of dataset editions so any voice can be combined with any scenario (`--voice terse`). A voice changes wording and manner only: the simulator still selects persona facts, and the runner rejects voiced replies whose numbers, dates or weekdays differ from the selected facts. Examples show manner only and must not contain figures. The default voice is the persona's own `communication.style`.

## Facts and information boundaries

Keep quantities in canonical units: run/swim metres, cycle seconds, session counts and evidence seconds/watts. A known zero baseline is `0`; an explicitly unknown numeric baseline is `null`. Whether a known private fact is still unanswered belongs to the disclosure ledger, not to its numerical value.

Swimming's longest session distance includes its sets and rests; comfortable continuous swimming distance is a separate optional capability fact. The beginner fixture has a 300-metre session made up of shorter swims, with 100 metres comfortable continuously. Do not substitute continuous distance for the brief's longest-session baseline.

Facility access has structured sports, weekdays and time caps in `accessRestrictions`. Daily budgets are combined budgets across workouts. A brick is one scheduled workout with two sport exposures; `frequencyPolicy` makes this distinction explicit. Strength has no performance-zone calibration. Unknown endurance fitness remains unknown until the coach proposes an honestly labelled estimate; the fact sheet does not seed guessed measurements.

`factTemplates` render from structured values. For example, `{{runWeeklyKm}}` comes from `weeklyDistanceMetres / 1000`; `{{availability}}` comes from weekday slots; evidence dates come from `observedDaysAgo` against the resolved clock. Rendering rejects missing and inherited placeholders. Goal, date and horizon facts belong to the scenario and cannot be overridden by persona templates.

Communication styles describe the authored wording. They do not permit the simulator to rewrite facts freely or infer capacity from terminology. The runner selects approved fact IDs and retains an explicit disclosure ledger. `openingFactIds` identifies the facts conveyed by the opening request; each pilot opening explicitly states its creation request and initial detailed horizon.

`resolveDatasetScenario` accepts an explicit date and returns synthetic facts plus private authoring metadata for inspection and execution. That entire object must never be sent to the coach. Only the rendered opening/selected fact messages are coach-visible. Persona facts and disclosure policy are simulator-private; `expectations` and review anchors are evaluator-private. Do not prefill hidden baselines into the production brief or supply grading anchors to the simulator.

Dates resolve to the next Monday in Europe/London, including when the clock is already Monday. An experiment must resolve dates once for all candidates and align domain performance operations to the same clock. Weeks are whole-week authoring intervals; 52 weeks is an annual approximation, not an exact calendar year.

## Add a reviewed combination

1. Select a planned item in `catalogue.json`. Reuse a persona when only the task/span changes. For a controlled variation of that family, use the scenario's typed `personaOverrides`; author a new persona file for a new core family.
2. Copy an appropriate fact sheet or scenario. Keep a stable ID, assign the content version and use only fields accepted by [datasets.ts](../src/datasets.ts). Do not leave placeholders for unresearched facts; mark genuinely unknown numeric data as `null`.
3. Reference the exact persona version. Set explicit overall/prescribed weeks, available outcomes, disclosure requirements and provisional review anchors. Required-discovery IDs must exist among rendered facts.
4. Set the corresponding catalogue entry to `authored`, with its relative file path and version. Mark `runnerSupport: supported` after verifying execution; this status is independent of whether a file exists.
5. Add the scenario/version to a suite only when it belongs to a development family. Close derivatives of reserved families retain the holdout split and cannot enter the pilot.
6. Validate, regenerate coverage and review the resolved wording against the structured facts. Training-quality anchors stay provisional until reviewed against actual outputs and calibration examples.

Do not create all combinations mechanically. Change one main factor for controlled comparisons, and label composite life situations as such. Speech styles, experience, recent capacity and duration can vary independently; a large cross product would add cost without guaranteeing useful coverage.

`personaOverrides` can replace age, experience, communication, sport baselines, availability, facility restrictions, equipment, constraints, preferences, evidence or fact templates. Entire fields/arrays are replaced, not recursively merged; the base persona ID/version stays pinned and unchanged. For example, `"personaOverrides": { "age": 60 }` creates an age-only control while the templated age disclosure updates automatically. Changed baseline values also update their templated disclosures. Review the scenario's expectations when creating a variant: grading anchors do not automatically rewrite themselves to match a changed baseline.

## Versioning and review

`schemaVersion` identifies the authoring contract; each persona/scenario/suite also has a content `version`. Suite and persona references pin exact versions. Catalogue records pin file paths and content versions; validation rejects mismatches, duplicate IDs, missing assets and untracked files.

Treat a published dataset edition as frozen. For changed facts, openings, constraints or grading anchors, create a new edition directory, bump changed content versions and update explicit references. Preserve the old edition for comparisons and record source hashes in run artifacts. The initial commands target edition `v1`; further editions will need explicit selection support. Wording changes are experiment input changes, even when the numerical facts stay the same.

Authored means a concrete, structurally valid data file exists. It does not mean the case has run successfully or that a coach/human has calibrated its labels. Owner review, live run evidence and grading calibration remain separate tasks in the tracker. Preserve valid alternative training approaches and disagreements rather than treating the first model verdict as ground truth.

No model matrix is committed with guessed model IDs. The pilot suite declares that simulator/reviewer configurations must be fixed, and execution uses the coach and evaluator settings described in the benchmark guide.
