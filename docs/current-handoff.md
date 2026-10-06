# Current agent handoff

**Updated:** 2026-10-06
**Current direction:** Continue developing the responsive web app, drawing selected features from the mobile prototype. Native integration is deferred.
**Delivery status:** Phases 1–7 are implemented. Phase 7 is merged into `main`; local validation and development account policy are verified. Hosted deployment and release walkthrough have not been verified in this documentation update.

## Current priorities

The owner will continue improving the web app until happy with it, choosing further features and interactions from the Expo dummy app in separate threads. Some prototype features are already implemented on the web. There is no fixed feature list established here; this thread changes documentation only. Preserve the mobile app as a reference.

The intended friends-and-family experience is the web app, including use in a mobile browser. Native integration has no scheduled next step and is not a prerequisite for sharing the web app with friends. This supersedes the native-first recommendation in earlier delivery records.

Phase 8 remains the release-readiness checklist for invitations: access restrictions, authorization verification, rate and spending controls, backups, privacy/data-removal procedures, and release smoke testing. These checks are not marked complete by the direction change. Phase 9 remains a post-alpha backlog to prioritize from usage. Markdown export remains removed from the product roadmap.

## Verified delivery and outstanding checks

- Phase 6 is complete and working, confirmed by the owner on 2026-10-06.
- Phase 7 completes reviewed lifecycle confirmations, library presentation, plan vocabulary, archive navigation and the private-alpha account policy. Recorded local checks passed 215 unit/component tests and 76 PostgreSQL tests plus version invariants; see the [closeout](./archive/phase-7/phase-7-closeout.md).
- The Phase 7 record reports Clerk development-instance self-deletion disabled for future accounts and both accounts existing at that checkpoint; this audit did not repeat the hosted read. Repeat the policy verification for the production instance when provisioning private alpha.
- Phase 7's hosted deployment and desktop/narrow-screen walkthrough remain unverified here. Check the live deployment before carrying historical “local only” statements forward as current status.
- An earlier checkpoint recorded an exposed Clerk development secret. Confirm rotation if still unresolved; record status only and never reproduce the value.

## Read before changing the relevant area

- [Documentation index](./README.md): current guides, ADRs and historical records.
- [V1 product plan](./product/v1-poc-development-plan.md): accepted behavior, release readiness and future scope.
- [Product contracts](./product/README.md): lifecycle, briefs/calibration, conversations, coaching and review.
- [Architecture](./architecture/README.md) and [ADRs](./adr/README.md): system boundaries, storage invariants and technical rationale.
- [Operations](./operations/README.md): local setup, Railway, worker recovery, live delivery, monitoring and backups.

## Non-negotiable architecture and product constraints

- PostgreSQL is the sole source of truth.
- Core plan data remains normalized rather than authoritative JSONB.
- Atlas exclusively owns schema migrations; deployed migrations are append-only.
- Only the core API may access PostgreSQL.
- Web public routes and worker internal routes reach the same authoritative domain services, using separate client contracts.
- Clerk identities remain separate from internal athlete UUIDs.
- Lazy provisioning must recover mappings after database resets.
- The agent worker receives no `DATABASE_URL` or `CLERK_SECRET_KEY`.
- Chat is the primary plan-editing interface.
- Agents cannot lock or unlock plans; both require human confirmation.
- Plan assumptions, calibration, zones, and workouts are versioned as one aggregate.
- Intended alpha is invitation-only and running-only; invitation restrictions still need release configuration/verification.
- No user-facing permanent deletion, plan sharing, or global athlete profile during alpha.
- Do not add development seed data to Railway.

## Historical evidence

The [delivery archive](./archive/README.md) contains completed-phase plans, investigations, checklists and validation. The [handoff history](./archive/handoff-history.md) preserves earlier deployment checkpoints and diagnostics. Their pending statuses and next-step recommendations describe the original checkpoint, not current priorities or fresh hosted-service verification.

Keep this handoff focused on current direction, verified status, outstanding checks and constraints. Update the relevant topic guide when behavior changes and preserve completed verification evidence in the archive. Do not place credentials, session tokens, database URLs or other secrets in docs, chat, logs or commits.
