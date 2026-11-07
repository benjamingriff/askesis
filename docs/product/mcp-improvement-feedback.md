# MCP improvement feedback

Recorded: 2026-11-06. Status: parked for later; nothing here is scheduled.

The owner tested the development `/mcp` endpoint from Claude Code (Claude Opus 5.5) and asked it to build a 10K plan for an invented athlete and then review the experience. The agent wrote an eight-week plan (about 40 workouts, including a weekly club track placeholder, strength sessions and an A race) in about 16 tool calls, and every write saved without conflicts. This page records its review, grouped and lightly interpreted. The observations are the agent's own and have not been verified against the code. See the [MCP server plan](./mcp-server-plan.md) for the phases these would feed into.

## What worked

- `list_plans` returning today's date and timezone removed date mistakes.
- `expectedDraftId` and `expectedEditNumber` were easy to thread through, and atomic batches meant no partial writes to reason about.
- Naming zones (`easy`, `threshold`) and letting the API derive paces worked well; `preview_performance` is a useful dry run.
- Placeholders suit club sessions.
- Findings returned on every write, so validation problems surfaced without extra calls.
- The server instructions were thorough enough that no coaching rule had to be guessed.

## Where the time goes

Almost all of the agent's time went into writing the two `replace_schedule_range` payloads; the six-week one was about 180 steps and an estimated 60–70 KB of JSON. Reads were quick. An agent's output tokens are the slow part, so **payload size is what to optimise**. The agent estimated that a copy operation plus optional fields would cut what it writes for a full plan by around 80%.

## Suggested improvements

Ordered roughly by the agent's view of impact.

1. **Copy or template workouts and weeks.** For example `copyFromWorkoutId` plus a date, or `repeat_week(sourceWeekId, targetWeekIds)`. "Copy week 2 into weeks 3–7" was about 25 KB of near-identical JSON; it could be one small call.
2. **Make null and empty fields optional.** Every step currently needs all eight fields (`parentIndex`, `kind`, `repeatCount`, `role`, `label`, `instructions`, `completion`, `targets`), and every workout needs `description`, `purpose`, `racePriority`, `estimatedDistanceMetres` and `tags` even when empty. A 15-step strength session was a few KB and was written seven times.
3. **Nested steps.** A `children: []` tree instead of the flat `parentIndex` array, which the agent has to index by hand.
4. **A nested, compact `read_schedule`.** Today it returns related arrays (workouts, steps, completions, targets, tags) that the agent joins itself, with `plan_version_id` on every row. A nested workout view, and a compact mode with only titles, dates and types, would make reads cheaper and less error-prone. This is the Phase 2 compact read already in the plan.
5. **Patch blocks and weeks.** Changing one week's description meant resending its title, dates, position, block and week number. Accept an `id` plus only the changed fields.
6. **Keep fixed sessions through a range replacement.** `replace_schedule_range` deleted the race in its range; the agent re-sent it and it came back with a new lineage ID. If the athlete had logged against it, that link may break. Options: a `preserveWorkoutIds` list, or keeping lineage when a re-sent workout matches on date and title.
7. **Infer a workout's week from its date.** Each workout needs a `weekKey`, so week IDs have to be carried between calls; the server could assign the week containing the date.
8. **Quieter validation output.** The change summary lists every workout as added on every call (about 40 entries by the end), and empty-week warnings repeat on every write. A summary-only mode, or a diff against the previous validation, would reduce the noise.
9. **Guidance on batch size.** The guide says to write large plans in chunks, so the agent wrote two weeks first. An eight-week plan fits well within the batch limits (100 workouts, 2000 steps); the guidance could say to chunk only when a batch would exceed them.
10. **Show unwritten weeks in the app.** Empty weeks between written workouts and a distant race looked like a failure to the owner. Label them, for example "Week 3 – not yet planned", from the coverage data.

## Possible bugs to check

- `brief.schedule_may_be_stale` stayed after the whole schedule was rewritten following the brief change.
- Updating the brief marked existing coverage as not current, which left 2–5 Nov uncovered.
- Coverage was stored as two adjacent ranges (6–15 Nov and 16 Nov–27 Dec) rather than one merged range. Check the app shows a continuous span.
- The MCP surface said "Askesis". Fixed when the branch merged main's Waddle rename.
