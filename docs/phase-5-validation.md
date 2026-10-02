# Phase 5 live validation — 2 October 2026

Validated the local Compose app at `http://localhost:8080` using the signed-in
collaborative browser, the real OpenAI worker, and read-only PostgreSQL assertions.
The worker used `gpt-6.1-sol`, medium reasoning and `running-coach-v2`.
All training details and feedback below are synthetic.

## Test artifacts

- Plan: **Phase 5 validation — comfortable 10K**,
  `6854b9a0-36f6-40e2-b6d9-f1bc2611e396`.
- Planning conversation: `3765800b-2dcb-46d3-a2f5-8cca0d04541d`.
- Standalone methodology conversation: `118eee3e-b3a2-4cd7-836c-649d905cad10`.

The test plan remains inactive in the library. Its three locked versions preserve
12, 24 and 30 workouts respectively. The temporary date-edit draft was discarded.
The user's existing active plan was not switched or edited.

## Results

| Check                         | Observed result                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live provider smoke           | Passed: one tool call and the expected final answer.                                                                                                                                                                 |
| Initial discussion            | Asked about current running; did not create a plan or schedule on the opening turn.                                                                                                                                  |
| Planning assumptions          | Saved 20 km/week, three runs, an 8 km longest run, Europe/London, kilometre units and Tuesday/Thursday/Sunday availability.                                                                                          |
| Goal-date conflict            | Noticed that 31 March 2027 is an unavailable Wednesday and clarified whether it was a race or goal date.                                                                                                             |
| Natural generation            | Generated after the runner agreed with the approach and supplied a provisional pace; no generation button was required.                                                                                              |
| Estimated pace                | Saved 5:30/km as `user_estimate`, with an explicit basis and no measured result. The reply and review UI explained the estimate and the need to revise after a few runs. Age was not used as measured pace evidence. |
| First horizon                 | Saved 12 workouts for 1–28 January, with distance completions, easy-zone targets and instructions. Overall plan dates remained 1 January–31 March.                                                                   |
| Partial lock                  | Human confirmation and warning acknowledgement successfully locked version 1 while February and March remained unplanned.                                                                                            |
| Locked-plan protection        | A request to extend the locked plan produced an explanation to unlock first and saved no changes.                                                                                                                    |
| Feedback and extension        | After human unlock, preserved the first 12 workouts and added 12 through 25 February. Did not infer a new threshold pace from easy-run feedback.                                                                     |
| Revision preservation         | Locked version 2; version 1's original content hash remained unchanged.                                                                                                                                              |
| Cancellation                  | Stopped a weekly-batch extension after two batches. Six new workouts remained saved through 11 March; intended horizon stayed 26 February–31 March.                                                                  |
| Interrupted generation review | Chat and lock review both displayed unfinished generation, prescribed-through 11 March, and the remaining gap. Human acknowledgement allowed locking that partial content as version 3.                              |
| Date boundaries               | Shortening a new draft to 25 February removed later coverage and blocked locking because later blocks, weeks and workouts remained. Discarding that draft restored locked version 3.                                 |
| Standalone discussion         | Explained that this build has no web search; did not claim to have checked latest research or create a plan.                                                                                                         |
| Saved workout integrity       | All 24 workouts in version 2 had distance completions and purposes. None fell on unavailable days.                                                                                                                   |

Worker downtime also passed after the UI correction: once readiness expired, the
live API returned `executionAvailable: false` with `mode: agent`. The UI showed
the unavailable notice, preserved history and the typed question, and disabled
Send. After restarting the worker, availability and Send recovered, the notice
disappeared, and the unsent text remained intact. The test text was then cleared.

The six completed coaching runs had no failures. One further run was deliberately
cancelled. The initial four-week generation took 92 seconds; the four-week
extension took 105 seconds. Short discussion replies took 5–19 seconds.

## Follow-ups

- Fixed the hard-coded **Askesis · test reply** label to **Askesis**, rebuilt the
  local web container, and verified the corrected label in the browser.
- Fixed the offline notice to use `executionAvailable` rather than the configured
  mode. Agent mode remains configured when a worker is offline. A regression test
  verifies that history and an unsent question survive downtime and that sending
  becomes available again on recovery.
- Assistant Markdown is currently displayed as plain text, including emphasis,
  headings and pipe tables. Add safe Markdown rendering for readable coaching
  replies; this remains outstanding.
- Generation latency is noticeable. Week-by-week saves expose useful progress,
  but the UI would benefit from clearer progress feedback while waiting.

## Automated verification

- `pnpm smoke:agent:live`: passed with `gpt-6.1-sol`.
- `pnpm test`: 75 tests passed (11 worker, 31 API, 33 web).
- After the UI corrections: all 34 web tests passed, formatting and ESLint
  passed, and the Docker web production build passed.
- Public local API health returned 200; unauthenticated chat capabilities returned
  401; the public proxy returned 404 for the internal agent route.

This is a live acceptance sample, not a guarantee of all possible model responses.
It does not validate a Railway deployment, medical advice, wearable ingestion or
web-search results.
