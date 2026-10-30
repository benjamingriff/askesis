# 0008. Manual Strava activity links

**Status:** Accepted for the private alpha prototype. **Date:** 2026-10-16.

## Context

The owner wants to see what they recorded next to what was planned, starting with Strava. An earlier prototype ([#71](https://github.com/benjamingriff/askesis/pull/71)) synced activities into a seven-day cache and matched them to workouts automatically. Strava's [API Agreement](https://www.strava.com/legal/api) and [API Policy](https://www.strava.com/legal/api_policy) (effective 2026-06-01) shaped the next step:

- Strava data, including information derived from it, may not be used in AI applications or supplied to a model's context (§5.3).
- Cached Strava data may be kept for at most seven days (§6.2).
- Data must be deleted after the athlete revokes access (§7.4).

The owner chose a narrower design: no automatic matching. The athlete finds the activity, links it, and reads it beside the log form while filling in their own review. The owner has accepted the residual contractual uncertainty for a private alpha. A clarification request to developers@strava.com is recommended before inviting anyone else.

## Decision

- **Store only the link.** `workout_activity_links` holds the plan, workout lineage, connection and provider activity id. No activity fields, laps or raw responses are stored. The "View on Strava" URL is derived from the id.
- **Read details live, each time.** The picker lists the week either side of the workout from `GET /athlete/activities`. The log sheet's panel reads `GET /activities/{id}` when it opens. The browser keeps responses for five minutes at most and never writes them to the log.
- **The athlete is the only path from Strava to the log.** Nothing is pre-filled. The panel says: "Strava details are displayed temporarily for reference. Information you enter in your review is saved separately."
- **The coach is excluded.** Activity routes are user-only; no `/internal/agent` route, prompt or feedback snapshot includes a link or Strava value.
- **Links follow workout lineage**, like workout logs, so they survive unlock and relock. An activity belongs to at most one workout per plan. Deleted plans hide their links until restored; plan purge removes links and account purge also removes encrypted credentials. Data exports include metadata and links without credentials.
- **Disconnecting revokes the grant and cascades** to every link. A Strava account connects to one Askesis athlete. Tokens are encrypted with AES-256-GCM; refreshes take a row lock because Strava rotates refresh tokens.

## Alternatives

- **Seven-day cache with automatic matching** (#71). It would give richer adherence views, but stores Strava data, derives statuses from it and invites the question of whether the coach may see them. Deferred until a source without those restrictions exists (FIT/TCX upload, Garmin, Apple Health).
- **Pre-fill the log from the linked activity.** Rejected. It would copy Strava values into data the coach reads.
- **Keep links after disconnecting.** Rejected. The id is API-derived, and §7.4 expects deletion.

## Consequences

- Each picker or panel opening costs one Strava read against the app's 100 per 15 minutes and 1,000 per day. This is fine for a handful of athletes; wider use needs Strava's review and webhooks.
- Activities deleted on Strava leave a link that 404s. The panel says so, and the athlete can unlink.
- Whether a retained activity id, or values an athlete transcribes by hand, count as Strava Data remains unresolved. This design limits automatic copying; it does not settle that question.

## Evidence

[Migration](../../database/migrations/20261030130000_activity_links.sql), [integration service](../../apps/api/src/modules/activities/integration.service.ts), [link service](../../apps/api/src/modules/activities/activity-link.service.ts), [web components](../../apps/web/src/components/Strava.tsx), [database tests](../../apps/api/test/db/activities.test.ts) and [operations guide](../operations/activity-connections.md).
