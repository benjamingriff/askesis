# Operations guides

## Development and deployment

- [Local development](./local-development.md): web/API startup, agent sign-in and screenshot/video verification, background server lifetime, validation and generated types.
- [Complete multisport example](./example-plan.md): hosted owner, manual local seeding and preservation.
- [Database setup](./database-setup.md): Docker Compose, Atlas and development fixtures.
- [Railway deployment](./railway-deployment-plan.md): service topology, configuration, migrations and release checks.
- [Worker operations](./phase-5-runtime.md): credentials, provider configuration, limits, leases and failure recovery.

## Delivery and recovery

- [Live runtime](./phase-6-runtime.md): streamed output, replay, query invalidation, measurements and rollout order.
- [Backup and restore](./database-backup-and-restore.md): manual fallback, restore verification and hosted-backup requirements.
- [Observability](./observability.md): logs, request correlation, Sentry and redaction.
- [Example queries](./example-queries.md): inspecting plans, prescriptions, totals and athlete calibrations.

Runtime guides retain their phase names because they describe the deployed mechanisms introduced in those phases. Their historical acceptance notes do not establish current release readiness. Consult the [current handoff](../current-handoff.md) and [Phase 8 checklist](../product/v1-poc-development-plan.md#phase-8-friends-and-family-release) before invitations; consult the [archive](../archive/README.md) for past validation evidence.
