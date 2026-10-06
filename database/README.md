# Database

PostgreSQL is the source of truth for Askesis plan data. Atlas owns the versioned database schema.

## Contents

```text
atlas.hcl       Atlas environment configuration
migrations/     Versioned schema migrations and checksum
seed/           Idempotent local-development seed scripts
fixtures/       Legacy source material retained for reference
```

The SQL seed is development-only. Files under `fixtures/` are not loaded directly and do not represent the production persistence model.

See [`../docs/operations/database-setup.md`](../docs/operations/database-setup.md) for local commands and [`../docs/architecture/storage-architecture.md`](../docs/architecture/storage-architecture.md) for the model rationale.
