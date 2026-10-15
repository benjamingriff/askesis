# Workout logs and feedback

Manual logs record what happened separately from immutable plan prescriptions. The accepted design and research are in [the proposal](./workout-log-and-feedback-proposal.md); the implementation covers its manual slices 1–3. Strava and automatic activity matching remain deferred.

## Using the feature

On **Today**, use **Done**, **Changed it** or **Skipped** once a workout's scheduled date arrives. Easy sessions take one tap; effort is optional. Key sessions, tests, races, changed/skipped workouts and unexpected effort open an optional feedback sheet after recording the status. Dismissing the sheet keeps that quick log.

The sheet records actual time/distance, performed date, session effort, body feel, contributing factors and a note. Additional questions follow the session type: intervals, long sessions, strength, bricks, tests and races. Done initially uses planned amounts as estimates, which can be corrected or cleared. Test/race results can be previewed and attached; updating fitness guides is a separate explicit confirmation.

**Edit** corrects a log; **Undo** or **Clear this log** removes it. These work while the plan is locked or unlocked and do not alter its version, content hash, confirmation or lock state. Archived plans retain read-only logs. **Training log** on the Plan page includes entries from earlier versions, even if their workouts were removed by a restore; those entries remain editable when the plan is unarchived.

**Save** stores feedback without invoking a model. **Save and talk it through** also sends a typed feedback reference to the plan's conversation. If chat is unavailable, the saved log remains and the conversation action can be retried. Messages retain the feedback as it was sent; the coach receives its current state and an explicit changed/cleared indicator.

**Not feeling 100%?** on Today and Plan records a short check-in and opens the same conversation. It includes a reason, duration, preferred adjustment, return style and relevant upcoming key sessions. Changing the prescribed plan still requires human unlock, review and lock. The coach prompt preserves past workouts and today's logged workouts when amending a plan; schedule-tool date enforcement is separate future work.

## Persistence and coaching

`workout_logs` are owner-scoped, keyed by plan and workout lineage. Initial creation requires the current locked schedule and a due date in the athlete's timezone. Corrections preserve the original prescription snapshot and work after restore/relock even if the lineage is no longer current. `athlete_check_ins` are athlete-owned and plan-associated. Feedback references are authorized against both the athlete and the conversation's plan.

The API calculates approximate planned effort from the prescription using per-step RPE or zone mappings and repeat/duration weighting. It returns unknown effort/load as null. Shared calculations serve list/detail reads, saved snapshots and summaries; recorded session load uses actual reported minutes × RPE. Athlete-wide coaching summaries include the last 14 days across plans. The worker can read logs and record explicitly reported training without unlocking a plan.

The migration adds nullable `session_type` to prescriptions and bumps the canonical hash calculation version to 8. Stored locked hashes remain untouched; schema-4 historical versions remain restorable. New coach prescriptions can set the type explicitly, and legacy workouts use a title-based fallback.

## Local example-plan demo

From this worktree, using Node 24 and the pinned pnpm:

```bash
pnpm install --frozen-lockfile
# Only for a fresh, unconfigured worktree:
pnpm dev:setup
pnpm example:seed --email askesis-verification+clerk_test@example.com

# This worktree is already configured and seeded:
pnpm dev
```

Open the Vite address printed by `dev:local` (this worktree uses `http://localhost:5825`). In another terminal run `pnpm --silent dev:login` and open its private `url`. Confirm the dedicated verification email in Settings before changing demo data. The three plans span twelve weeks from the previous Monday; inspect the selected plan's actual dates. Existing examples and saved logs are retained.

The generated local environment uses simulated coaching unless a real worker/provider has separately been configured. Logging, feedback persistence, result previews and conversation references use the real API and PostgreSQL in either mode. Simulated replies do not amend the plan. See [worker setup](../operations/phase-5-runtime.md) for real coaching.

Ctrl+C stops the foreground supervisor and its owned API, web and database processes while retaining database data. Use `pnpm dev:status` or `pnpm dev:stop local` to inspect or stop a managed session.

## Privacy and verification

Logs, check-ins, typed message snapshots and idempotency/tool receipts can contain health information. They are owner-only, kept out of live-event metadata and sent to the model only for the athlete's coaching runs. The forthcoming operator-assisted removal/export procedure must cover these records, message snapshots and receipts together; clearing a log does not rewrite immutable conversations or prior coaching evidence. No menstrual-cycle reason or activity import is included.

Regression coverage includes locked/unlocked correction, unchanged plan hashes, future-date rejection, restore/relock history, owner/conversation isolation, archived read-only behavior, safe retries, reference lifetime, worker context and deterministic effort/load calculations. Browser verification exercises desktop/phone logging, editing, clearing, reload, feedback conversations and check-ins on the real local example plans.
