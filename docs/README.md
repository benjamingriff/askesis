# Askesis documentation

Start with the [current handoff](./current-handoff.md) for priorities and verified delivery status. The current direction is continued responsive web development, drawing selected features from the mobile prototype; native integration is deferred.

New to the codebase? Follow [Understand Askesis in one day](./learning/README.md), an eight-hour checklist with source traces, TypeScript explanations, SQL exercises, coaching internals and deployment inspection. Keep its navigation map for finding code after the walkthrough.

| Area         | What belongs here                                                        | Start here                                     |
| ------------ | ------------------------------------------------------------------------ | ---------------------------------------------- |
| Product      | Roadmap, behavior contracts, pace policy and interface guidance          | [Product index](./product/README.md)           |
| Architecture | Service boundaries, persistence and schema invariants                    | [Architecture index](./architecture/README.md) |
| Operations   | Local setup, deployment, worker recovery, backups and monitoring         | [Operations index](./operations/README.md)     |
| ADRs         | Significant technical choices, rationale and superseding decisions       | [Decision index](./adr/README.md)              |
| Archive      | Completed-phase delivery plans, investigations and verification evidence | [Archive index](./archive/README.md)           |

## Reading and maintaining these docs

Use the handoff for next-work priorities, topic guides for current behavior and procedures, and ADRs for why an architectural choice was made. Completed-phase documents retain their original checkpoint status; an old “pending” or “not deployed” statement is not a current task or hosted-service assessment.

Product and schema contracts retain phase filenames but now describe current implementation. The [document-by-document audit](./archive/documentation-audit-2026-10-06.md) records evidence, corrections and limits. Migrations, runtime schemas and generated OpenAPI describe the executable contract.

Keep the handoff short: current direction, delivery summary, outstanding checks, constraints and reading links. Move completed checkpoint evidence into the archive. Update topic guides when behavior changes, and add an ADR when a significant technical decision changes boundaries, storage, deployment or runtime strategy. A feature specification or test checklist does not need its own ADR.
