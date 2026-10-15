# Placeholder sessions

A placeholder is training the coach books into a plan without prescribing it, because someone else decides what it will be: a club run or track night, a group ride, a masters swim, a class, or a sport the plan doesn't train, such as 5-a-side football. The coach plans the rest of the week around it. Afterwards the athlete logs what it turned out to be.

## Owner decisions (2026-10-15)

- **Chat only, no forms.** The athlete says something like "I've got track every Tuesday" and the coach handles the rest. It notes the commitment in the brief's free-text context and places a placeholder on each occurrence. There is no structured "regular commitments" field in the brief.
- **Other activities use the `other` discipline.** The title says what the activity is. Like any placeholder it has a duration and an RPE range, so it counts towards load.
- **No details in advance.** A placeholder stays a placeholder. To turn one occurrence into a prescribed session, the athlete asks the coach. The coach rewrites that workout through the normal unlock → draft → review → lock flow. Details of what actually happened always go in the log.

## How it works

| Stage    | Behaviour                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking  | The coach writes a workout with `placeholder: { minimumRpe, maximumRpe }`, no steps, an `estimatedDurationSeconds` and the `sessionType` it is assuming. It explains the assumption in `purpose`, e.g. "Track nights are usually intervals; treated as this week's quality session".                                                                                                           |
| Storage  | `workouts.placeholder` is true. The API writes a single root effort: a duration completion plus an RPE range target. Planned effort (range midpoint), weekly volume, the content hash and validation all treat it as an ordinary workout. A placeholder must have a duration (database check).                                                                                                 |
| Planning | The coach counts placeholders towards volume, session frequency and the two-sessions-a-day limit. It plans around the **top** of the RPE range: easy days either side and no hard lifting next to it. When a placeholder supplies the week's quality work, it becomes the key session rather than an addition.                                                                                 |
| Display  | Cards have a dashed outline and a **Placeholder** badge, with meta such as "~1h 15 · RPE 5–8". Other activities read **Other activity**. The Today hero and the workout dialog show an expected-effort band instead of an effort profile. The dialog explains what the coach assumed.                                                                                                          |
| Logging  | Done/Changed always open the feedback sheet. It asks **What was it?** (recovery, easy, steady, long, threshold, intervals, speed, race, test, strength, mobility or brick) and **What did you do?** (the note). Follow-up questions match the answer, so choosing Intervals asks how the reps went. The log stores `actual_session_type` and a `placeholder` snapshot; plans are never edited. |
| Coaching | Summaries add `placeholderSessions` and `harderPlaceholderSessions` (RPE two or more above the expected midpoint). "High effort on easy sessions" uses the actual type. The coach judges load from what happened. If placeholders keep turning out harder or different than assumed, it offers to update the assumptions for upcoming placeholders.                                            |

`actualSessionType` is accepted only for placeholder logs that weren't skipped; the API and a database check both enforce this. Log snapshots saved in conversations before this change still parse, with `placeholder: false`.

## Contract changes

- Coach prompt version `coach-v1`. Workers and the API must be deployed together.
- `apply_schedule_changes` and `replace_schedule_range` accept `placeholder` on workouts. Prescribed workouts still need at least one step.
- `WorkoutSummary` gains `placeholder` and `expectedRpe`. `WorkoutLog` gains `placeholder` and `actualSessionType`. The training-log summary gains the two placeholder counts.
- The canonical content hash version is now 9, because workouts carry `placeholder`. Stored locked hashes are left untouched.
- The triathlon example plan books a **Wednesday run club** placeholder (RPE 4–7, assumed steady) in place of the midweek easy run.

## Demo

Seed the examples (`pnpm example:seed --email askesis-verification+clerk_test@example.com`) and open the triathlon plan. Wednesdays show the run club placeholder. On Today, select a past Wednesday and choose **Done**, then **What was it?** → Intervals. Save, and the card reads "Was intervals".

Browser evidence from the local preview is in [placeholder-sessions-evidence](./placeholder-sessions-evidence/).

## Not included

- Structured recurring commitments in the brief (rejected in favour of chat).
- Pre-session details on a placeholder (rejected: convert the occurrence instead).
- Automatic matching of imported activities, which waits for Strava import.
