# Product guidance

The owner is continuing development of the responsive web app and will choose further features from the mobile prototype in separate threads. Native integration is deferred. The [current handoff](../current-handoff.md) records the latest priorities; the [V1 development plan](./v1-poc-development-plan.md) retains the broader roadmap, including Phase 8 release readiness and the Phase 9 backlog.

## Behavior contracts

- [Plan lifecycle](./phase-2-plan-lifecycle-refinement.md): drafts, immutable revisions, activation, archive and human review.
- [Plan brief and athlete training zones](./phase-3-plan-brief-and-calibration-refinement.md): plan-specific context and per-sport baselines, confirmation and athlete-owned, effective-dated zones for running, cycling and swimming shared by every plan.
- [Conversations and runs](./phase-4-design.md): ownership, durable messages, cancellation, archive and concurrency.
- [Coaching and domain tools](./phase-5-design.md): conversational generation, worker permissions and partial planning horizons.
- [Live coaching and review](./phase-6-design.md): streamed replies, saved changes, human review and interrupted-output recovery.
- [Phase 7 refinements](../archive/phase-7/phase-7-closeout.md): confirmed defaults and management-control closeout.

These guides describe implemented behavior and were reconciled against code on 2026-10-06. Phases 1–7 are implemented; release-readiness tasks and future ideas are explicitly labelled in the product plan. Original design/delivery checkpoints remain in the archive.

## Interface and pace policy

- [Web design system](./web-design-system.md): themes, components, navigation and review patterns.
- [Running pace calculation](./run-pace-v1.md): equations, coefficients and range policy.
- [Cycling power zones](./cycle-power-v1.md): FTP protocols and Coggan zones.
- [Swim pace zones](./swim-css-v1.md): the critical swim speed test and zone bands.
- [Mobile reference prototype](../../apps/mobile/README.md): the dummy app used as a source of web feature and interaction ideas.

## Explorations

- [Coaching agent feature exploration](./coaching-agent-exploration.md): researched opportunities for richer inputs, coaching memory, agent interaction, parallel generation and ongoing feedback. This is exploratory guidance; linked GitHub issues track scope, decisions and delivery state.

Completed delivery plans and test evidence live in the [archive](../archive/README.md). Runtime limits and recovery procedures live in [operations](../operations/README.md).
