# Architecture guidance

- [Database and coaching visual guide](./visual-guide.md): relationship diagrams, endpoint-to-table map, workout creation, batching and improvement options.
- [Repository and services](./repository-and-service-architecture.md): core API ownership, web/worker boundaries and deployment direction.
- [Data model](./data-model.md): plan hierarchy, workout trees, targets and athlete calibration.
- [Storage architecture](./storage-architecture.md): relational persistence and table design.
- [Plan-version schema contract](./phase-2-schema-contract.md): ownership, immutability, identity and transaction invariants.
- [Brief and athlete calibration schema contract](./phase-3-schema-contract.md): confirmation, the athlete timeline, timezone and pace resolution.
- [ADRs](../adr/README.md): the rationale behind significant technical choices.

The guides carry their own verification dates; the visual guide traces the database and coaching flows checked on 2026-10-14. Earlier proposed storage/routes remain only in the explicitly historical delivery archive. Migrations, runtime schemas and generated OpenAPI are the executable contract.

PostgreSQL is authoritative for core domain state. Atlas owns migrations; only the core API receives database credentials. Web and worker clients use authorized domain operations through the API. Core plan content stays relational, including immutable revisions.
