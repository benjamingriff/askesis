# Architecture decision records

Keep ADRs together in this folder, with one numbered document per significant technical decision. The [architecture guides](../architecture/README.md) describe the system; ADRs explain why a particular approach was chosen and what trade-offs it creates. Product behavior, delivery plans and test checklists belong in their topic folders.

| ADR                                         | Decision                                                                 | Status                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [0001](./0001-application-stack.md)         | Initial React/Vite, Hono/OpenAPI, Kysely/Atlas stack and API boundary    | Partially superseded; worker/client and frontend-data choices updated by 0003 and 0004 |
| [0002](./0002-package-management.md)        | Pinned pnpm workspace management                                         | Accepted; separate mobile prototype uses npm                                           |
| [0003](./0003-coaching-worker.md)           | Private OpenAI Agents SDK worker with API-authorized domain tools        | Accepted; retrospectively recorded from Phase 5                                        |
| [0004](./0004-live-synchronization.md)      | TanStack Query with authenticated, replayable SSE notifications          | Accepted; retrospectively recorded from Phase 6                                        |
| [0005](./0005-athlete-owned-performance.md) | Athlete-owned, append-only performance calibration applied to every plan | Accepted; extended by 0006                                                             |
| [0006](./0006-multisport-plans.md)          | Multi-sport plans: cycling power, swim CSS and uncalibrated strength     | Accepted                                                                               |

## When to write an ADR

Write an ADR for a choice with lasting architectural consequences: service or authorization boundaries, persistence strategy, runtime/provider integration, deployment topology or synchronization mechanisms. Keep it focused on one decision; a small feature, layout adjustment or test addition usually belongs in an existing guide.

Include status, the decision date when known, context, the chosen approach, meaningful alternatives and consequences. Link the relevant contract and implementation evidence. For an already-implemented decision, label the record retrospective and distinguish the recording date from the original decision checkpoint.

When a choice changes, add a new numbered ADR and link it from the earlier record. Preserve the earlier rationale and mark the affected decision superseded or partially superseded. An accepted ADR records a decision; it is not proof that implementation or release verification has passed.
