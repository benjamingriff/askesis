# 0007. Activity ingestion and plan adherence

**Status:** Accepted for the MVP. **Date:** 2026-10-14.

## Context

Plans describe what an athlete should do; nothing recorded what they did. The owner wants activities from other platforms, starting with Strava, linked to the plan to show completed, missed, early and late sessions, rep-level compliance, and whether the athlete is ahead of or behind plan. Two constraints shaped the design:

- **Plan content is versioned.** Unlocking clones every workout into new rows. A workout's physical id therefore changes between versions, while its `lineage_id` is stable.
- **Strava's API Policy (effective 2026-06-01)** forbids using its data or anything derived from it in AI applications, including model context. It allows only a seven-day cache, requires reflecting deletions, and requires deletion within 30 days of revocation.

## Decision

- **A separate activity domain** (`integration_connections`, `activities`, `activity_laps`, `activity_match_overrides`). It never writes plan content, and plan versions never reference it.
- **Matching is a pure function computed on read** from the version's workouts, the athlete's activities, their decisions and today. Only the athlete's decisions are stored, keyed by plan and **workout lineage** (surviving unlock, edit and relock) and by provider activity id (surviving cache purges and re-syncs).
- **Strava data is a cache.** Each sync re-reads the plan window and deletes what Strava no longer lists. An hourly sweep purges rows not refreshed for seven days. Disconnecting revokes the grant and deletes everything by cascade. Only normalized summaries and laps are kept; no raw payloads, routes or streams.
- **The coach is excluded.** No activity or adherence data is exposed through `/internal/agent` routes or prompts. Coaching on actual training must use athlete-provided records (manual completion) or a provider without Strava's restriction.
- **OAuth completes through the web app** with the athlete's Clerk session and a signed, expiring state bound to the athlete. Tokens are encrypted with AES-256-GCM in the API. A Strava account can connect to only one Askesis athlete.
- **Rep checks from laps** use a dynamic-programming alignment of the expanded prescription with recorded laps, using duration or distance error and target-band intensity. Activities without usable laps report why instead of guessing.

## Alternatives

- **Store match results.** Rejected: plan edits, relocks and activity changes would leave stale links needing invalidation logic. Recomputing is cheap at plan scale (tens of workouts, tens of activities).
- **Link by physical workout id.** Rejected: links would vanish on every unlock and relock.
- **Keep Strava activities indefinitely as a training log.** Rejected: conflicts with the seven-day cache clause. A durable log needs a source the athlete owns, such as file upload.
- **Unauthenticated API callback route.** Rejected: it would need its own session binding. The web callback reuses Clerk and keeps the API's single authentication path.
- **Webhooks in the MVP.** Deferred: they need a public HTTPS endpoint and a durable event queue. Pull sync with a short auto-sync interval is enough to prove the experience.

## Consequences

Adherence is display-only for Strava-sourced data. A later provider can share the tables, with a per-source flag deciding what the coach may read. Matching runs per plan; one activity could count in two concurrently active plans until cross-plan matching is added. Strava's per-app rate limits cap how many athletes one application can serve without its Extended tier.

## Evidence

[Proposal](../product/activity-integration-proposal.md), [migration](../../database/migrations/20261013120000_activity_ingestion.sql), [matching](../../apps/api/src/modules/activities/activity.matching.ts), [effort analysis](../../apps/api/src/modules/activities/effort.analysis.ts), [integration service](../../apps/api/src/modules/activities/integration.service.ts), [database tests](../../apps/api/test/db/activities.test.ts) and [operations guide](../operations/activity-connections.md).
