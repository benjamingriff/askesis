# Phase 6 runtime and delivery

The responsive web client now reviews live coaching beside the saved plan. Expo
remains a reference prototype. The implementation keeps the Phase 5 model,
reasoning, prompt and domain tool contracts.

## Delivery and recovery

The worker consumes the pinned Agents SDK's streamed response. Only visible text
is stored. Output snapshots have stable item IDs, order and increasing revisions;
intermediate commentary and the final reply remain separate. Snapshots flush at
400 ms or after a large chunk, before tools and on completion/interruption. A slow
write applies backpressure. Transport retries reuse the exact batch identity: a
network error, 5xx or 429 retries the same batch with exponential backoff for up to
30 seconds, while a rejection, lost lease, timeout or shutdown fails at once. The
timing summary is written last and best effort; it never fails a delivered reply.

Presentation is bounded to 100 items, 32,000 UTF-16 code units per item and 64,000
per run, with Unicode-safe truncation. A final reply retains the existing 32,000
limit. Truncation is explicit. An execution that cannot represent its final reply
within the total presentation limit fails with `OUTPUT_LIMIT`, retaining accepted
text. Progress is limited to 4,000 batches. Provider reasoning, tool arguments and
complete tool responses are never included in live activity.

Every worker write is fenced by the current run credential, lease and deadline.
Cancelling permits a final text flush but no new tool activity or plan mutation.
Terminal output cannot grow or be rewritten. Completion atomically marks the final
segment, appends one assistant message and ends the run. The same finish request
can safely be delivered again; a conflicting payload is rejected.

The owner-scoped PostgreSQL journal emits resource identifiers, never text or plan
payloads. Deferred triggers allocate an owner-local cursor after domain work, so
later-committing transactions cannot be skipped. Notifications coalesce within a
transaction. Event types are `plan.changed` (plan and version rows),
`conversation.changed`, `message.changed`, `run.changed` (status, plan binding,
edit and generation progress), `activity.changed` (tool events) and
`output.changed`. Tool activity and text therefore never refresh plan reads.

Each owner's replay retains at most roughly 10,000 events; every 100 new events
also prunes entries older than seven days. Owner cursors are contiguous, so a
future cursor or a gap after the client's cursor resets the browser to
authoritative reads. Output and saved change cards survive replay pruning. A
stream polls the journal every 750 ms and sends a heartbeat after 15 idle seconds.

Each signed-in tab fetches `/api/v1/live/bootstrap`, reconciles its mounted queries,
then subscribes to `/api/v1/live/events` using an Authorization header. Connections
last at most 45 seconds and reconnect with a fresh Clerk token. Sign-out/account
change aborts reads and discards the account's cache/cursor. Network failure uses
backoff with jitter; while disconnected, active chat and plan reads refresh every
3 seconds instead. Returning to the tab or regaining the network reconnects at once
and replays from the cursor rather than refetching every read. Reconnecting never
sends a chat message or restarts provider work. Nginx disables buffering/cache and
uses a 75-second read timeout.

## Saved changes and review

`GET /api/v1/plans/:planId/draft/changes` compares the current draft with the current
locked version in one repeatable-read snapshot. Lineage identifies cloned workouts;
changed prescription and changed date are separate. Removed workouts remain in the
summary. Assumption and calibration changes are reported separately.

Each successful mutating tool receipt stores an immutable before/after summary in
its transaction, with the identity and change of every affected workout and a
shortened title, so a run's operations combine exactly at any size. If a summary
would approach its 4 MiB column bound, titles are dropped before any identity;
only an operation affecting many thousands of workouts then keeps as many identities
as fit, with complete counts. Storage never rejects a valid schedule write. Responses list the first 50 workouts
with complete counts; the current draft comparison retains all highlights.

`GET /api/v1/conversations/:conversationId/runs` returns turns: each run with its
tool activity, one net saved-change summary and any visible text that is not the
durable reply (intermediate commentary, or interrupted output). The page is read
with a fixed number of queries, however many runs it holds.
`GET /api/v1/agent-runs/:runId/turn` returns the same projection for one run, and
the browser reads it only while that run works. A run's summary combines its
operations by workout lineage in commit order: a workout added and removed by the
same run disappears, repeated edits count once, a move keeps its original date,
and a workout moved away and back without other edits has no net change. Legacy
turns have a truthful generic saved-change indication.

Chat history joins turns to their user messages and replies. Each turn renders as
one assistant block: activity, intermediate text, the reply and a "Plan draft
updated" card linking to plan review. Streamed text stays in place when the durable
message replaces it. Failed/cancelled turns recover accepted text with an incomplete
label. Presentation snippets are not sent to the model as completed assistant
answers.

The existing PlanView, schedule and lifecycle dialogs are reused in the panel,
embedded with a compact heading, the draft change summary first and lifecycle
actions in a sticky footer. Coach shortcuts in the panel fill the current chat's
composer instead of opening the plan's most recent chat. From 1,450 px the plan
sits beside the chat (the chat keeps the larger share) and can be hidden; below it
Chat/Plan tabs sit under the conversation header, with a pending-change count.
Switches hide views without discarding composer, reading position or review state.
Saved edits advance version-aware reads while keeping an open workout selected;
removing it explains the removal and returns to the schedule. Human forms retain
their original review/concurrency baseline and offer explicit refresh.

## Measurements

The owner-authorized output read includes a bounded timing summary:

| Field                                        | Meaning                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `queueWaitMs`                                | API timestamps from acceptance to claim                                             |
| `firstVisibleMs`                             | Worker duration to its first visible model delta                                    |
| `firstDurableOutputMs`                       | Worker duration to the acknowledgement of its first saved output batch              |
| `modelMs`                                    | Per-request stream duration, including transport and SDK consumption                |
| `toolMs`, `toolCalls`, `toolMsTotal`         | Tool HTTP durations; up to 200 individual samples, with full count/total            |
| `firstSavedBatchMs`                          | Acknowledgement of the first successful schedule tool command                       |
| `progressWriteMsTotal`, `progressWriteMsMax` | Progress delivery durations, including retries, before the measurement write        |
| `totalMs`                                    | Worker runtime through final visible-output flush, before measurement/finish writes |
| `executionMs`                                | API timestamps from claim to terminal transition                                    |

Acknowledgement times are upper bounds on commit time. Model/tool categories can
overlap and are not an additive CPU breakdown. They do not measure browser paint.
No output/tool sample is invented when a category was not observed. Provider
failure can lack final token usage. Worker loss retains accepted output but can
lack a final timing summary.

Model, provider, reasoning, prompt version and completed token usage already live
on `agent_runs`. Correlate them with `agent_run_measurements` using run ID. Existing
worker logs contain run ID and bounded status/failure codes; do not log text,
prompts, provider exceptions or tool payloads to collect timing evidence.

## Rollout order

1. Apply the additive `20261005120000_live_coaching.sql` migration.
2. Deploy the API, checking `/api/ready` against that migration.
3. Deploy the worker, then the web app with the same API origin/proxy.
4. Verify signed-in SSE delivery/reconnect through Railway, saved edits before
   final completion, Stop/reload recovery and a second session's edits.

Old workers can finish against the new API; their turns have no streamed output.
New workers require the new progress endpoint. Keep the new API/schema when
rolling back only web/worker behavior. Do not drop delivery/history tables as an
application rollback. No hosted rollout is included in this PR.
